import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit } from "../_shared/security.ts";

const BodySchema = z.object({
  cv_text: z.string().trim().min(20).max(100_000).optional(),
  file_base64: z.string().max(14_000_000).optional(),
  mime_type: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ]).optional(),
  source_path: z.string().max(300).optional(),
  save: z.boolean().optional(),
}).refine((b) => !!b.cv_text || (!!b.file_base64 && !!b.mime_type), { message: "cv_text or file required" });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const JSZip = (await import("https://esm.sh/jszip@3.10.1")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

    if (!(await withinRateLimit(adminClient(), `parse-cv:${authUser.id}`, 10, 60, true))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait before sending more requests." }), {
        status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;
    let cv_text = body.cv_text ?? "";
    let pdfDataUrl: string | null = null;
    if (!cv_text && body.file_base64) {
      if (body.mime_type === "application/pdf") pdfDataUrl = `data:application/pdf;base64,${body.file_base64}`;
      else if (body.mime_type === "text/plain") cv_text = new TextDecoder().decode(b64ToBytes(body.file_base64));
      else cv_text = await docxText(b64ToBytes(body.file_base64));
      if (!pdfDataUrl && cv_text.trim().length < 20) {
        return new Response(JSON.stringify({ error: "Could not read text from this file." }), {
          status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
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
  ],
  "matching_summary": "A dense 120-200 word third-person summary of the consultant's expertise for matching to support tickets: SAP modules, sub-areas, processes, industries, typical problems solved, versions (ECC/S/4HANA), integrations. Use ONLY facts stated in the CV, never invent experience. No personal contact details, no employer names.",
  "expertise_keywords": ["up to 40 short keywords: modules, t-codes, processes, technologies"],
  "plain_text": ${pdfDataUrl ? '"The CV plain text with contact details (email, phone, address) removed, max 8000 characters"' : "null"}
}
${pdfDataUrl ? "The CV is attached as a PDF." : `CV Text:
${cv_text.substring(0, 15000)}`}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        reasoning_effort: "low",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: pdfDataUrl
              ? [{ type: "text", text: userPrompt }, { type: "file", file: { filename: "cv.pdf", file_data: pdfDataUrl } }]
              : userPrompt,
          },
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

    let aiParsed;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      aiParsed = JSON.parse(cleaned);
    } catch {
      // Never log the model output: it contains personal CV details.
      console.error("Failed to parse AI response", { length: typeof rawContent === "string" ? rawContent.length : 0 });
      throw new Error("Failed to parse CV data");
    }

    if (body.save) {
      const stripContacts = (t: string) => t
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
        .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
      const text = stripContacts(String(pdfDataUrl ? aiParsed.plain_text ?? "" : cv_text)).slice(0, 20000) || null;
      const keywords = Array.isArray(aiParsed.expertise_keywords)
        ? aiParsed.expertise_keywords.map((k: unknown) => String(k).slice(0, 60)).filter(Boolean).slice(0, 40)
        : [];
      const { data: me } = await adminClient().from("consultants").select("id").eq("user_id", authUser.id).maybeSingle();
      const { error: saveErr } = !me ? { error: { message: "no consultant row" } } : await adminClient().from("consultant_cv_profiles").upsert({
        consultant_id: me.id,
        cv_text: text,
        matching_summary: aiParsed.matching_summary ? stripContacts(String(aiParsed.matching_summary)).slice(0, 2000) : null,
        expertise_keywords: keywords,
        source_path: body.source_path ?? null,
        parsed_at: new Date().toISOString(),
      });
      if (saveErr) console.error("CV profile save failed:", saveErr.message);
    }
    delete aiParsed.plain_text;

    return new Response(JSON.stringify({ profile: aiParsed }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: "Request failed. Please try again." }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
