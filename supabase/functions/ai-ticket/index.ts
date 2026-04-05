import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5-nano",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "openai/gpt-5.2",
];

const DEFAULT_MODEL = "google/gemini-3-flash-preview";

function aiRequest(apiKey: string, systemPrompt: string, userPrompt: string, tools: any[], toolChoice: any, model: string) {
  return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: toolChoice,
    }),
  });
}

function handleAiError(status: number) {
  if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return null;
}

function parseToolResult(data: any) {
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  return toolCall ? JSON.parse(toolCall.function.arguments) : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, title, description, sap_module, urgency, preferred_language, model } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const selectedModel = model && VALID_MODELS.includes(model) ? model : DEFAULT_MODEL;

    if (action === "categorize") {
      const response = await aiRequest(
        LOVABLE_API_KEY,
        "You are an SAP support triage assistant. Analyze the ticket and return structured data.",
        `Analyze this SAP support ticket:\nTitle: ${title}\nDescription: ${description}\n${sap_module ? `Selected Module: ${sap_module}` : ''}\n\nProvide categorization and priority assessment.`,
        [{
          type: "function",
          function: {
            name: "categorize_ticket",
            description: "Categorize an SAP support ticket",
            parameters: {
              type: "object",
              properties: {
                suggested_module: { type: "string", description: "Most relevant SAP module" },
                suggested_priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
                category: { type: "string", description: "Issue category" },
                tip: { type: "string", description: "Brief helpful tip (1-2 sentences)" },
                confidence: { type: "number", description: "Confidence score 0-100" }
              },
              required: ["suggested_module", "suggested_priority", "category", "tip", "confidence"],
              additionalProperties: false
            }
          }
        }],
        { type: "function", function: { name: "categorize_ticket" } },
        selectedModel
      );

      if (!response.ok) {
        const errResp = handleAiError(response.status);
        if (errResp) return errResp;
        throw new Error(`AI gateway error: ${response.status}`);
      }

      return new Response(JSON.stringify({ result: parseToolResult(await response.json()) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "summarize") {
      const response = await aiRequest(
        LOVABLE_API_KEY,
        "You are an SAP expert. Provide a concise summary and actionable resolution steps.",
        `SAP Ticket:\nModule: ${sap_module}\nTitle: ${title}\nDescription: ${description}\nUrgency: ${urgency}\n\nProvide a summary and suggested resolution steps.`,
        [{
          type: "function",
          function: {
            name: "summarize_ticket",
            description: "Generate ticket summary and resolution steps",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string" },
                resolution_steps: { type: "array", items: { type: "string" } },
                estimated_complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
                relevant_tcodes: { type: "array", items: { type: "string" } }
              },
              required: ["summary", "resolution_steps", "estimated_complexity"],
              additionalProperties: false
            }
          }
        }],
        { type: "function", function: { name: "summarize_ticket" } },
        selectedModel
      );

      if (!response.ok) {
        const errResp = handleAiError(response.status);
        if (errResp) return errResp;
        throw new Error(`AI gateway error: ${response.status}`);
      }

      return new Response(JSON.stringify({ result: parseToolResult(await response.json()) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "match") {
      const response = await aiRequest(
        LOVABLE_API_KEY,
        "You are an SAP consultant matching engine. Recommend the best consultant profile traits for this ticket.",
        `Match a consultant for this ticket:\nModule: ${sap_module}\nTitle: ${title}\nDescription: ${description}\nUrgency: ${urgency}\n\nWhat consultant skills and experience are needed?`,
        [{
          type: "function",
          function: {
            name: "match_consultant",
            description: "Recommend ideal consultant traits for a ticket",
            parameters: {
              type: "object",
              properties: {
                required_skills: { type: "array", items: { type: "string" } },
                min_experience_years: { type: "number" },
                preferred_certifications: { type: "array", items: { type: "string" } },
                matching_rationale: { type: "string" }
              },
              required: ["required_skills", "min_experience_years", "matching_rationale"],
              additionalProperties: false
            }
          }
        }],
        { type: "function", function: { name: "match_consultant" } },
        selectedModel
      );

      if (!response.ok) {
        const errResp = handleAiError(response.status);
        if (errResp) return errResp;
        throw new Error(`AI gateway error: ${response.status}`);
      }

      return new Response(JSON.stringify({ result: parseToolResult(await response.json()) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "match_consultants") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: consultants, error: consultantsError } = await supabase
        .from("consultants")
        .select(`
          id, user_id, bio, hourly_rate, currency, timezone, languages, industries,
          availability_status, rating, total_reviews, response_time_minutes,
          verification_status, ai_skills_score
        `)
        .in("verification_status", ["verified", "under_review"])
        .limit(50);

      if (consultantsError) throw new Error(`DB error: ${consultantsError.message}`);
      if (!consultants || consultants.length === 0) {
        return new Response(JSON.stringify({ result: { recommendations: [], rationale: "No consultants available." } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const consultantIds = consultants.map(c => c.id);
      const { data: skills } = await supabase
        .from("consultant_skills")
        .select("consultant_id, sap_module, proficiency_level, years_experience, certified")
        .in("consultant_id", consultantIds);

      const { data: certs } = await supabase
        .from("certifications")
        .select("consultant_id, name, verified")
        .in("consultant_id", consultantIds);

      const userIds = consultants.map(c => c.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .in("user_id", userIds);

      const enrichedConsultants = consultants.map(c => {
        const consultantSkills = (skills || []).filter(s => s.consultant_id === c.id);
        const consultantCerts = (certs || []).filter(cert => cert.consultant_id === c.id);
        const profile = (profiles || []).find(p => p.user_id === c.user_id);

        return {
          id: c.id,
          name: profile?.display_name || "Consultant",
          avatar_url: profile?.avatar_url,
          bio: c.bio,
          hourly_rate: c.hourly_rate,
          currency: c.currency,
          timezone: c.timezone,
          languages: c.languages,
          industries: c.industries,
          availability: c.availability_status,
          rating: c.rating,
          total_reviews: c.total_reviews,
          response_time_minutes: c.response_time_minutes,
          verification_status: c.verification_status,
          skills: consultantSkills.map(s => ({
            module: s.sap_module,
            proficiency: s.proficiency_level,
            years: s.years_experience,
            certified: s.certified,
          })),
          certifications: consultantCerts.map(cert => ({
            name: cert.name,
            verified: cert.verified,
          })),
        };
      });

      const rankResponse = await aiRequest(
        LOVABLE_API_KEY,
        `You are an advanced SAP consultant matching engine. You must rank the provided consultants against the client's ticket requirements.

Scoring criteria (weights):
- SAP module & skill match (35%): Does the consultant have skills in the required SAP module? Higher proficiency and more years = higher score.
- Industry experience (15%): Does the consultant's industry experience align with the ticket context?
- Language match (10%): Does the consultant speak the client's preferred language?
- Availability (15%): Is the consultant currently available? Available > busy > offline.
- Rating & reviews (10%): Higher rating and more reviews = more reliable.
- Response time (10%): Lower response time = better for urgent tickets.
- Certifications (5%): Relevant verified certifications boost the score.

Return the top 5 consultants ranked by overall match score (0-100). Provide a specific reason why each is a good match.`,
        `Client Ticket:
Module: ${sap_module}
Title: ${title}
Description: ${description}
Urgency: ${urgency}
Preferred Language: ${preferred_language || 'en'}

Available Consultants:
${JSON.stringify(enrichedConsultants, null, 2)}

Rank the top consultants for this ticket.`,
        [{
          type: "function",
          function: {
            name: "rank_consultants",
            description: "Return ranked consultant recommendations",
            parameters: {
              type: "object",
              properties: {
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      consultant_id: { type: "string", description: "The consultant's id" },
                      match_score: { type: "number", description: "Overall match score 0-100" },
                      match_reason: { type: "string", description: "2-3 sentence explanation of why this consultant is a good match" },
                      strengths: { type: "array", items: { type: "string" }, description: "Top 3 strengths for this ticket" },
                      skill_match_score: { type: "number", description: "Skill match sub-score 0-100" },
                      availability_score: { type: "number", description: "Availability sub-score 0-100" },
                    },
                    required: ["consultant_id", "match_score", "match_reason", "strengths"],
                    additionalProperties: false,
                  },
                  description: "Top 5 ranked consultants"
                },
                overall_rationale: { type: "string", description: "Brief explanation of the ranking methodology used" }
              },
              required: ["recommendations", "overall_rationale"],
              additionalProperties: false
            }
          }
        }],
        { type: "function", function: { name: "rank_consultants" } },
        selectedModel
      );

      if (!rankResponse.ok) {
        const errResp = handleAiError(rankResponse.status);
        if (errResp) return errResp;
        throw new Error(`AI gateway error: ${rankResponse.status}`);
      }

      const rankData = await rankResponse.json();
      const rankResult = parseToolResult(rankData);

      if (rankResult?.recommendations) {
        rankResult.recommendations = rankResult.recommendations.map((rec: any) => {
          const consultant = enrichedConsultants.find(c => c.id === rec.consultant_id);
          return {
            ...rec,
            name: consultant?.name || "Consultant",
            avatar_url: consultant?.avatar_url,
            hourly_rate: consultant?.hourly_rate,
            currency: consultant?.currency,
            rating: consultant?.rating,
            total_reviews: consultant?.total_reviews,
            availability: consultant?.availability,
            response_time_minutes: consultant?.response_time_minutes,
            languages: consultant?.languages,
            verification_status: consultant?.verification_status,
            top_skills: consultant?.skills?.slice(0, 3).map((s: any) => s.module) || [],
          };
        });
      }

      return new Response(JSON.stringify({ result: rankResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("ai-ticket error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
