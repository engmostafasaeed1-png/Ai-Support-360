// AI Support Agent — tool-calling chat backend.
// Streams a final answer to the client; if the model decides to call tools
// (look up the user's own tickets/sessions/invoices, search the knowledge
// base, or create a ticket), we execute them server-side using a Supabase
// client scoped to the *caller's* JWT so RLS naturally enforces ownership.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit } from "../_shared/security.ts";

const VALID_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-5-mini",
  "openai/gpt-5",
];
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const MAX_BODY_SIZE = 50 * 1024;

const SYSTEM_PROMPT = `You are AI SAP Support Now, the AI support agent for Qurtuba Talks — a premium SAP consulting platform.

You can:
- Answer general SAP questions (FI, MM, SD, BASIS, ABAP, BW, S/4HANA, SuccessFactors, etc.).
- Look up the signed-in user's own tickets, sessions, and invoices via tools.
- Search the platform's knowledge base and resolution playbooks.
- Help draft and create a new support ticket on the user's behalf.

Rules:
- Use tools whenever the user asks about *their* data ("my tickets", "open invoices", "last session"). Never invent ticket IDs or amounts — call the tool.
- Before calling \`create_ticket\`, confirm Title, SAP module, urgency, and a one-paragraph description with the user.
- When you cite knowledge-base or playbook content, mention the title.
- Reply in the language the user writes in.
- Use clear markdown (short paragraphs, **bold** for key fields, lists where helpful).
- Be concise. No filler.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_my_tickets",
      description: "Return the signed-in user's recent support tickets. Use this whenever they ask about THEIR tickets, cases, or open issues.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["any", "new", "in_progress", "resolved", "closed"],
            description: "Filter by status. Use 'any' (default) to return all.",
          },
          limit: { type: "number", description: "Max rows (1-20). Default 10." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_sessions",
      description: "Return the signed-in user's upcoming or recent consulting sessions.",
      parameters: {
        type: "object",
        properties: {
          when: { type: "string", enum: ["upcoming", "past", "any"], description: "Default 'any'." },
          limit: { type: "number", description: "Max rows (1-20). Default 10." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_invoices",
      description: "Return the signed-in user's invoices/payments.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["any", "pending", "completed", "failed", "refunded"], description: "Default 'any'." },
          limit: { type: "number", description: "Max rows (1-20). Default 10." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Full-text search the published knowledge base articles and active playbooks. Use this for SAP how-to, error code, or troubleshooting questions before answering from general knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search terms." },
          sap_module: { type: "string", description: "Optional SAP module filter, e.g. FI, MM, SD." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_ticket",
      description: "Create a new support ticket on behalf of the signed-in user. Only call after the user has explicitly confirmed Title, SAP module, urgency, and description.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short ticket title (<=120 chars)." },
          description: { type: "string", description: "Detailed description of the problem." },
          sap_module: { type: "string", description: "SAP module, e.g. FI, MM, SD, BASIS." },
          urgency: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Default 'medium'." },
        },
        required: ["title", "description", "sap_module"],
        additionalProperties: false,
      },
    },
  },
];

// ----- Tool implementations (RLS via user-scoped client) -----

async function execTool(
  name: string,
  args: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  sbUser: any,
  authUserId: string,
): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
  if (name === "get_my_tickets") {
    const status = String(args.status || "any");
    let q = sbUser.from("tickets")
      .select("id, title, sap_module, urgency, status, created_at, updated_at")
      .or(`client_id.eq.${authUserId},consultant_id.eq.${authUserId}`)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status !== "any") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { tickets: data ?? [] };
  }

  if (name === "get_my_sessions") {
    const when = String(args.when || "any");
    let q = sbUser.from("sessions")
      .select("id, ticket_id, session_type, status, scheduled_at, started_at, ended_at, duration_minutes, meeting_url")
      .or(`client_id.eq.${authUserId},consultant_id.eq.${authUserId}`)
      .limit(limit);
    if (when === "upcoming") q = q.gte("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: true });
    else if (when === "past") q = q.lt("scheduled_at", new Date().toISOString()).order("scheduled_at", { ascending: false });
    else q = q.order("scheduled_at", { ascending: false });
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { sessions: data ?? [] };
  }

  if (name === "get_my_invoices") {
    const status = String(args.status || "any");
    let q = sbUser.from("payments")
      .select("id, invoice_number, amount, currency, status, due_date, description, created_at")
      .eq("client_id", authUserId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "any") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { invoices: data ?? [] };
  }

  if (name === "search_knowledge_base") {
    const query = String(args.query || "").trim();
    if (!query) return { error: "query is required" };
    // PostgREST filter grammar uses , ( ) . * and quotes: keep only plain words so user text cannot alter the filter.
    const safeQuery = query.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!safeQuery) return { articles: [], playbooks: [] };
    const sapModule = args.sap_module && /^[A-Za-z0-9 /&._-]{1,40}$/.test(String(args.sap_module)) ? String(args.sap_module) : null;
    const ilike = `%${safeQuery}%`;

    let aq = sbUser.from("knowledge_articles")
      .select("id, title, content, sap_module, tags")
      .eq("status", "published")
      .or(`title.ilike.${ilike},content.ilike.${ilike}`)
      .limit(5);
    if (sapModule) aq = aq.eq("sap_module", sapModule);
    const { data: articles } = await aq;

    let pq = sbUser.from("playbooks")
      .select("id, title, description, sap_module, category")
      .eq("is_active", true)
      .or(`title.ilike.${ilike},description.ilike.${ilike}`)
      .limit(5);
    if (sapModule) pq = pq.eq("sap_module", sapModule);
    const { data: playbooks } = await pq;

    // Trim long content so we don't blow the model context
    const trimmedArticles = (articles ?? []).map((a: { content?: string | null; [k: string]: unknown }) => ({
      ...a,
      content: typeof a.content === "string" && a.content.length > 800
        ? a.content.slice(0, 800) + "…"
        : a.content,
    }));

    return { articles: trimmedArticles, playbooks: playbooks ?? [] };
  }

  if (name === "create_ticket") {
    const title = String(args.title || "").slice(0, 200);
    const description = String(args.description || "");
    const sap_module = String(args.sap_module || "");
    const urgency = String(args.urgency || "medium");
    if (!title || !description || !sap_module) return { error: "title, description, sap_module are required" };
    const { data, error } = await sbUser
      .from("tickets")
      .insert({ client_id: authUserId, title, description, sap_module, urgency, status: "new", ticket_type: "standard" })
      .select("id, title, status")
      .single();
    if (error) return { error: error.message };
    return { created: data, link: `/client/tickets/${data.id}` };
  }

  return { error: `Unknown tool: ${name}` };
}

// ----- Main handler -----

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user: authUser }, error: authError } = await sbAuth.auth.getUser(token);
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    // User-scoped client — RLS will enforce ownership for every tool call.
    const sbUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    if (!(await withinRateLimit(adminClient(), `ai-triage:${authUser.id}`, 20, 60, true))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait before sending more requests." }),
        { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" } });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }
    let parsedBody: unknown;
    try { parsedBody = JSON.parse(bodyText); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }
    const BodySchema = z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      })).min(1).max(50),
      model: z.string().max(100).optional(),
      conversationId: z.string().uuid().optional(),
    });
    const parsed = BodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
      );
    }
    const { messages, model } = parsed.data;
    const selectedModel = model && VALID_MODELS.includes(model) ? model : DEFAULT_MODEL;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Conversation we'll grow across tool-calling rounds.
    const convo: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.slice(-20),
    ];

    const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

    // -------- Tool-calling loop (max 3 rounds, then force final answer) --------
    for (let round = 0; round < 3; round++) {
      const planResp = await fetch(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: convo,
          tools: TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });
      if (!planResp.ok) {
        if (planResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
        if (planResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Please try again later." }),
          { status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
        const t = await planResp.text();
        console.error("AI planning error:", planResp.status, t);
        return new Response(JSON.stringify({ error: "AI service unavailable" }),
          { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
      }
      const planJson = await planResp.json();
      const choice = planJson.choices?.[0];
      const msg = choice?.message;
      const toolCalls = msg?.tool_calls as Array<any> | undefined;
      if (!toolCalls || toolCalls.length === 0) {
        // No tool needed — re-issue the same prompt with stream=true so the
        // client gets token-by-token rendering (consistent with the existing UI).
        const finalResp = await fetch(GATEWAY, {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel, messages: convo, stream: true }),
        });
        if (!finalResp.ok || !finalResp.body) {
          const t = await finalResp.text();
          console.error("AI final stream error:", finalResp.status, t);
          return new Response(JSON.stringify({ error: "AI service unavailable" }),
            { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
        }
        return new Response(finalResp.body, { headers: { ...getCorsHeaders(req), "Content-Type": "text/event-stream" } });
      }

      // Append assistant tool-call message verbatim (preserves IDs)
      convo.push(msg);

      // Execute each tool and append its result
      for (const call of toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try { parsedArgs = JSON.parse(call.function?.arguments || "{}"); } catch { /* ignore */ }
        const result = await execTool(call.function?.name || "", parsedArgs, sbUser, authUser.id);
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12_000),
        });
      }
      // loop — model now has tool results; ask it again
    }

    // Safety: after 3 rounds, force a non-tool streaming reply
    const safetyResp = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel, messages: convo, stream: true }),
    });
    if (!safetyResp.ok || !safetyResp.body) {
      return new Response(JSON.stringify({ error: "AI service unavailable" }),
        { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }
    return new Response(safetyResp.body, { headers: { ...getCorsHeaders(req), "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("ai-triage-chat error:", e);
    return new Response(JSON.stringify({ error: "Request failed. Please try again." }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
  }
});
