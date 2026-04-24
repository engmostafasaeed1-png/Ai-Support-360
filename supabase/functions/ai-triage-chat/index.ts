import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const ALLOWED_ORIGINS = [
  'https://smartsapsupport.qurtubatalks.com',
  'https://www.qurtubatalks.com',
  'http://localhost:8080',
  'http://localhost:5173',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

const VALID_MODELS = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
];

const DEFAULT_MODEL = "google/gemini-2.5-flash";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;
const MAX_BODY_SIZE = 50 * 1024;

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

const SYSTEM_PROMPT = `You are Qurtuba AI, the smart SAP support triage assistant for Qurtuba Talks — a premium SAP consulting platform.

Your role is to help users describe their SAP issues clearly and prepare them to submit a support ticket. You should:

1. **Understand the problem**: Ask clarifying questions about the SAP issue (which module, what error, when it started, impact).
2. **Suggest SAP module**: Based on the description, suggest the most relevant SAP module (e.g., SAP FI, SAP MM, SAP SD, SAP PP, SAP HR/HCM, SAP BASIS, SAP ABAP, SAP BW/BI, SAP CRM, SAP S/4HANA, SAP Ariba, SAP SuccessFactors, etc.).
3. **Suggest urgency**: Recommend an urgency level (low, medium, high, critical) based on business impact.
4. **Summarize for ticket**: When you have enough info, provide a structured summary with: Title, Description, SAP Module, and Suggested Urgency.

Guidelines:
- Be concise and professional but friendly.
- Use markdown formatting for readability.
- If the user is just chatting or asking general questions about the platform, answer helpfully.
- If unsure about the module, ask follow-up questions.
- Always respond in the same language the user writes in.
- When you have enough information, format a ticket summary like this:

---
**📋 Ticket Summary**
- **Title**: [concise title]
- **SAP Module**: [module name]
- **Urgency**: [low/medium/high/critical]
- **Description**: [detailed description]

*Ready to submit? Go to **New Request** to create this ticket!*
---`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    // Verify authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );
    const { data: { user: authUser }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    // Rate limit check
    const clientId = req.headers.get("authorization")?.slice(-16) || req.headers.get("x-client-info") || "anon";
    if (!checkRateLimit(clientId)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait before sending more requests." }),
        { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" } });
    }

    // Body size check
    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    const BodySchema = z.object({
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(8000),
      })).min(1).max(50),
      model: z.string().max(100).optional(),
      conversationId: z.string().uuid().optional(),
    });

    const parsed = BodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }
    const { messages, model } = parsed.data;

    const selectedModel = model && VALID_MODELS.includes(model) ? model : DEFAULT_MODEL;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.slice(-20),
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please try again later." }),
          { status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI service unavailable" }),
        { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...getCorsHeaders(req), "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-triage-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
