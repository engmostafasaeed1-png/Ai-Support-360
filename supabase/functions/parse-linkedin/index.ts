import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  linkedin_url: z.string().url().regex(/^https?:\/\/(www\.)?linkedin\.com\/in\/.+/i, "Invalid LinkedIn URL"),
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
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const { linkedin_url } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Use AI to generate a realistic profile structure from the LinkedIn URL
    // Note: Real scraping would require a third-party API (Proxycurl, etc.)
    const systemPrompt = `You are a professional profile data generator for SAP consultants. Given a LinkedIn URL, generate realistic placeholder profile data that matches what a typical SAP consultant might have. This is for demo/testing purposes. Return ONLY valid JSON.`;

    const userPrompt = `Generate a realistic SAP consultant profile for the LinkedIn URL: ${linkedin_url}

Return a JSON object with:
{
  "display_name": "Full name (extract from URL slug if possible)",
  "bio": "A professional 2-3 sentence summary",
  "linkedin_url": "${linkedin_url}",
  "nationality": "string",
  "city": "string",
  "country": "string",
  "languages": ["en"],
  "skills": [
    { "sap_module": "SAP module name", "proficiency_level": 1-5, "years_experience": number, "certified": boolean }
  ],
  "certifications": [
    { "name": "cert name", "issuer": "SAP", "issue_date": "YYYY-MM-DD or null", "expiry_date": "YYYY-MM-DD or null" }
  ],
  "work_history": [
    { "company_name": "", "job_title": "", "start_date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null", "description": "", "is_current": false }
  ],
  "education": [
    { "institution": "", "degree": "", "field_of_study": "", "start_year": null, "end_year": null }
  ],
  "projects": [
    { "project_name": "", "client_industry": "", "sap_modules": [], "description": "", "duration_months": null, "role": "" }
  ]
}`;

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
      throw new Error("AI gateway error");
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";

    let aiParsed;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      aiParsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawContent);
      throw new Error("Failed to parse LinkedIn data");
    }

    return new Response(JSON.stringify({ profile: aiParsed }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
