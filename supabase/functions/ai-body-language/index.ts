import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { frames } = await req.json();
    if (!frames?.length) throw new Error("No frames provided");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Send frames (base64 images) to a vision model for body language analysis
    const imageContent = frames.slice(0, 8).map((frame: string, i: number) => ({
      type: "image_url" as const,
      image_url: { url: frame },
    }));

    const prompt = `You are an expert body language and facial expression analyst evaluating a candidate during a video interview.

Analyze these ${imageContent.length} snapshots captured periodically during the interview. For each observable aspect, provide a score (0-100) and brief feedback.

Evaluate:
1. **Eye Contact & Gaze**: Are they looking at the camera? Consistent or wandering?
2. **Facial Expressions**: Confident, nervous, engaged, neutral, smiling appropriately?
3. **Posture & Body Language**: Upright, slouching, open/closed body language?
4. **Confidence Level**: Overall impression of confidence and composure
5. **Engagement**: Do they appear interested, attentive, and present?
6. **Professional Presence**: Overall professional appearance and demeanor

Return ONLY valid JSON:
{
  "eye_contact_score": number,
  "facial_expression_score": number,
  "posture_score": number,
  "confidence_score": number,
  "engagement_score": number,
  "professional_presence_score": number,
  "overall_body_language_score": number,
  "summary": "2-3 sentence overall assessment",
  "observations": ["observation1", "observation2", "observation3"],
  "tips": ["improvement tip 1", "improvement tip 2"]
}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert body language analyst. Always respond with valid JSON only." },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...imageContent,
            ],
          },
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
      throw new Error("AI vision gateway error");
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";
    let analysis;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse:", rawContent);
      throw new Error("Failed to parse body language analysis");
    }

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
