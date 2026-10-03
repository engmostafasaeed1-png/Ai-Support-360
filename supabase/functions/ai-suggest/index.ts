// Suggestions for a client who is about to open a ticket.
// Sources: only knowledge that an administrator has published (anonymised articles and solved cases, admin-written playbooks),
// found by the database function search_knowledge. Nothing from another client's ticket, chat or session ever reaches this prompt or the answer.
// When nothing published fits, the answer is clearly marked as general SAP guidance.
// SAP references: an SAP Note number is shown only when a reviewed source cites it (the model may not invent one). The links to SAP's own free
// websites (Help Portal, Community, Learning, Developer tutorials) carry a few generic words. When an administrator switches it on, up to 3 matching
// SAP Community discussions are looked up and shown as links.
// SAP's open documentation (github.com/SAP-docs, CC BY 4.0): pages that an administrator imported and switched on are found by search_sap_docs and
// may be used as one more source. They are public, not from any client, and every suggestion that uses one carries its source link and licence.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { scrubText, type DenyTerm } from "../_shared/scrub.ts";
import { buildDenyList } from "../_shared/knowledge.ts";
import {
  blockedWords,
  cleanSearchTerms,
  communitySearchUrl,
  extractNoteNumbers,
  freeSourceLinks,
  MAX_NOTES,
  noteUrl,
  pickSearchTerms,
  redactUnverifiedNotes,
} from "../_shared/sapRefs.ts";
import { searchCommunity, type CommunityHit } from "../_shared/sapCommunity.ts";
import { docUrl, isBranchName, isSapDocsRepo } from "../_shared/sapDocs.ts";

const VALID_MODELS = ["openai/gpt-6-astra"];
const DEFAULT_MODEL = "openai/gpt-6-astra";
const MAX_BODY_SIZE = 50 * 1024;

const BodySchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().min(15).max(8000),
  sap_modules: z.array(z.string().max(80)).max(12).optional(),
  sap_module_other: z.string().max(160).optional(),
  area_details: z.string().max(2000).optional(),
  sap_notes_tried: z.array(z.string().regex(/^\d{5,8}$/)).max(8).optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  preferred_language: z.string().max(20).optional(),
  model: z.string().max(100).optional(),
}).passthrough();

/** Where a page of SAP's open documentation comes from (shown with every suggestion that uses it). */
interface DocRef {
  title: string;
  url: string;
  source: string;
  license: string;
}

interface KnowledgeItem {
  kind: "article" | "solution" | "playbook" | "doc";
  id: string;
  title: string;
  problem: string | null;
  solution: string | null;
  doc?: DocRef;
}

type Basis = "knowledge_base" | "past_case" | "playbook" | "sap_docs" | "general";

interface Suggestion {
  title: string;
  summary: string;
  steps: string[];
  tcodes: string[];
  confidence: "high" | "medium" | "low";
  basis: Basis;
  source_ids: string[];
  docs: DocRef[];
}

const SUGGEST_TOOL = {
  type: "function",
  function: {
    name: "suggest_solutions",
    description: "Return solutions the client can try before opening a ticket",
    parameters: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short title of the suggestion" },
              summary: { type: "string", description: "One or two sentences: why this fits the ticket" },
              steps: { type: "array", items: { type: "string" }, description: "Short concrete steps, one action each" },
              tcodes: { type: "array", items: { type: "string" }, description: "SAP transaction codes that are used (empty list if none)" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              source_refs: { type: "array", items: { type: "integer" }, description: "Numbers of the knowledge items used (empty for general guidance)" },
            },
            required: ["title", "summary", "steps", "tcodes", "confidence", "source_refs"],
            additionalProperties: false,
          },
        },
        search_terms: {
          type: "array",
          items: { type: "string" },
          description: "2 to 5 single lowercase words someone would type into SAP Community to find help for this ticket: a transaction code, an error number or the key nouns. No names of people, companies or systems.",
        },
        note: { type: "string", description: "A short remark for the client, for example when a ticket is the better way (empty string when there is nothing to add)" },
      },
      required: ["suggestions", "search_terms", "note"],
      additionalProperties: false,
    },
  },
};

// Lovable AI Gateway, Responses API (streamed). Returns a Response whose JSON is { arguments } of the forced tool call.
async function aiRequest(apiKey: string, system: string, user: string, model: string): Promise<Response> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Lovable-API-Key": apiKey, Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: system,
      input: [{ role: "user", content: user }],
      tools: [{ type: "function", ...SUGGEST_TOOL.function }],
      tool_choice: { type: "function", name: "suggest_solutions" },
    }),
  });
  if (!res.ok || !res.body) return res;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let args: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.function_call_arguments.done" && typeof ev.arguments === "string") args = ev.arguments;
        else if (ev.type === "response.output_item.done" && ev.item?.type === "function_call" && !args) args = ev.item.arguments;
      } catch { /* partial or non-JSON line */ }
    }
  }
  return new Response(JSON.stringify({ arguments: args }), { status: 200 });
}

function parseToolResult(data: any): any | null {
  if (typeof data?.arguments !== "string") return null;
  try {
    return JSON.parse(data.arguments);
  } catch {
    return null;
  }
}

/** Cuts a long text at the end of a sentence when it can, otherwise with an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return shorten(scrubText(value.replace(/\s+/g, " ").trim()).text, max);
}

function languageName(code: string | undefined): string {
  return code === "ar" ? "Arabic" : "English";
}

function basisOf(kind: KnowledgeItem["kind"]): Basis {
  return kind === "article" ? "knowledge_base" : kind === "playbook" ? "playbook" : kind === "doc" ? "sap_docs" : "past_case";
}

/** The SAP Note numbers that our reviewed items cite. */
function noteNumbersOf(items: ReadonlyArray<KnowledgeItem>): string[] {
  return [...new Set(items.flatMap((it) => extractNoteNumbers(`${it.problem ?? ""}\n${it.solution ?? ""}`)))];
}

function normalise(raw: any, items: KnowledgeItem[], grounded: boolean): Suggestion[] {
  const list = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  const out: Suggestion[] = [];
  for (const s of list) {
    if (out.length >= (grounded ? 4 : 3)) break;
    const title = clean(s?.title, 140);
    const steps = (Array.isArray(s?.steps) ? s.steps : []).map((x: unknown) => clean(x, 300)).filter(Boolean).slice(0, 8);
    if (!title || steps.length === 0) continue;
    const refs: number[] = grounded
      ? [...new Set<number>((Array.isArray(s?.source_refs) ? s.source_refs : []).filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= items.length))]
      : [];
    if (grounded && refs.length === 0) continue; // a knowledge answer must name the items it comes from
    const used = refs.map((n) => items[n - 1]);
    // a note number survives only when a reviewed item cites it; the model cannot be trusted to remember note numbers correctly
    const allowed = new Set<string>(noteNumbersOf(used));
    const guard = (text: string) => redactUnverifiedNotes(text, allowed);
    const tcodes = [...new Set<string>((Array.isArray(s?.tcodes) ? s.tcodes : [])
      .map((x: unknown) => String(x ?? "").trim().toUpperCase())
      .filter((x: string) => /^[A-Z0-9_\/]{2,20}$/.test(x)))].slice(0, 8);
    // the pages of SAP's documentation have no id in our tables: they are named by their source link, and the basis follows the first own source
    const own = used.filter((u) => u.kind !== "doc");
    const docs: DocRef[] = [];
    for (const u of used) {
      if (u.doc && !docs.some((d) => d.url === u.doc!.url)) docs.push(u.doc);
    }
    out.push({
      title: guard(title),
      summary: guard(clean(s?.summary, 600)),
      steps: steps.map(guard),
      tcodes,
      confidence: s?.confidence === "high" || s?.confidence === "low" ? s.confidence : "medium",
      basis: grounded ? basisOf((own[0] ?? used[0]).kind) : "general",
      source_ids: own.map((u) => u.id),
      docs,
    });
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", ...extra } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid or expired session" }, 401);

    const admin = adminClient();
    const roles = await getUserRoles(admin, user.id);
    if (!hasAnyRole(roles, ["client", ...ADMIN_ROLES])) return json({ error: "Forbidden" }, 403);

    if (!(await withinRateLimit(admin, `ai-suggest:${user.id}`, 12, 60, true))) {
      return json({ error: "Rate limit exceeded. Please wait before sending more requests." }, 429, { "Retry-After": "60" });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) return json({ error: "Request too large" }, 413);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(parsedBody);
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const body = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const model = body.model && VALID_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL;

    // the administrator's switches: suggestions (absent = on) and the live SAP Community look-up (absent = off)
    const { data: settingRows } = await admin.from("platform_settings").select("key, value").in("key", ["ai_suggestions_enabled", "ai_sap_community_enabled"]);
    const flag = (key: string): unknown => ((settingRows ?? []) as Array<{ key: string; value: unknown }>).find((r) => r.key === key)?.value;
    if (flag("ai_suggestions_enabled") === false) {
      return json({ enabled: false, mode: "general", suggestions: [], sources: [] });
    }
    const communityOn = flag("ai_sap_community_enabled") === true;

    // the caller's company: global knowledge and the company's own, never another company's
    const { data: member } = await admin.from("tenant_members").select("tenant_id").eq("user_id", user.id).not("accepted_at", "is", null).limit(1).maybeSingle();
    const tenantId: string | null = member?.tenant_id ?? null;

    // the names of the caller, the caller's company and systems are removed from everything that leaves this server
    let deny: DenyTerm[] = [];
    try {
      deny = await buildDenyList(admin, { client_id: user.id, consultant_id: null, tenant_id: tenantId }, []);
    } catch (e) {
      console.warn("deny list failed:", e instanceof Error ? e.message : String(e));
    }

    const areas = [...new Set((body.sap_modules ?? []).map((a: string) => a.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 12);
    const areaLine = areas.map((a: string) => (a.toLowerCase() === "other" && body.sap_module_other ? `Other: ${body.sap_module_other}` : a)).join(", ");
    const ticketText = scrubText(
      [
        body.title ? `Title: ${body.title}` : "",
        areaLine ? `Areas: ${areaLine}` : "",
        `Description: ${body.description}`,
        body.area_details ? `More details: ${body.area_details}` : "",
      ].filter(Boolean).join("\n"),
      deny,
    ).text.slice(0, 6000);
    const problemText = scrubText(`${body.title ?? ""}\n${body.description}`, deny).text;
    const language = languageName(body.preferred_language);
    // the SAP Notes the client says were already tried: only the numbers, and the model is told not to suggest them again
    const triedNotes: string[] = [...new Set<string>(body.sap_notes_tried ?? [])].slice(0, 8);
    const triedLine = triedNotes.length > 0 ? `\nSAP Notes the client already tried (do not suggest them again): ${triedNotes.join(", ")}` : "";

    // 1. published, anonymised knowledge
    const { data: found, error: searchError } = await admin.rpc("search_knowledge", {
      // the placeholders left by the scrub ([email], [number] ...) are not search words
      _query: ticketText.replace(/\[[a-z ]{2,20}\]/g, " ").slice(0, 4000),
      _areas: areas,
      _tenant: tenantId,
      _limit: 6,
    });
    if (searchError) console.error("search_knowledge failed:", searchError.message);
    const items: KnowledgeItem[] = (Array.isArray(found) ? found : []).map((r: any) => ({
      kind: r.kind,
      id: String(r.id),
      title: String(r.title ?? ""),
      problem: r.problem ?? null,
      solution: r.solution ?? null,
    }));

    // 1b. SAP's open documentation: only imported and switched-on sources take part (the database function returns nothing when there is none)
    const blocked = blockedWords(deny);
    const docTerms = cleanSearchTerms(pickSearchTerms(problemText, 6), blocked, 6);
    if (docTerms.length >= 2) {
      try {
        const { data: docRows, error: docError } = await admin.rpc("search_sap_docs", { _terms: docTerms, _limit: 3 });
        if (docError) console.warn("search_sap_docs failed:", docError.message);
        for (const d of Array.isArray(docRows) ? docRows : []) {
          if (!isSapDocsRepo(d.repo) || !isBranchName(d.branch) || typeof d.path !== "string") continue;
          const heading = typeof d.heading === "string" && d.heading ? ` - ${d.heading}` : "";
          const title = clean(`${d.doc_title ?? ""}${heading}`, 200);
          items.push({
            kind: "doc",
            id: `doc:${d.source_id}:${d.path}`,
            title,
            problem: null,
            solution: String(d.body ?? "").slice(0, 1800),
            doc: { title, url: docUrl(d.repo, d.branch, d.path), source: clean(d.source_title, 120), license: clean(d.license, 30) || "CC-BY-4.0" },
          });
        }
      } catch (e) {
        console.warn("SAP documentation look-up failed:", e instanceof Error ? e.message : String(e)); // the suggestions work without it
      }
    }

    let suggestions: Suggestion[] = [];
    let note = "";
    let mode: "knowledge" | "general" = "knowledge";
    let rawTerms: unknown = [];

    if (items.length > 0) {
      const context = items
        .map((it, i) => {
          const label = it.kind === "article" ? "Knowledge article" : it.kind === "playbook" ? "Playbook" : it.kind === "doc" ? "SAP documentation, public" : "Solved case, anonymised";
          return `[${i + 1}] (${label}) ${it.title}\n${it.problem ? `Problem: ${it.problem.slice(0, 1200)}\n` : ""}${it.kind === "doc" ? "Text" : "Solution"}:\n${(it.solution ?? "").slice(0, 2500)}`;
        })
        .join("\n\n---\n\n");
      const response = await aiRequest(
        LOVABLE_API_KEY,
        `You help an SAP client BEFORE they open a support ticket. You get the client's draft ticket and numbered knowledge items that an administrator has published (anonymised articles, solved cases and playbooks). Suggest solutions the client can try now.
Rules:
- Use ONLY the numbered items. Do not add steps that are not in them. You may reorder, shorten and match them to the ticket.
- Items labelled "SAP documentation, public" are pages of SAP's own documentation, not cases of this platform. Use one only when it really fits the ticket, write the steps in your own words and do not copy long passages.
- Suggest an item only when it genuinely fits the ticket. If none fits, return an empty list.
- If the draft ticket lists SAP Notes the client already tried, do not suggest those notes again and do not repeat the steps they describe.
- At most 4 suggestions, best first. Every suggestion lists the numbers of the items it comes from.
- Never write a company name, a person name, an e-mail address, a host name, a system ID or a document number. Leave such details out.
- Write an SAP Note number only when it appears in the numbered items. Never guess or invent a note number.
- confidence is "high" only when the item describes the same symptom in the same area.
- search_terms: 2 to 5 single lowercase words someone would type into SAP Community to find help for this ticket (a transaction code, an error number or the key nouns). No names of people, companies or systems.
- Write in ${language}. Keep every step short and concrete (one action each).`,
        `Draft ticket:\n${ticketText}${triedLine}\n\nKnowledge items:\n${context}`,
        model,
      );
      if (!response.ok) {
        if (response.status === 429) return json({ error: "Rate limited" }, 429);
        if (response.status === 402) return json({ error: "Credits exhausted" }, 402);
        throw new Error(`AI gateway error: ${response.status}`);
      }
      const result = parseToolResult(await response.json());
      suggestions = normalise(result, items, true);
      note = clean(result?.note, 400);
      rawTerms = result?.search_terms;
    }

    // 2. nothing published fits: general guidance, marked as such
    if (suggestions.length === 0) {
      mode = "general";
      const response = await aiRequest(
        LOVABLE_API_KEY,
        `You help an SAP client BEFORE they open a support ticket. Give general, well-known SAP guidance for the described problem: what to check first, standard transactions, typical causes. This guidance is NOT taken from this platform's past cases, so do not claim certainty.
Rules:
- At most 3 suggestions, best first. source_refs must be empty.
- If the draft ticket lists SAP Notes the client already tried, do not suggest those notes again and do not repeat the steps they describe.
- If the problem needs access to the client's own system, or the description is too unclear, say so in "note" and say that a ticket is the better way.
- Never write a company name, a person name, an e-mail address, a host name, a system ID or a document number.
- Do not write SAP Note numbers or KBA numbers: you cannot check them. You may say that a related SAP Note probably exists.
- search_terms: 2 to 5 single lowercase words someone would type into SAP Community to find help for this ticket (a transaction code, an error number or the key nouns). No names of people, companies or systems.
- Write in ${language}. Keep every step short and concrete (one action each).`,
        `Draft ticket:\n${ticketText}${triedLine}`,
        model,
      );
      if (!response.ok) {
        if (response.status === 429) return json({ error: "Rate limited" }, 429);
        if (response.status === 402) return json({ error: "Credits exhausted" }, 402);
        throw new Error(`AI gateway error: ${response.status}`);
      }
      const result = parseToolResult(await response.json());
      suggestions = normalise(result, items, false);
      note = clean(result?.note, 400) || (items.length === 0 ? "No stored solution matches your description yet." : "");
      rawTerms = result?.search_terms;
    }

    const usedIds = new Set(suggestions.flatMap((s) => s.source_ids));
    const usedItems = items.filter((it) => usedIds.has(it.id));
    const usedDocUrls = new Set(suggestions.flatMap((s) => s.docs.map((d) => d.url)));
    const usedDocs = items.filter((it) => it.doc && usedDocUrls.has(it.doc.url));
    const sources = usedItems.map((it) => ({ id: it.id, kind: it.kind, title: clean(it.title, 160) }));

    // SAP references: note numbers cited by the reviewed items and the documentation pages that were used, and words for SAP Community
    const notes = noteNumbersOf([...usedItems, ...usedDocs]).filter((n) => !triedNotes.includes(n)).slice(0, MAX_NOTES).flatMap((number) => {
      const url = noteUrl(number);
      return url ? [{ number, url }] : [];
    });
    const fromModel = cleanSearchTerms(rawTerms, blocked);
    const terms = fromModel.length >= 2 ? fromModel : cleanSearchTerms(pickSearchTerms(problemText, 5), blocked);
    const community: { enabled: boolean; items: CommunityHit[] } = { enabled: communityOn, items: [] };
    if (communityOn && terms.length >= 2) community.items = await searchCommunity(terms);

    return json({
      enabled: true,
      mode,
      suggestions,
      sources,
      note,
      notes,
      references: { community_search_url: communitySearchUrl(terms), free_sources: freeSourceLinks(terms), community },
    });
  } catch (e) {
    console.error("ai-suggest error:", e instanceof Error ? e.message : String(e));
    return json({ error: "Request failed. Please try again." }, 500);
  }
});
