import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit } from "../_shared/security.ts";

const BodySchema = z.object({
  frames: z.array(
    z.string().max(400_000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/),
  ).min(1).max(20),
});

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

    if (!(await withinRateLimit(adminClient(), `ai-body-language:${authUser.id}`, 10, 60, true))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait before sending more requests." }), {
        status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }
    const { frames } = parsed.data;

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
        model: "openai/gpt-6-astra",
        reasoning_effort: "low",
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
    return new Response(JSON.stringify({ error: "Request failed. Please try again." }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
