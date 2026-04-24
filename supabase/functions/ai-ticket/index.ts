import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

const VALID_MODELS = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
];

const DEFAULT_MODEL = "google/gemini-2.5-flash";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;
const MAX_BODY_SIZE = 50 * 1024;

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

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

function handleAiError(req: Request, status: number) {
  if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
  if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
  return null;
}

function parseToolResult(data: any) {
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  return toolCall ? JSON.parse(toolCall.function.arguments) : null;
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

    const clientId = req.headers.get("authorization")?.slice(-16) || req.headers.get("x-client-info") || "anon";
    if (!checkRateLimit(clientId)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait before sending more requests." }),
        { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" } });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    const { action, title, description, sap_module, urgency, preferred_language, model } = JSON.parse(bodyText);
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
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
          verification_status, ai_skills_score, country, city, nationality
        `)
        .in("verification_status", ["verified", "under_review"])
        .limit(50);

      if (consultantsError) throw new Error(`DB error: ${consultantsError.message}`);
      if (!consultants || consultants.length === 0) {
        return new Response(JSON.stringify({ result: { recommendations: [], rationale: "No consultants available." } }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      const consultantIds = consultants.map(c => c.id);
      const userIds = consultants.map(c => c.user_id);

      // Fetch all enrichment data in parallel
      const [
        { data: skills },
        { data: certs },
        { data: profiles },
        { data: interviews },
        { data: projects },
        { data: workHistory },
        { data: ndaAgreements },
        { data: sessionStats },
        { data: ratingDetails },
      ] = await Promise.all([
        supabase.from("consultant_skills")
          .select("consultant_id, sap_module, proficiency_level, years_experience, certified")
          .in("consultant_id", consultantIds),
        supabase.from("certifications")
          .select("consultant_id, name, issuer, verified, expiry_date")
          .in("consultant_id", consultantIds),
        supabase.from("profiles")
          .select("user_id, display_name, avatar_url")
          .in("user_id", userIds),
        supabase.from("interview_sessions")
          .select("consultant_id, status, overall_score, technical_score, soft_skills_score, interview_type, completed_at")
          .in("consultant_id", consultantIds)
          .eq("status", "completed")
          .order("completed_at", { ascending: false }),
        supabase.from("consultant_projects")
          .select("consultant_id, project_name, sap_modules, client_industry, duration_months, role")
          .in("consultant_id", consultantIds),
        supabase.from("consultant_work_history")
          .select("consultant_id, job_title, company_name, is_current, start_date, end_date")
          .in("consultant_id", consultantIds),
        supabase.from("nda_agreements")
          .select("consultant_id, signed_at, revoked_at")
          .in("consultant_id", consultantIds)
          .is("revoked_at", null),
        supabase.from("sessions")
          .select("consultant_id, status, duration_minutes")
          .in("consultant_id", consultantIds),
        supabase.from("ratings")
          .select("consultant_id, score, comment")
          .in("consultant_id", consultantIds)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      const enrichedConsultants = consultants.map(c => {
        const cSkills = (skills || []).filter(s => s.consultant_id === c.id);
        const cCerts = (certs || []).filter(cert => cert.consultant_id === c.id);
        const profile = (profiles || []).find(p => p.user_id === c.user_id);
        const cInterviews = (interviews || []).filter(i => i.consultant_id === c.id);
        const cProjects = (projects || []).filter(p => p.consultant_id === c.id);
        const cWork = (workHistory || []).filter(w => w.consultant_id === c.id);
        const hasActiveNDA = (ndaAgreements || []).some(n => n.consultant_id === c.id);
        const cSessions = (sessionStats || []).filter(s => s.consultant_id === c.id);
        const cRatings = (ratingDetails || []).filter(r => r.consultant_id === c.id);

        // Compute session completion rate
        const totalSessions = cSessions.length;
        const completedSessions = cSessions.filter(s => s.status === "completed").length;
        const sessionCompletionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : null;
        const avgSessionDuration = totalSessions > 0
          ? Math.round(cSessions.reduce((sum, s) => sum + (s.duration_minutes || 0), 0) / totalSessions)
          : null;

        // Latest interview scores
        const latestInterview = cInterviews[0] || null;

        // Total years of SAP experience across all skills
        const totalSapYears = cSkills.reduce((sum, s) => sum + (s.years_experience || 0), 0);

        // Relevant project modules
        const projectModules = [...new Set(cProjects.flatMap(p => p.sap_modules || []))];

        return {
          id: c.id,
          name: profile?.display_name || "Consultant",
          avatar_url: profile?.avatar_url,
          bio: c.bio,
          hourly_rate: c.hourly_rate,
          currency: c.currency,
          timezone: c.timezone,
          country: c.country,
          city: c.city,
          nationality: c.nationality,
          languages: c.languages,
          industries: c.industries,
          availability: c.availability_status,
          rating: c.rating,
          total_reviews: c.total_reviews,
          response_time_minutes: c.response_time_minutes,
          verification_status: c.verification_status,
          ai_skills_score: c.ai_skills_score,
          total_sap_years: totalSapYears,
          has_active_nda: hasActiveNDA,
          session_completion_rate: sessionCompletionRate,
          total_completed_sessions: completedSessions,
          avg_session_duration: avgSessionDuration,
          skills: cSkills.map(s => ({
            module: s.sap_module,
            proficiency: s.proficiency_level,
            years: s.years_experience,
            certified: s.certified,
          })),
          certifications: cCerts.map(cert => ({
            name: cert.name,
            issuer: cert.issuer,
            verified: cert.verified,
            expired: cert.expiry_date ? new Date(cert.expiry_date) < new Date() : false,
          })),
          interview: latestInterview ? {
            overall_score: latestInterview.overall_score,
            technical_score: latestInterview.technical_score,
            soft_skills_score: latestInterview.soft_skills_score,
            type: latestInterview.interview_type,
          } : null,
          project_history: cProjects.slice(0, 5).map(p => ({
            name: p.project_name,
            modules: p.sap_modules,
            industry: p.client_industry,
            duration_months: p.duration_months,
            role: p.role,
          })),
          work_experience: cWork.slice(0, 3).map(w => ({
            title: w.job_title,
            company: w.company_name,
            is_current: w.is_current,
          })),
          recent_ratings: cRatings.slice(0, 3).map(r => ({
            score: r.score,
            comment: r.comment,
          })),
        };
      });

      const rankResponse = await aiRequest(
        LOVABLE_API_KEY,
        `You are an advanced SAP consultant matching engine for an enterprise support platform. Rank consultants against ticket requirements using these weighted criteria:

SCORING CRITERIA (total = 100%):

1. SAP Module & Skill Match (25%):
   - Direct skill in the required module (proficiency 1-5, years of experience)
   - Certified in the module = strong bonus
   - Cross-module knowledge relevant to the issue

2. Project & Domain Experience (20%):
   - Past projects involving the same SAP module
   - Relevant industry experience matching the ticket context
   - Duration and depth of past project work

3. AI Interview & Verified Skills Score (15%):
   - Overall AI interview score (technical + soft skills)
   - ai_skills_score from platform assessment
   - Higher scores indicate verified, battle-tested expertise

4. Availability & Response Time (15%):
   - Available > busy > offline
   - Response time weighted by ticket urgency (critical tickets heavily penalize slow responders)
   - Timezone proximity to client's preferred working hours

5. Track Record & Reliability (10%):
   - Session completion rate (higher = more reliable)
   - Total completed sessions (experience on the platform)
   - Average session duration (engagement quality)

6. Client Satisfaction (8%):
   - Rating score (out of 5)
   - Number of reviews (statistical confidence)
   - Recent review sentiment

7. Language & Cultural Fit (5%):
   - Speaks client's preferred language
   - Nationality/region alignment for cultural understanding

8. Compliance & Trust (2%):
   - Active NDA on file = trust bonus
   - Verification status (verified > under_review)
   - Valid (non-expired) certifications

URGENCY MODIFIERS:
- Critical: Heavily favor available consultants with fast response times and high completion rates
- High: Balance availability with skill match
- Medium: Prioritize best skill match over availability
- Low: Focus on best overall value (skill + rate)

Return the top 5 consultants. For each, provide a detailed match reason referencing specific data points from their profile.`,
        `Client Ticket:
Module: ${sap_module}
Title: ${title}
Description: ${description}
Urgency: ${urgency}
Preferred Language: ${preferred_language || 'en'}

Available Consultants (${enrichedConsultants.length}):
${JSON.stringify(enrichedConsultants, null, 2)}

Rank the top consultants for this ticket. Be specific about why each matches.`,
        [{
          type: "function",
          function: {
            name: "rank_consultants",
            description: "Return ranked consultant recommendations with detailed scoring",
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
                      match_reason: { type: "string", description: "3-4 sentence explanation referencing specific data points (skills, projects, scores)" },
                      strengths: { type: "array", items: { type: "string" }, description: "Top 3-5 specific strengths for this ticket" },
                      concerns: { type: "array", items: { type: "string" }, description: "Any potential concerns or gaps (0-2 items)" },
                      skill_match_score: { type: "number", description: "Skill & module match sub-score 0-100" },
                      experience_score: { type: "number", description: "Project & domain experience sub-score 0-100" },
                      availability_score: { type: "number", description: "Availability & response time sub-score 0-100" },
                      reliability_score: { type: "number", description: "Track record & reliability sub-score 0-100" },
                      interview_score: { type: "number", description: "AI interview performance sub-score 0-100" },
                    },
                    required: ["consultant_id", "match_score", "match_reason", "strengths", "skill_match_score", "availability_score"],
                    additionalProperties: false,
                  },
                  description: "Top 5 ranked consultants"
                },
                overall_rationale: { type: "string", description: "Summary of ranking methodology and key differentiators between top candidates" }
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
            ai_skills_score: consultant?.ai_skills_score,
            session_completion_rate: consultant?.session_completion_rate,
            total_completed_sessions: consultant?.total_completed_sessions,
            has_active_nda: consultant?.has_active_nda,
            top_skills: consultant?.skills?.slice(0, 5).map((s: any) => s.module) || [],
            interview: consultant?.interview,
          };
        });
      }

      return new Response(JSON.stringify({ result: rankResult }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("ai-ticket error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
