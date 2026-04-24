import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({ interview_id: z.string().uuid() });

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
    const { interview_id } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get interview + consultant info
    const { data: interview, error: intErr } = await supabase
      .from("interview_sessions")
      .select("consultant_id, interview_type")
      .eq("id", interview_id)
      .single();
    if (intErr || !interview) throw new Error("Interview not found");

    // --- Ownership check: caller must be the consultant, requested_by user, or admin ---
    const { data: consultantRow } = await supabase
      .from("consultants")
      .select("user_id")
      .eq("id", interview.consultant_id)
      .single();
    const isAdmin = (await supabase.rpc("has_role", { _user_id: authUser.id, _role: "admin" })).data === true;
    if (consultantRow?.user_id !== authUser.id && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Get consultant skills
    const { data: skills } = await supabase
      .from("consultant_skills")
      .select("sap_module, proficiency_level, years_experience")
      .eq("consultant_id", interview.consultant_id);

    const { data: certs } = await supabase
      .from("certifications")
      .select("name, issuer")
      .eq("consultant_id", interview.consultant_id);

    const moduleList = (skills || []).map(s => `${s.sap_module} (level ${s.proficiency_level}, ${s.years_experience}yr)`).join(", ");
    const certList = (certs || []).map(c => `${c.name} (${c.issuer})`).join(", ");

    const prompt = `You are an SAP technical interviewer. Generate exactly 6 interview questions for an SAP consultant.

Consultant's skills: ${moduleList || "General SAP"}
Certifications: ${certList || "None listed"}

Generate a mix of:
- 3 technical questions about their SAP modules
- 1 scenario-based question  
- 1 soft skills question
- 1 problem-solving question

Return a JSON array of objects with fields: "question", "category" (one of: technical, scenario, soft_skills, problem_solving), "difficulty" (1-5).
Return ONLY the JSON array, no other text.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert SAP interviewer. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "[]";
    
    // Parse JSON from response (handle markdown code blocks)
    let questions;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      questions = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      throw new Error("Failed to parse AI response");
    }

    // Save questions to interview_answers
    const answersToInsert = questions.map((q: any, i: number) => ({
      interview_id,
      question: q.question,
      category: q.category || "technical",
      question_order: i + 1,
    }));

    const { error: insertErr } = await supabase
      .from("interview_answers")
      .insert(answersToInsert);
    if (insertErr) throw insertErr;

    // Update interview status
    await supabase
      .from("interview_sessions")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", interview_id);

    return new Response(JSON.stringify({ questions }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
