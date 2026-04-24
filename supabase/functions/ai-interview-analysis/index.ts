import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

    const { interview_id } = await req.json();
    if (!interview_id) throw new Error("interview_id is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch interview
    const { data: interview, error: fetchErr } = await supabase
      .from("ticket_interviews")
      .select("*")
      .eq("id", interview_id)
      .single();
    if (fetchErr || !interview) throw new Error("Interview not found");

    // --- Ownership check: caller must be the client, the consultant, or an admin ---
    const { data: consultantRow } = await supabase
      .from("consultants")
      .select("user_id")
      .eq("id", interview.consultant_id)
      .single();
    const isAdmin = (await supabase.rpc("has_role", { _user_id: authUser.id, _role: "admin" })).data === true;
    const isClient = interview.client_id === authUser.id;
    const isConsultant = consultantRow?.user_id === authUser.id;
    if (!isClient && !isConsultant && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Fetch ticket info
    const { data: ticket } = await supabase
      .from("tickets")
      .select("title, sap_module, description, urgency")
      .eq("id", interview.ticket_id)
      .single();

    // Fetch consultant profile
    const { data: consultant } = await supabase
      .from("consultants")
      .select("bio, rating, total_reviews, languages, industries")
      .eq("id", interview.consultant_id)
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", consultant ? (await supabase.from("consultants").select("user_id").eq("id", interview.consultant_id).single()).data?.user_id : "")
      .maybeSingle();

    // Call AI for analysis
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const durationMin = interview.started_at && interview.ended_at
      ? Math.round((new Date(interview.ended_at).getTime() - new Date(interview.started_at).getTime()) / 60000)
      : null;

    const prompt = `You are an expert HR and technical interviewer analyst. Analyze this pre-work interview between a client and an SAP consultant.

INTERVIEW CONTEXT:
- Ticket: "${ticket?.title || "Unknown"}" (${ticket?.sap_module || "General"})
- Ticket Description: ${ticket?.description || "N/A"}
- Urgency: ${ticket?.urgency || "medium"}
- Consultant: ${profile?.display_name || "Unknown"}
- Consultant Bio: ${consultant?.bio || "N/A"}
- Rating: ${consultant?.rating || "N/A"}/5 (${consultant?.total_reviews || 0} reviews)
- Languages: ${consultant?.languages?.join(", ") || "N/A"}
- Industries: ${consultant?.industries?.join(", ") || "N/A"}
- Interview Duration: ${durationMin ? durationMin + " minutes" : "N/A"}
- Client Notes: ${interview.client_notes || "None"}

Please provide a comprehensive analysis in the following JSON structure. Be detailed and professional:

{
  "summary": "A detailed 3-4 paragraph summary of the interview assessment, covering the consultant's technical readiness, communication skills, and overall fit for this ticket.",
  "body_language_analysis": {
    "confidence_level": "high/medium/low with explanation",
    "engagement_score": "1-10 with explanation",
    "eye_contact": "assessment of attentiveness",
    "facial_expressions": "professional/neutral/concerning with details",
    "posture": "assessment of body language",
    "communication_clarity": "rating 1-10 with notes",
    "active_listening": "assessment of listening skills",
    "emotional_intelligence": "assessment"
  },
  "facial_verification": {
    "identity_match": "verified/unverified/inconclusive",
    "confidence_score": "percentage",
    "profile_consistency": "does the person match their profile description",
    "professional_appearance": "assessment"
  },
  "recommendation": "A clear, actionable recommendation on whether to proceed with this consultant for the ticket. Include specific strengths, potential risks, and suggested next steps."
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert interview analyst. Always respond with valid JSON only, no markdown." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${status}`);
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    let analysis;
    try {
      const jsonStr = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(jsonStr);
    } catch {
      analysis = {
        summary: rawContent,
        body_language_analysis: {},
        facial_verification: {},
        recommendation: "Analysis could not be fully structured. Please review the summary above.",
      };
    }

    // Update the interview record
    const { error: updateErr } = await supabase
      .from("ticket_interviews")
      .update({
        ai_summary: analysis.summary || rawContent,
        body_language_analysis: analysis.body_language_analysis || {},
        facial_verification_result: analysis.facial_verification || {},
        overall_recommendation: analysis.recommendation || "",
      })
      .eq("id", interview_id);

    if (updateErr) throw updateErr;

    // Notify client
    await supabase.from("notifications").insert({
      user_id: interview.client_id,
      title: "Interview Analysis Ready",
      body: `AI analysis for your pre-work interview is now available.`,
      type: "interview",
      link: `/client/tickets/${interview.ticket_id}`,
    });

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Interview analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
