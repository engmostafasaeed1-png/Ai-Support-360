// Suggestions for a client who is about to open a ticket.
// Sources: only knowledge that an administrator has published (anonymised articles and solved cases, admin-written playbooks),
// found by the database function search_knowledge. Nothing from another client's ticket, chat or session ever reaches this prompt or the answer.
// When nothing published fits, the answer is clearly marked as general SAP guidance.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { scrubText } from "../_shared/scrub.ts";

const VALID_MODELS = ["openai/gpt-6-astra"];
const DEFAULT_MODEL = "openai/gpt-6-astra";
const MAX_BODY_SIZE = 50 * 1024;

const BodySchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().min(15).max(8000),
  sap_modules: z.array(z.string().max(80)).max(12).optional(),
  sap_module_other: z.string().max(160).optional(),
  area_details: z.string().max(2000).optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  preferred_language: z.string().max(20).optional(),
  model: z.string().max(100).optional(),
}).passthrough();

interface KnowledgeItem {
  kind: "article" | "solution" | "playbook";
  id: string;
  title: string;
  problem: string | null;
  solution: string | null;
}

type Basis = "knowledge_base" | "past_case" | "playbook" | "general";

interface Suggestion {
  title: string;
  summary: string;
  steps: string[];
  tcodes: string[];
  confidence: "high" | "medium" | "low";
  basis: Basis;
  source_ids: string[];
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
              tcodes: { type: "array", items: { type: "string" }, description: "SAP transaction codes that are used" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              source_refs: { type: "array", items: { type: "integer" }, description: "Numbers of the knowledge items used (empty for general guidance)" },
            },
            required: ["title", "summary", "steps", "confidence", "source_refs"],
            additionalProperties: false,
          },
        },
        note: { type: "string", description: "A short remark for the client, for example when a ticket is the better way" },
      },
      required: ["suggestions"],
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

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return scrubText(value.replace(/\s+/g, " ").trim()).text.slice(0, max);
}

function languageName(code: string | undefined): string {
  return code === "ar" ? "Arabic" : "English";
}

function basisOf(kind: KnowledgeItem["kind"]): Basis {
  return kind === "article" ? "knowledge_base" : kind === "playbook" ? "playbook" : "past_case";
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
    const tcodes = [...new Set<string>((Array.isArray(s?.tcodes) ? s.tcodes : [])
      .map((x: unknown) => String(x ?? "").trim().toUpperCase())
      .filter((x: string) => /^[A-Z0-9_\/]{2,20}$/.test(x)))].slice(0, 8);
    out.push({
      title,
      summary: clean(s?.summary, 600),
      steps,
      tcodes,
      confidence: s?.confidence === "high" || s?.confidence === "low" ? s.confidence : "medium",
      basis: grounded ? basisOf(used[0].kind) : "general",
      source_ids: used.map((u) => u.id),
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

    // the administrator's switch (absent = on)
    const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "ai_suggestions_enabled").maybeSingle();
    if (setting && setting.value === false) {
      return json({ enabled: false, mode: "general", suggestions: [], sources: [] });
    }

    // the caller's company: global knowledge and the company's own, never another company's
    const { data: member } = await admin.from("tenant_members").select("tenant_id").eq("user_id", user.id).not("accepted_at", "is", null).limit(1).maybeSingle();
    const tenantId: string | null = member?.tenant_id ?? null;

    const areas = [...new Set((body.sap_modules ?? []).map((a: string) => a.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 12);
    const areaLine = areas.map((a: string) => (a.toLowerCase() === "other" && body.sap_module_other ? `Other: ${body.sap_module_other}` : a)).join(", ");
    const ticketText = scrubText(
      [
        body.title ? `Title: ${body.title}` : "",
        areaLine ? `Areas: ${areaLine}` : "",
        `Description: ${body.description}`,
        body.area_details ? `More details: ${body.area_details}` : "",
      ].filter(Boolean).join("\n"),
    ).text.slice(0, 6000);
    const language = languageName(body.preferred_language);

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

    let suggestions: Suggestion[] = [];
    let note = "";
    let mode: "knowledge" | "general" = "knowledge";

    if (items.length > 0) {
      const context = items
        .map((it, i) => {
          const label = it.kind === "article" ? "Knowledge article" : it.kind === "playbook" ? "Playbook" : "Solved case, anonymised";
          return `[${i + 1}] (${label}) ${it.title}\n${it.problem ? `Problem: ${it.problem.slice(0, 1200)}\n` : ""}Solution:\n${(it.solution ?? "").slice(0, 2500)}`;
        })
        .join("\n\n---\n\n");
      const response = await aiRequest(
        LOVABLE_API_KEY,
        `You help an SAP client BEFORE they open a support ticket. You get the client's draft ticket and numbered knowledge items that an administrator has published (anonymised articles, solved cases and playbooks). Suggest solutions the client can try now.
Rules:
- Use ONLY the numbered items. Do not add steps that are not in them. You may reorder, shorten and match them to the ticket.
- Suggest an item only when it genuinely fits the ticket. If none fits, return an empty list.
- At most 4 suggestions, best first. Every suggestion lists the numbers of the items it comes from.
- Never write a company name, a person name, an e-mail address, a host name, a system ID or a document number. Leave such details out.
- confidence is "high" only when the item describes the same symptom in the same area.
- Write in ${language}. Keep every step short and concrete (one action each).`,
        `Draft ticket:\n${ticketText}\n\nKnowledge items:\n${context}`,
        model,
      );
      if (!response.ok) {
        if (response.status === 429) return json({ error: "Rate limited" }, 429);
        if (response.status === 402) return json({ error: "Credits exhausted" }, 402);
        throw new Error(`AI gateway error: ${response.status}`);
      }
      const result = parseToolResult(await response.json());
      suggestions = normalise(result, items, true);
      note = clean(result?.note, 300);
    }

    // 2. nothing published fits: general guidance, marked as such
    if (suggestions.length === 0) {
      mode = "general";
      const response = await aiRequest(
        LOVABLE_API_KEY,
        `You help an SAP client BEFORE they open a support ticket. Give general, well-known SAP guidance for the described problem: what to check first, standard transactions, typical causes. This guidance is NOT taken from this platform's past cases, so do not claim certainty.
Rules:
- At most 3 suggestions, best first. source_refs must be empty.
- If the problem needs access to the client's own system, or the description is too unclear, say so in "note" and say that a ticket is the better way.
- Never write a company name, a person name, an e-mail address, a host name, a system ID or a document number.
- Write in ${language}. Keep every step short and concrete (one action each).`,
        `Draft ticket:\n${ticketText}`,
        model,
      );
      if (!response.ok) {
        if (response.status === 429) return json({ error: "Rate limited" }, 429);
        if (response.status === 402) return json({ error: "Credits exhausted" }, 402);
        throw new Error(`AI gateway error: ${response.status}`);
      }
      const result = parseToolResult(await response.json());
      suggestions = normalise(result, items, false);
      note = clean(result?.note, 300) || (items.length === 0 ? "No stored solution matches your description yet." : "");
    }

    const usedIds = new Set(suggestions.flatMap((s) => s.source_ids));
    const sources = items.filter((it) => usedIds.has(it.id)).map((it) => ({ id: it.id, kind: it.kind, title: clean(it.title, 160) }));
    return json({ enabled: true, mode, suggestions, sources, note });
  } catch (e) {
    console.error("ai-suggest error:", e instanceof Error ? e.message : String(e));
    return json({ error: "Request failed. Please try again." }, 500);
  }
});
