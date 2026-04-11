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
    const { cv_text } = await req.json();
    if (!cv_text || typeof cv_text !== "string" || cv_text.trim().length < 20) {
      return new Response(JSON.stringify({ error: "cv_text is required and must be at least 20 characters" }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are a CV/resume parser for SAP consultants. Extract structured data from the CV text provided. Return ONLY valid JSON with no markdown.`;

    const userPrompt = `Parse the following CV text and extract structured data. Return a JSON object with these fields:

{
  "display_name": "Full name",
  "bio": "A 2-3 sentence professional summary",
  "hourly_rate": null or number estimate,
  "nationality": "string or null",
  "city": "string or null",
  "country": "string or null",
  "languages": ["en", "ar", ...],
  "linkedin_url": "string or null",
  "github_url": "string or null",
  "personal_website": "string or null",
  "skills": [
    { "sap_module": "SAP FI/CO", "proficiency_level": 1-5, "years_experience": number, "certified": false }
  ],
  "certifications": [
    { "name": "cert name", "issuer": "SAP or other", "issue_date": "YYYY-MM-DD or null", "expiry_date": "YYYY-MM-DD or null" }
  ],
  "work_history": [
    { "company_name": "", "job_title": "", "start_date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null", "description": "", "is_current": false }
  ],
  "education": [
    { "institution": "", "degree": "", "field_of_study": "", "start_year": null, "end_year": null }
  ],
  "projects": [
    { "project_name": "", "client_industry": "", "sap_modules": ["SAP FI/CO"], "description": "", "duration_months": null, "role": "" }
  ]
}

CV Text:
${cv_text.substring(0, 15000)}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Please add funds." }), {
          status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI error:", aiResp.status, t);
      throw new Error("AI gateway error");
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";

    let parsed;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      throw new Error("Failed to parse CV data");
    }

    return new Response(JSON.stringify({ profile: parsed }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
