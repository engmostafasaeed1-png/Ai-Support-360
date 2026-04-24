import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  interview_id: z.string().uuid(),
  answers: z.array(z.unknown()).min(1),
});

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders(req) });

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

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    const { interview_id, answers } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Ownership check: caller must be the consultant or an admin ---
    const { data: session } = await supabase
      .from("interview_sessions")
      .select("consultant_id")
      .eq("id", interview_id)
      .single();
    if (!session) {
      return new Response(JSON.stringify({ error: "Interview not found" }), {
        status: 404, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const { data: consultant } = await supabase
      .from("consultants")
      .select("user_id")
      .eq("id", session.consultant_id)
      .single();
    const isAdmin = (await supabase.rpc("has_role", { _user_id: authUser.id, _role: "admin" })).data === true;
    if (consultant?.user_id !== authUser.id && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Build evaluation prompt
    const qaText = answers.map((a: any, i: number) =>
      `Q${i + 1} [${a.category}]: ${a.question}\nAnswer: ${a.answer || "(no answer)"}`
    ).join("\n\n");

    const prompt = `Evaluate these SAP consultant interview answers. For each answer, provide:
- score (0-100)
- feedback (1-2 sentences)

Then provide overall scores and a brief summary.

${qaText}

Return JSON with this exact structure:
{
  "answers": [{"score": number, "feedback": "string"}],
  "technical_score": number,
  "soft_skills_score": number,
  "overall_score": number,
  "summary": "string"
}
Return ONLY valid JSON.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert SAP interview evaluator. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";
    
    let evaluation;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      evaluation = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse:", rawContent);
      throw new Error("Failed to parse evaluation");
    }

    // Update each answer with score and feedback
    for (let i = 0; i < answers.length; i++) {
      const evalAnswer = evaluation.answers?.[i];
      const ans = answers[i] as { id?: string; answer?: string };
      if (evalAnswer && ans?.id) {
        await supabase
          .from("interview_answers")
          .update({
            answer_transcript: ans.answer,
            score: evalAnswer.score,
            ai_feedback: evalAnswer.feedback,
          })
          .eq("id", ans.id);
      }
    }

    // Update interview session
    await supabase
      .from("interview_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        overall_score: evaluation.overall_score,
        technical_score: evaluation.technical_score,
        soft_skills_score: evaluation.soft_skills_score,
        ai_summary: evaluation.summary,
      })
      .eq("id", interview_id);

    return new Response(JSON.stringify({ evaluation }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
