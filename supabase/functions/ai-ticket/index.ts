import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, title, description, sap_module, urgency } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (action === "categorize") {
      // AI auto-categorization and priority suggestion
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are an SAP support triage assistant. Analyze the ticket and return structured data.`
            },
            {
              role: "user",
              content: `Analyze this SAP support ticket:
Title: ${title}
Description: ${description}
${sap_module ? `Selected Module: ${sap_module}` : ''}

Provide categorization and priority assessment.`
            }
          ],
          tools: [{
            type: "function",
            function: {
              name: "categorize_ticket",
              description: "Categorize an SAP support ticket with suggested module, priority, and tips",
              parameters: {
                type: "object",
                properties: {
                  suggested_module: { type: "string", description: "Most relevant SAP module (e.g. SAP S/4HANA, SAP FI/CO, SAP MM)" },
                  suggested_priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
                  category: { type: "string", description: "Issue category (e.g. Configuration, Bug, Performance, Authorization)" },
                  tip: { type: "string", description: "Brief helpful tip for the user about their issue (1-2 sentences)" },
                  confidence: { type: "number", description: "Confidence score 0-100" }
                },
                required: ["suggested_module", "suggested_priority", "category", "tip", "confidence"],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: "function", function: { name: "categorize_ticket" } },
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      const result = toolCall ? JSON.parse(toolCall.function.arguments) : null;

      return new Response(JSON.stringify({ result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "summarize") {
      // AI summary and resolution suggestions
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: "You are an SAP expert. Provide a concise summary and actionable resolution steps."
            },
            {
              role: "user",
              content: `SAP Ticket:
Module: ${sap_module}
Title: ${title}
Description: ${description}
Urgency: ${urgency}

Provide a summary and suggested resolution steps.`
            }
          ],
          tools: [{
            type: "function",
            function: {
              name: "summarize_ticket",
              description: "Generate ticket summary and resolution steps",
              parameters: {
                type: "object",
                properties: {
                  summary: { type: "string", description: "2-3 sentence summary of the issue" },
                  resolution_steps: {
                    type: "array",
                    items: { type: "string" },
                    description: "3-5 actionable resolution steps"
                  },
                  estimated_complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
                  relevant_tcodes: {
                    type: "array",
                    items: { type: "string" },
                    description: "Relevant SAP transaction codes"
                  }
                },
                required: ["summary", "resolution_steps", "estimated_complexity"],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: "function", function: { name: "summarize_ticket" } },
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      const result = toolCall ? JSON.parse(toolCall.function.arguments) : null;

      return new Response(JSON.stringify({ result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "match") {
      // AI consultant matching recommendation
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: "You are an SAP consultant matching engine. Recommend the best consultant profile traits for this ticket."
            },
            {
              role: "user",
              content: `Match a consultant for this ticket:
Module: ${sap_module}
Title: ${title}
Description: ${description}
Urgency: ${urgency}

What consultant skills and experience are needed?`
            }
          ],
          tools: [{
            type: "function",
            function: {
              name: "match_consultant",
              description: "Recommend ideal consultant traits for a ticket",
              parameters: {
                type: "object",
                properties: {
                  required_skills: { type: "array", items: { type: "string" }, description: "Required SAP skills" },
                  min_experience_years: { type: "number", description: "Minimum years of experience recommended" },
                  preferred_certifications: { type: "array", items: { type: "string" }, description: "Preferred certifications" },
                  matching_rationale: { type: "string", description: "Why these requirements match the ticket" }
                },
                required: ["required_skills", "min_experience_years", "matching_rationale"],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: "function", function: { name: "match_consultant" } },
        }),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        throw new Error(`AI gateway error: ${status}`);
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      const result = toolCall ? JSON.parse(toolCall.function.arguments) : null;

      return new Response(JSON.stringify({ result }), {
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
