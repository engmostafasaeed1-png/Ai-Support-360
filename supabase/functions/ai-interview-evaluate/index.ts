import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { interview_id, answers } = await req.json();
    if (!interview_id || !answers?.length) throw new Error("interview_id and answers are required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
        model: "google/gemini-3-flash-preview",
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
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      if (evalAnswer && answers[i].id) {
        await supabase
          .from("interview_answers")
          .update({
            answer_transcript: answers[i].answer,
            score: evalAnswer.score,
            ai_feedback: evalAnswer.feedback,
          })
          .eq("id", answers[i].id);
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
