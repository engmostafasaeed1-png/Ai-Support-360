import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { scrubText } from "../_shared/scrub.ts";

const VALID_MODELS = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
];

const DEFAULT_MODEL = "google/gemini-2.5-flash";

const MAX_BODY_SIZE = 50 * 1024;

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

    if (!(await withinRateLimit(adminClient(), `ai-ticket:${authUser.id}`, 20, 60, true))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait before sending more requests." }),
        { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" } });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    const BodySchema = z.object({
      action: z.enum(["categorize", "summarize", "match", "match_consultants"]),
      title: z.string().min(1).max(500).optional(),
      description: z.string().min(1).max(8000).optional(),
      sap_module: z.string().max(100).optional(),
      sap_modules: z.array(z.string().max(80)).max(12).optional(),
      sap_module_other: z.string().max(160).optional(),
      urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
      preferred_language: z.string().max(20).optional(),
      model: z.string().max(100).optional(),
      ticket_id: z.string().uuid().optional(),
    }).passthrough();

    const parsed = BodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }
    const { action, title, description, sap_module, sap_modules, sap_module_other, urgency, preferred_language, model } = parsed.data;
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
        const errResp = handleAiError(req, response.status);
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
        const errResp = handleAiError(req, response.status);
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
        const errResp = handleAiError(req, response.status);
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

      // Only clients and admins may request consultant matching (this branch reads consultant data with the service role).
      const callerRoles = await getUserRoles(supabase, authUser.id);
      if (!hasAnyRole(callerRoles, ["client", ...ADMIN_ROLES])) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      // Only verified consultants can be asked to take a ticket (the match request is refused for anyone else).
      const { data: consultants, error: consultantsError } = await supabase
        .from("consultants")
        .select(`
          id, user_id, bio, hourly_rate, currency, timezone, languages, industries,
          availability_status, rating, total_reviews, response_time_minutes,
          verification_status, ai_skills_score, country
        `)
        .eq("verification_status", "verified")
        .limit(50);

      if (consultantsError) throw new Error(`DB error: ${consultantsError.message}`);
      if (!consultants || consultants.length === 0) {
        return new Response(JSON.stringify({ result: { recommendations: [], rationale: "No consultants available." } }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      const consultantIds = consultants.map(c => c.id);
      const userIds = consultants.map(c => c.user_id);

      // The areas of this ticket and the caller's company, to count what each consultant solved before.
      const ticketAreas = [...new Set((sap_modules && sap_modules.length > 0 ? sap_modules : (sap_module ? [sap_module] : []))
        .map((a: string) => a.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 12);
      const { data: member } = await supabase.from("tenant_members").select("tenant_id")
        .eq("user_id", authUser.id).not("accepted_at", "is", null).limit(1).maybeSingle();
      const searchText = scrubText(`${title ?? ""}\n${description ?? ""}`).text.replace(/\[[a-z ]{2,20}\]/g, " ").slice(0, 4000);

      // Fetch all enrichment data in parallel. Other clients' review comments and a consultant's former employers are NOT read:
      // the answer is shown to the client and must not repeat private details.
      const [
        { data: skills },
        { data: certs },
        { data: profiles },
        { data: interviews },
        { data: projects },
        { data: ndaAgreements },
        { data: sessionStats },
        { data: solvedBefore },
        { data: cvProfiles },
        { data: workHistory },
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
          .select("consultant_id, sap_modules, client_industry, duration_months, role")
          .in("consultant_id", consultantIds),
        supabase.from("nda_agreements")
          .select("consultant_id, signed_at, revoked_at")
          .in("consultant_id", consultantIds)
          .is("revoked_at", null),
        supabase.from("sessions")
          .select("consultant_id, status, duration_minutes")
          .in("consultant_id", consultantIds),
        supabase.rpc("consultants_solved_similar", {
          _query: searchText,
          _areas: ticketAreas,
          _tenant: member?.tenant_id ?? null,
          _limit: 50,
        }),
        supabase.from("consultant_cv_profiles")
          .select("consultant_id, matching_summary, expertise_keywords, cv_text")
          .in("consultant_id", consultantIds),
        supabase.from("consultant_work_history")
          .select("consultant_id, job_title, start_date, end_date, is_current, description")
          .in("consultant_id", consultantIds)
          .order("start_date", { ascending: false }),
      ]);
      const solvedMap = new Map<string, { solved_similar: number; resolved_in_areas: number }>();
      for (const r of (solvedBefore ?? []) as any[]) {
        solvedMap.set(r.consultant_id, { solved_similar: r.solved_similar ?? 0, resolved_in_areas: r.resolved_in_areas ?? 0 });
      }

      const enrichedConsultants = consultants.map(c => {
        const cSkills = (skills || []).filter(s => s.consultant_id === c.id);
        const cCerts = (certs || []).filter(cert => cert.consultant_id === c.id);
        const profile = (profiles || []).find(p => p.user_id === c.user_id);
        const cInterviews = (interviews || []).filter(i => i.consultant_id === c.id);
        const cProjects = (projects || []).filter(p => p.consultant_id === c.id);
        const hasActiveNDA = (ndaAgreements || []).some(n => n.consultant_id === c.id);
        const cSessions = (sessionStats || []).filter(s => s.consultant_id === c.id);
        const solved = solvedMap.get(c.id);
        const cv = (cvProfiles || []).find((x: any) => x.consultant_id === c.id) as any;
        const cJobs = (workHistory || []).filter((w: any) => w.consultant_id === c.id) as any[];

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

        return {
          id: c.id,
          name: profile?.display_name || "Consultant",
          avatar_url: profile?.avatar_url,
          bio: c.bio ? String(c.bio).slice(0, 400) : null,
          hourly_rate: c.hourly_rate,
          currency: c.currency,
          timezone: c.timezone,
          country: c.country,
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
          solved_similar_issues: solved?.solved_similar ?? 0,
          resolved_tickets_in_these_areas: solved?.resolved_in_areas ?? 0,
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
          // CV and experience: job titles, durations and scrubbed descriptions only — employer names are never sent.
          cv_summary: cv?.matching_summary ? scrubText(String(cv.matching_summary)).text.slice(0, 1200) : null,
          cv_keywords: Array.isArray(cv?.expertise_keywords) ? cv.expertise_keywords.slice(0, 40) : [],
          cv_excerpt: cv?.cv_text ? scrubText(String(cv.cv_text)).text.slice(0, 1500) : null,
          work_experience: cJobs.slice(0, 6).map((w) => {
            const start = w.start_date ? new Date(w.start_date) : null;
            const end = w.is_current || !w.end_date ? new Date() : new Date(w.end_date);
            return {
              title: w.job_title,
              years: start ? Math.max(0, Math.round(((end.getTime() - start.getTime()) / 31_557_600_000) * 10) / 10) : null,
              current: !!w.is_current,
              description: w.description ? scrubText(String(w.description)).text.slice(0, 350) : null,
            };
          }),
          project_history: cProjects.slice(0, 5).map(p => ({
            modules: p.sap_modules,
            industry: p.client_industry,
            duration_months: p.duration_months,
            role: p.role,
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
   - CV evidence: cv_summary, cv_keywords, cv_excerpt and work_experience (titles, years, descriptions) that mention the same modules, processes, t-codes or problem type

2. Track Record on Similar Issues (20%):
   - solved_similar_issues: how many published solutions for similar problems came from this consultant's tickets
   - resolved_tickets_in_these_areas: how many tickets this consultant resolved in the same SAP areas
   - Past projects involving the same SAP modules, industry and role

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

7. Language & Cultural Fit (5%):
   - Speaks client's preferred language
   - Nationality/region alignment for cultural understanding

8. Compliance & Trust (2%):
   - Active NDA on file = trust bonus
   - Verification status
   - Valid (non-expired) certifications

URGENCY MODIFIERS:
- Critical: Heavily favor available consultants with fast response times and high completion rates
- High: Balance availability with skill match
- Medium: Prioritize best skill match over availability
- Low: Focus on best overall value (skill + rate)

PRIVACY RULES (the answer is shown to a client):
- Use only the facts given: skills, modules, scores, counts, availability, languages, rates.
- Never mention other clients, companies, reviews or comments, former employers or personal details.
- When solved_similar_issues or resolved_tickets_in_these_areas is above 0, you may say it as a plain count, for example "solved 3 similar issues".

Return the top 5 consultants. For each, provide a match reason that references the facts above.`,
        `Client Ticket:
Areas: ${ticketAreas.length > 0 ? ticketAreas.join(", ") : sap_module}${sap_module_other ? ` (other: ${sap_module_other})` : ""}
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
                      match_reason: { type: "string", description: "3-4 sentence explanation using only the given facts (skills, modules, scores, counts)" },
                      strengths: { type: "array", items: { type: "string" }, description: "Top 3-5 specific strengths for this ticket" },
                      concerns: { type: "array", items: { type: "string" }, description: "Any potential concerns or gaps (0-2 items)" },
                      skill_match_score: { type: "number", description: "Skill & module match sub-score 0-100" },
                      experience_score: { type: "number", description: "Track record on similar issues sub-score 0-100" },
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
        const errResp = handleAiError(req, rankResponse.status);
        if (errResp) return errResp;
        throw new Error(`AI gateway error: ${rankResponse.status}`);
      }

      const rankData = await rankResponse.json();
      const rankResult = parseToolResult(rankData);

      if (rankResult?.recommendations) {
        // Only consultants we sent can be recommended, and the free text is scrubbed once more before a client sees it.
        rankResult.recommendations = rankResult.recommendations
          .filter((rec: any) => enrichedConsultants.some(c => c.id === rec.consultant_id))
          .map((rec: any) => {
            const consultant = enrichedConsultants.find(c => c.id === rec.consultant_id);
            const solved = solvedMap.get(rec.consultant_id);
            return {
              ...rec,
              match_reason: scrubText(rec.match_reason).text,
              strengths: (Array.isArray(rec.strengths) ? rec.strengths : []).map((s: unknown) => scrubText(String(s ?? "")).text),
              concerns: (Array.isArray(rec.concerns) ? rec.concerns : []).map((s: unknown) => scrubText(String(s ?? "")).text),
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
              solved_similar: solved?.solved_similar ?? 0,
              resolved_in_areas: solved?.resolved_in_areas ?? 0,
              top_skills: consultant?.skills?.slice(0, 5).map((s: any) => s.module) || [],
              interview: consultant?.interview,
            };
          });
        if (typeof rankResult.overall_rationale === "string") rankResult.overall_rationale = scrubText(rankResult.overall_rationale).text;
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
    return new Response(JSON.stringify({ error: "Request failed. Please try again." }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
