import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { interview_id, messages, action, lang } = await req.json();
    if (!interview_id) throw new Error("interview_id is required");
    const isArabic = lang === 'ar';

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get interview + consultant info
    const { data: interview, error: intErr } = await supabase
      .from("interview_sessions")
      .select("consultant_id, interview_type, status")
      .eq("id", interview_id)
      .single();
    if (intErr || !interview) throw new Error("Interview not found");

    // Get consultant skills for context
    const { data: skills } = await supabase
      .from("consultant_skills")
      .select("sap_module, proficiency_level, years_experience")
      .eq("consultant_id", interview.consultant_id);

    const { data: certs } = await supabase
      .from("certifications")
      .select("name, issuer")
      .eq("consultant_id", interview.consultant_id);

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", (await supabase.from("consultants").select("user_id").eq("id", interview.consultant_id).single()).data?.user_id || "")
      .maybeSingle();

    const moduleList = (skills || []).map(s => `${s.sap_module} (level ${s.proficiency_level}, ${s.years_experience}yr)`).join(", ");
    const certList = (certs || []).map(c => `${c.name} (${c.issuer})`).join(", ");
    const consultantName = profile?.display_name || "Consultant";

    // If action is "evaluate", do final evaluation
    if (action === "evaluate") {
      const conversationText = (messages || [])
        .map((m: any) => `${m.role === "user" ? "Consultant" : "Interviewer"}: ${m.content}`)
        .join("\n\n");

      const evalPrompt = `You just conducted a conversational SAP interview with ${consultantName}. 
Based on the entire conversation below, evaluate their skills.

Consultant's listed skills: ${moduleList || "General SAP"}
Certifications: ${certList || "None listed"}

Conversation:
${conversationText}

Provide evaluation as JSON:
{
  "technical_score": number (0-100),
  "soft_skills_score": number (0-100),
  "overall_score": number (0-100),
  "summary": "2-3 sentence summary of performance",
  "strengths": ["strength1", "strength2"],
  "improvements": ["area1", "area2"],
  "detailed_feedback": "A paragraph of detailed feedback"
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
            { role: "user", content: evalPrompt },
          ],
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
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
        throw new Error("Failed to parse evaluation");
      }

      // Save conversation as answers for records
      const userMessages = (messages || []).filter((m: any) => m.role === "user");
      const aiMessages = (messages || []).filter((m: any) => m.role === "assistant");
      
      for (let i = 0; i < Math.min(userMessages.length, 10); i++) {
        await supabase.from("interview_answers").insert({
          interview_id,
          question: aiMessages[i]?.content?.slice(0, 500) || `Discussion point ${i + 1}`,
          answer_transcript: userMessages[i]?.content || "",
          category: "technical",
          question_order: i + 1,
          score: evaluation.overall_score,
          ai_feedback: i === 0 ? evaluation.detailed_feedback : null,
        });
      }

      // Update interview session
      await supabase.from("interview_sessions").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        overall_score: evaluation.overall_score,
        technical_score: evaluation.technical_score,
        soft_skills_score: evaluation.soft_skills_score,
        ai_summary: evaluation.summary,
      }).eq("id", interview_id);

      return new Response(JSON.stringify({ evaluation }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Regular chat — stream the AI response
    if (interview.status === "pending") {
      await supabase.from("interview_sessions").update({
        status: "in_progress",
        started_at: new Date().toISOString(),
      }).eq("id", interview_id);
    }

    const systemPrompt = isArabic
      ? `أنت مُحاور الذكاء الاصطناعي في قرطبة — محاور تقني ودود ومحترف في SAP تجري مقابلة فيديو مع ${consultantName}.

مهارات المستشار: ${moduleList || "SAP عام"}
الشهادات: ${certList || "لم تُذكر"}

إرشادات المقابلة:
- أجرِ محادثة طبيعية — ليس أسئلة وأجوبة جامدة
- ابدأ بترحيب حار واطلب منه تقديم نفسه
- اطرح أسئلة متابعة بناءً على إجاباته
- تعمق في مجالات خبرته
- غطِّ المعرفة التقنية والسيناريوهات الواقعية وحل المشكلات ومهارات التواصل
- كن مشجعاً ولكن دقيقاً — ابحث عن العمق
- حافظ على إجاباتك موجزة (2-4 جمل عادةً)
- بعد حوالي 8-12 تبادل، أنهِ المقابلة بشكل طبيعي
- اخلط بين أسئلة SAP التقنية والأسئلة السلوكية/الموقفية
- أشر إلى وحداته وخبرته المحددة عند طرح الأسئلة

أنت تتحدث عبر مكالمة فيديو، فكن ودوداً وطبيعياً. تحدث بالعربية دائماً.`
      : `You are Qurtuba AI Interviewer — a friendly, professional SAP technical interviewer conducting a video-call interview with ${consultantName}.

Consultant's skills: ${moduleList || "General SAP"}
Certifications: ${certList || "None listed"}

INTERVIEW GUIDELINES:
- Have a natural, conversational interview — NOT a rigid Q&A
- Start with a warm greeting and ask them to introduce themselves
- Ask follow-up questions based on their responses
- Dive deeper into their areas of expertise
- Cover technical knowledge, real-world scenarios, problem-solving, and communication skills
- Be encouraging but thorough — probe for depth
- Keep responses concise (2-4 sentences typically), like a real conversation
- After about 8-12 exchanges, naturally wrap up the interview
- Mix technical SAP questions with situational/behavioral ones
- Reference their specific modules and experience when asking questions

You are speaking via video call, so be personable and natural.`;

    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...(messages || []),
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: chatMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
