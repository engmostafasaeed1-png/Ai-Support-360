// Helpers shared by the functions that turn finished work into anonymised DRAFT knowledge (ai-session-analysis, ai-learn-from-ticket).
// A draft is visible to administrators only. It becomes visible to clients only when an administrator publishes it.
import { scrubAll, denyTermsFromNames, denyTermsFromEmails, type DenyTerm } from "./scrub.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

const GENERIC_SYSTEM_IDS = new Set(["dev", "qas", "prd", "tst", "test", "prod", "sbx", "qa", "uat", "sandbox"]);

export interface DenySource {
  client_id: string | null;
  consultant_id: string | null;
  tenant_id: string | null;
}

/** Names that must not survive in a text: the people, the company and the systems of this piece of work. */
export async function buildDenyList(admin: Admin, source: DenySource, extraUserIds: Array<string | null | undefined> = []): Promise<DenyTerm[]> {
  const deny: DenyTerm[] = [];
  const userIds = new Set<string>([source.client_id, ...extraUserIds].filter((x): x is string => !!x));
  if (source.consultant_id) {
    const { data: c } = await admin.from("consultants").select("user_id").eq("id", source.consultant_id).maybeSingle();
    if (c?.user_id) userIds.add(c.user_id);
  }
  const ids = [...userIds].slice(0, 12);
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("display_name").in("user_id", ids);
    deny.push(...denyTermsFromNames((profiles ?? []).map((p: { display_name: string | null }) => p.display_name), "[person]", 3));
  }
  const emails: string[] = [];
  for (const id of ids.slice(0, 6)) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email) emails.push(data.user.email);
    } catch { /* a missing user is not a reason to stop */ }
  }
  deny.push(...denyTermsFromEmails(emails));

  if (source.client_id) {
    const { data: cp } = await admin.from("client_profiles")
      .select("company_name, company_website, sap_system_ids, key_contacts")
      .eq("user_id", source.client_id).maybeSingle();
    if (cp) {
      deny.push(...denyTermsFromNames([cp.company_name], "[company]", 4));
      if (cp.company_website) {
        const host = String(cp.company_website).replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0];
        deny.push(...denyTermsFromEmails([`x@${host}`]));
      }
      const sids = (Array.isArray(cp.sap_system_ids) ? cp.sap_system_ids : [])
        .filter((s: unknown) => typeof s === "string" && !GENERIC_SYSTEM_IDS.has(String(s).toLowerCase()));
      deny.push(...denyTermsFromNames(sids, "[system]", 3));
      // deno-lint-ignore no-explicit-any
      const contacts: any[] = Array.isArray(cp.key_contacts) ? cp.key_contacts : [];
      deny.push(...denyTermsFromNames(contacts.map((k) => k?.name), "[person]", 3));
      deny.push(...denyTermsFromEmails(contacts.map((k) => k?.email)));
    }
  }
  if (source.tenant_id) {
    const { data: t } = await admin.from("tenants").select("name, domain").eq("id", source.tenant_id).maybeSingle();
    if (t) {
      deny.push(...denyTermsFromNames([t.name], "[company]", 4));
      if (t.domain) deny.push(...denyTermsFromEmails([`x@${t.domain}`]));
    }
  }
  return deny;
}

export function cleanTags(raw: unknown): string[] {
  return [...new Set<string>((Array.isArray(raw) ? raw : [])
    .map((x) => String(x ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((x) => x.length >= 2 && x.length <= 24))].slice(0, 8);
}

export function cleanTcodes(raw: unknown): string[] {
  return [...new Set<string>((Array.isArray(raw) ? raw : [])
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter((x) => /^[A-Z0-9_/]{2,20}$/.test(x)))].slice(0, 8);
}

export interface DraftInput {
  title: string;
  problem: string;
  solution: string;
  areas: string[];
  tags: string[];
  ticketId: string | null;
  consultantId: string | null;
  originKind: "session" | "ticket" | "manual";
  /** The person who wrote an item by hand (null for items the AI learned). */
  createdBy?: string | null;
  deny: DenyTerm[];
}

export type DraftResult =
  | { status: "created"; flags: string[] }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

/** Scrubs the text once more, stores it as a draft, and remembers where it came from (administrators only). */
export async function saveKnowledgeDraft(admin: Admin, input: DraftInput): Promise<DraftResult> {
  if (input.ticketId) {
    const { data: existing } = await admin.from("knowledge_solution_meta").select("solution_id")
      .eq("source_ticket_id", input.ticketId).eq("origin_kind", input.originKind).maybeSingle();
    if (existing) return { status: "skipped", reason: "already learned" };
  }
  const scrubbed = scrubAll([input.title.trim().slice(0, 200), input.problem.trim().slice(0, 2000), input.solution.trim().slice(0, 6000)], input.deny);
  const [title, problem, solution] = scrubbed.values;
  if (!title || !problem || !solution) return { status: "error", reason: "the item is empty" };

  const areas = input.areas.map((a) => a.trim()).filter((a) => a && a.toLowerCase() !== "other").slice(0, 12);
  const { data: sol, error: solError } = await admin.from("knowledge_solutions").insert({
    title,
    problem_description: problem,
    solution,
    sap_module: areas[0] ?? null,
    sap_modules: areas,
    tags: input.tags,
    source_ticket_id: input.ticketId,
    created_by: input.createdBy ?? null,
    status: "draft",
  }).select("id").single();
  if (solError || !sol) return { status: "error", reason: "could not store the draft" };

  const { error: metaError } = await admin.from("knowledge_solution_meta").insert({
    solution_id: sol.id,
    origin_kind: input.originKind,
    source_ticket_id: input.ticketId,
    source_consultant_id: input.consultantId,
    privacy_flags: scrubbed.flags,
  });
  if (metaError) {
    await admin.from("knowledge_solutions").delete().eq("id", sol.id);
    return metaError.code === "23505" ? { status: "skipped", reason: "already learned" } : { status: "error", reason: "could not store the origin" };
  }
  return { status: "created", flags: scrubbed.flags };
}
