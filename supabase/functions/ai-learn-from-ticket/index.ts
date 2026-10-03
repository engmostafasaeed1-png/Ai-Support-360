// Turns finished tickets into ANONYMISED draft knowledge items that an administrator reviews and publishes.
// Administrators only. Reads: the ticket, its completed sessions (summary, notes, chat) and its work-log lines.
// Never reads: internal notes, private chatbot conversations, interviews, payments, credentials.
// Everything the model writes is scrubbed again (e-mails, links, hosts, phones, numbers, custom objects and the names of the people,
// the company and the systems involved) and what the scrub removed is recorded for the reviewer. Nothing is visible to a client before an
// administrator publishes it.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { scrubText } from "../_shared/scrub.ts";
import { buildDenyList, cleanTags, cleanTcodes, saveKnowledgeDraft } from "../_shared/knowledge.ts";

const VALID_MODELS = ["openai/gpt-6-astra"];
const DEFAULT_MODEL = "openai/gpt-6-astra";
const MAX_BODY_SIZE = 10 * 1024;

const BodySchema = z.object({
  ticket_id: z.string().uuid().optional(),
  batch: z.boolean().optional(),
  limit: z.number().int().min(1).max(10).optional(),
  model: z.string().max(100).optional(),
}).passthrough();

const DISTIL_TOOL = {
  type: "function",
  function: {
    name: "create_knowledge_item",
    description: "Create one anonymous, reusable knowledge item from a finished support case",
    parameters: {
      type: "object",
      properties: {
        reusable: { type: "boolean", description: "false when the case is only about one company's own data, own custom code or a one-off mistake" },
        title: { type: "string", description: "Generic problem title, at most 120 characters" },
        problem: { type: "string", description: "The symptom a user sees, generic, at most 800 characters" },
        solution_steps: { type: "array", items: { type: "string" }, description: "Generic steps another company can follow" },
        tcodes: { type: "array", items: { type: "string" }, description: "Standard SAP transaction codes used (empty list if none)" },
        tags: { type: "array", items: { type: "string" }, description: "Up to 8 short lowercase keywords (empty list if none)" },
      },
      required: ["reusable", "title", "problem", "solution_steps", "tcodes", "tags"],
      additionalProperties: false,
    },
  },
};

// Lovable AI Gateway, Responses API (streamed). Returns the HTTP status and the arguments of the forced tool call.
async function callTool(apiKey: string, system: string, user: string, model: string): Promise<{ status: number; args: string | null }> {
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
      tools: [{ type: "function", ...DISTIL_TOOL.function }],
      tool_choice: { type: "function", name: "create_knowledge_item" },
    }),
  });
  if (!res.ok || !res.body) return { status: res.status, args: null };
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
  return { status: 200, args };
}

async function flag(admin: any, key: string): Promise<boolean | null> {
  const { data } = await admin.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return data && typeof data.value === "boolean" ? data.value : null;
}

type Outcome = { ticket_id: string; outcome: "created" | "skipped" | "error"; reason?: string; flags?: string[] };

async function learnOne(admin: any, apiKey: string, model: string, ticketId: string): Promise<Outcome | { stop: string }> {
  const skip = (reason: string): Outcome => ({ ticket_id: ticketId, outcome: "skipped", reason });

  const { data: ticket } = await admin.from("tickets")
    .select("id, title, description, resolution_notes, sap_module, sap_modules, area_details, client_id, consultant_id, tenant_id, status")
    .eq("id", ticketId).maybeSingle();
  if (!ticket) return skip("ticket not found");
  if (!["resolved", "closed"].includes(String(ticket.status))) return skip("the ticket is not finished");

  const { data: already } = await admin.from("knowledge_solution_meta").select("solution_id").eq("source_ticket_id", ticketId).eq("origin_kind", "ticket").maybeSingle();
  if (already) return skip("already learned");

  const { data: sessions } = await admin.from("sessions")
    .select("id, ai_summary, ai_action_items, notes").eq("ticket_id", ticketId).eq("status", "completed").limit(5);
  const sessionIds = (sessions ?? []).map((s: any) => s.id);
  let chat: any[] = [];
  if (sessionIds.length > 0) {
    const { data: msgs } = await admin.from("messages")
      .select("content, sender_id, message_type, created_at").in("session_id", sessionIds).order("created_at", { ascending: true }).limit(150);
    chat = (msgs ?? []).filter((m: any) => m.content && m.message_type !== "file");
  }
  const { data: logs } = await admin.from("ticket_work_logs").select("description").eq("ticket_id", ticketId).limit(20);

  const summaries: string[] = (sessions ?? []).map((s: any) => s.ai_summary).filter(Boolean);
  const resolution = String(ticket.resolution_notes ?? "").trim();
  if (resolution.length < 30 && summaries.every((s) => s.length < 30)) return skip("not enough content");

  const deny = await buildDenyList(admin, ticket, chat.map((m: any) => m.sender_id));
  const areas: string[] = (Array.isArray(ticket.sap_modules) && ticket.sap_modules.length > 0 ? ticket.sap_modules : [ticket.sap_module])
    .filter((a: unknown) => typeof a === "string" && a.trim() && a.trim().toLowerCase() !== "other");

  const source = [
    `Areas: ${areas.join(", ")}`,
    `Title: ${ticket.title ?? ""}`,
    `Description: ${ticket.description ?? ""}`,
    ticket.area_details ? `More details: ${ticket.area_details}` : "",
    resolution ? `Resolution notes: ${resolution}` : "",
    (logs ?? []).length > 0 ? `Work log:\n${(logs ?? []).map((l: any) => `- ${l.description ?? ""}`).join("\n")}` : "",
    summaries.length > 0 ? `Session summaries:\n${summaries.join("\n")}` : "",
    (sessions ?? []).some((s: any) => s.notes) ? `Session notes:\n${(sessions ?? []).map((s: any) => s.notes).filter(Boolean).join("\n")}` : "",
    chat.length > 0 ? `Chat:\n${chat.map((m: any) => `- ${m.content}`).join("\n").slice(0, 4000)}` : "",
  ].filter(Boolean).join("\n\n");
  // the model never sees the names, e-mails, hosts or numbers of this case
  const prompt = scrubText(source, deny).text.slice(0, 12000);

  const answer = await callTool(
    apiKey,
    `You turn one finished SAP support case into a short, reusable, ANONYMOUS knowledge item that can help other companies with the same problem.
STRICT RULES:
- Remove every identifying detail: company names, people's names, e-mail addresses, phone numbers, host names, URLs, IP addresses, system IDs, client numbers, company codes, plant codes, user names, document, order, invoice and payment numbers, amounts, dates, custom object names (Z or Y objects), file names, and anything else that could point to one company or one person.
- Describe the problem as a generic symptom (what the user sees, which transaction or message) and the solution as generic steps another company can follow.
- Keep standard SAP names: transactions, tables, message numbers, SAP Notes, standard configuration paths.
- Do not invent anything that is not in the case. If the case is only about this company's own data, own custom code or a one-off mistake and has no reusable lesson, set reusable to false.
- Write in English.`,
    prompt,
    model,
  );
  if (answer.status !== 200) {
    if (answer.status === 429 || answer.status === 402) {
      return { stop: answer.status === 429 ? "The AI service is busy, try again in a minute." : "The AI credits are used up." };
    }
    return { ticket_id: ticketId, outcome: "error", reason: `AI gateway error ${answer.status}` };
  }
  let item: any = null;
  try {
    item = answer.args ? JSON.parse(answer.args) : null;
  } catch { /* handled below */ }
  if (!item) return { ticket_id: ticketId, outcome: "error", reason: "the model gave no usable answer" };
  if (item.reusable === false) return skip("no reusable lesson");

  const steps: string[] = (Array.isArray(item.solution_steps) ? item.solution_steps : [])
    .map((s: unknown) => String(s ?? "").trim()).filter(Boolean).slice(0, 10);
  const tcodes = cleanTcodes(item.tcodes);
  if (steps.length === 0) return { ticket_id: ticketId, outcome: "error", reason: "the model gave no steps" };
  const solution = steps.map((s, i) => `${i + 1}. ${s}`).join("\n") + (tcodes.length > 0 ? `\n\nTransactions: ${tcodes.join(", ")}` : "");

  const saved = await saveKnowledgeDraft(admin, {
    title: String(item.title ?? ""),
    problem: String(item.problem ?? ""),
    solution,
    areas,
    tags: cleanTags(item.tags),
    ticketId: ticket.id,
    consultantId: ticket.consultant_id ?? null,
    originKind: "ticket",
    deny,
  });
  if (saved.status === "created") return { ticket_id: ticketId, outcome: "created", flags: saved.flags };
  if (saved.status === "skipped") return skip(saved.reason);
  return { ticket_id: ticketId, outcome: "error", reason: saved.reason };
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
    if (!hasAnyRole(roles, ADMIN_ROLES)) return json({ error: "Forbidden" }, 403);
    if (!(await withinRateLimit(admin, `ai-learn:${user.id}`, 6, 60, true))) {
      return json({ error: "Rate limit exceeded. Please wait before sending more requests." }, 429, { "Retry-After": "60" });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) return json({ error: "Request too large" }, 413);
    let parsedBody: unknown;
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(parsedBody);
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const body = parsed.data;
    if (!body.ticket_id && !body.batch) return json({ error: "Give a ticket_id or batch: true" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const model = body.model && VALID_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL;

    if ((await flag(admin, "ai_learning_enabled")) === false) {
      return json({ enabled: false, created: 0, looked_at: 0, results: [] });
    }

    let ticketIds: string[];
    if (body.ticket_id) {
      ticketIds = [body.ticket_id];
    } else {
      const { data: done } = await admin.from("tickets").select("id").in("status", ["resolved", "closed"])
        .order("resolved_at", { ascending: false, nullsFirst: false }).limit(200);
      const ids: string[] = (done ?? []).map((t: any) => t.id);
      const { data: learned } = ids.length > 0
        ? await admin.from("knowledge_solution_meta").select("source_ticket_id").in("source_ticket_id", ids).eq("origin_kind", "ticket")
        : { data: [] };
      const skipIds = new Set((learned ?? []).map((r: any) => r.source_ticket_id));
      ticketIds = ids.filter((id) => !skipIds.has(id)).slice(0, body.limit ?? 5);
    }

    const results: Outcome[] = [];
    let stopped: string | undefined;
    for (const id of ticketIds) {
      const r = await learnOne(admin, LOVABLE_API_KEY, model, id);
      if ("stop" in r) {
        stopped = r.stop;
        break;
      }
      results.push(r);
    }
    return json({
      enabled: true,
      created: results.filter((r) => r.outcome === "created").length,
      looked_at: ticketIds.length,
      stopped,
      results,
    });
  } catch (e) {
    console.error("ai-learn-from-ticket error:", e instanceof Error ? e.message : String(e));
    return json({ error: "Request failed. Please try again." }, 500);
  }
});
