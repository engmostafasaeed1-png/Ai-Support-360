import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders as getCorsHeaders, adminClient, withinRateLimit, getUserRoles, hasAnyRole, ADMIN_ROLES } from "../_shared/security.ts";
import { buildDenyList, cleanTags, saveKnowledgeDraft } from "../_shared/knowledge.ts";

const BodySchema = z.object({ session_id: z.string().uuid() });

const MAX_BODY_SIZE = 50 * 1024;

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

    if (!(await withinRateLimit(adminClient(), `ai-session-analysis:${authUser.id}`, 10, 60, true))) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded." }),
        { status: 429, headers: { ...getCorsHeaders(req), "Content-Type": "application/json", "Retry-After": "60" } });
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      return new Response(JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }

    let bodyJson: unknown;
    try { bodyJson = JSON.parse(bodyText); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }
    const parsed = BodySchema.safeParse(bodyJson);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } });
    }
    const { session_id } = parsed.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch session with related data
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", session_id)
      .single();
    if (sErr || !session) throw new Error("Session not found");

    // Authorization: only the session's client, its consultant, or an admin may analyse a session.
    {
      const { data: sessionConsultant } = await supabase
        .from("consultants").select("user_id").eq("id", session.consultant_id).maybeSingle();
      const callerRoles = await getUserRoles(supabase, authUser.id);
      const isParticipant = session.client_id === authUser.id || sessionConsultant?.user_id === authUser.id;
      if (!isParticipant && !hasAnyRole(callerRoles, ADMIN_ROLES)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
    }

    // Idempotency: one analysis per session (prevents duplicate feedback / surveys / notifications).
    {
      const { count: alreadyAnalysed } = await supabase
        .from("session_feedback").select("id", { count: "exact", head: true }).eq("session_id", session_id);
      if ((alreadyAnalysed ?? 0) > 0) {
        return new Response(JSON.stringify({ success: true, already_analyzed: true }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
    }

    // Fetch ticket info
    let ticketInfo = "";
    if (session.ticket_id) {
      const { data: ticket } = await supabase
        .from("tickets")
        .select("title, description, sap_module, urgency")
        .eq("id", session.ticket_id)
        .single();
      if (ticket) {
        ticketInfo = `Ticket: "${ticket.title}" | Module: ${ticket.sap_module} | Urgency: ${ticket.urgency}\nDescription: ${ticket.description || "N/A"}`;
      }
    }

    // Fetch messages for context
    const { data: messages } = await supabase
      .from("messages")
      .select("content, sender_id, created_at, message_type")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true })
      .limit(100);

    const chatLog = (messages || [])
      .filter((m: any) => m.content)
      .map((m: any) => `[${m.sender_id === session.client_id ? "Client" : "Consultant"}]: ${m.content}`)
      .join("\n");

    // Get consultant name
    const { data: consultantProfile } = await supabase
      .from("consultants")
      .select("user_id")
      .eq("id", session.consultant_id)
      .single();

    let consultantName = "Consultant";
    let clientName = "Client";
    if (consultantProfile) {
      const { data: cp } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", consultantProfile.user_id)
        .single();
      if (cp?.display_name) consultantName = cp.display_name;
    }
    const { data: clp } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", session.client_id)
      .single();
    if (clp?.display_name) clientName = clp.display_name;

    const prompt = `Analyze this SAP consulting session and generate a comprehensive evaluation.

Session Info:
- Type: ${session.session_type || "chat"}
- Duration: ${session.duration_minutes || 0} minutes
- Status: ${session.status}
${ticketInfo ? `\n${ticketInfo}` : ""}

Chat Log:
${chatLog || "(No messages recorded)"}

Notes: ${session.notes || "None"}

Generate a JSON response with this EXACT structure:
{
  "client_evaluation": {
    "communication_score": <1-10>,
    "clarity_score": <1-10>,
    "overall_score": <1-10>,
    "feedback": "<2-3 sentences for the client about their interaction>",
    "strengths": ["<strength1>", "<strength2>"],
    "improvements": ["<area1>"]
  },
  "consultant_evaluation": {
    "communication_score": <1-10>,
    "technical_score": <1-10>,
    "professionalism_score": <1-10>,
    "overall_score": <1-10>,
    "feedback": "<2-3 sentences for the consultant about their performance>",
    "strengths": ["<strength1>", "<strength2>"],
    "improvements": ["<area1>"]
  },
  "meeting_minutes": {
    "summary": "<brief summary of the session>",
    "topics_discussed": ["<topic1>", "<topic2>"],
    "decisions_made": ["<decision1>"],
    "action_items": ["<action1>", "<action2>"],
    "next_steps": "<what should happen next>"
  },
  "client_survey": [
    {"question": "<q1>", "type": "rating", "scale": 5},
    {"question": "<q2>", "type": "rating", "scale": 5},
    {"question": "<q3>", "type": "text"},
    {"question": "<q4>", "type": "multiple_choice", "options": ["opt1","opt2","opt3"]},
    {"question": "<q5>", "type": "nps", "scale": 10}
  ],
  "consultant_survey": [
    {"question": "<q1>", "type": "rating", "scale": 5},
    {"question": "<q2>", "type": "text"},
    {"question": "<q3>", "type": "rating", "scale": 5}
  ],
  "knowledge_solution": {
    "title": "<anonymized problem title>",
    "problem_description": "<anonymized problem description without any client/company names>",
    "solution": "<anonymized solution steps>",
    "sap_module": "<module>",
    "tags": ["<tag1>", "<tag2>"]
  }
}

IMPORTANT: In knowledge_solution, REMOVE all client names, company names, and identifying details. Make it generic and reusable.
Return ONLY valid JSON.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert SAP consulting session analyst. Always respond with valid JSON only." },
          { role: "user", content: prompt },
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
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted" }), {
          status: 402, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const aiData = await aiResp.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "{}";
    
    let analysis;
    try {
      const cleaned = rawContent.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse:", rawContent);
      throw new Error("Failed to parse AI analysis");
    }

    const momText = analysis.meeting_minutes
      ? `## Summary\n${analysis.meeting_minutes.summary}\n\n## Topics Discussed\n${(analysis.meeting_minutes.topics_discussed || []).map((t: string) => `- ${t}`).join("\n")}\n\n## Decisions Made\n${(analysis.meeting_minutes.decisions_made || []).map((d: string) => `- ${d}`).join("\n")}\n\n## Action Items\n${(analysis.meeting_minutes.action_items || []).map((a: string) => `- ${a}`).join("\n")}\n\n## Next Steps\n${analysis.meeting_minutes.next_steps || "N/A"}`
      : "";

    // Insert client feedback
    const clientEval = analysis.client_evaluation || {};
    await supabase.from("session_feedback").insert({
      session_id,
      recipient_id: session.client_id,
      recipient_role: "client",
      communication_score: clientEval.communication_score,
      technical_score: clientEval.clarity_score,
      professionalism_score: clientEval.overall_score,
      overall_score: clientEval.overall_score,
      ai_feedback: clientEval.feedback,
      mom_content: momText,
      action_items: analysis.meeting_minutes?.action_items || [],
      strengths: clientEval.strengths || [],
      improvements: clientEval.improvements || [],
    });

    // Insert consultant feedback
    const consEval = analysis.consultant_evaluation || {};
    await supabase.from("session_feedback").insert({
      session_id,
      recipient_id: consultantProfile?.user_id || session.consultant_id,
      recipient_role: "consultant",
      communication_score: consEval.communication_score,
      technical_score: consEval.technical_score,
      professionalism_score: consEval.professionalism_score,
      overall_score: consEval.overall_score,
      ai_feedback: consEval.feedback,
      mom_content: momText,
      action_items: analysis.meeting_minutes?.action_items || [],
      strengths: consEval.strengths || [],
      improvements: consEval.improvements || [],
    });

    // Insert surveys
    if (analysis.client_survey) {
      await supabase.from("session_surveys").insert({
        session_id,
        generated_for: session.client_id,
        generated_for_role: "client",
        questions: analysis.client_survey,
      });
    }
    if (analysis.consultant_survey && consultantProfile?.user_id) {
      await supabase.from("session_surveys").insert({
        session_id,
        generated_for: consultantProfile.user_id,
        generated_for_role: "consultant",
        questions: analysis.consultant_survey,
      });
    }

    // Insert the anonymised knowledge solution as a DRAFT (an administrator reviews it before anything is published).
    // The text is scrubbed again here (the model is told to anonymise, but a model can slip) and what was removed is recorded for the reviewer.
    if (analysis.knowledge_solution?.title) {
      const ks = analysis.knowledge_solution;
      try {
        let areas: string[] = ks.sap_module ? [String(ks.sap_module)] : [];
        let tenantId: string | null = session.tenant_id ?? null;
        if (session.ticket_id) {
          const { data: ticketRow } = await supabase.from("tickets").select("sap_module, sap_modules, tenant_id").eq("id", session.ticket_id).maybeSingle();
          if (ticketRow) {
            areas = Array.isArray(ticketRow.sap_modules) && ticketRow.sap_modules.length > 0 ? ticketRow.sap_modules : [ticketRow.sap_module];
            tenantId = ticketRow.tenant_id ?? tenantId;
          }
        }
        const deny = await buildDenyList(supabase, { client_id: session.client_id, consultant_id: session.consultant_id, tenant_id: tenantId }, []);
        await saveKnowledgeDraft(supabase, {
          title: String(ks.title ?? ""),
          problem: String(ks.problem_description ?? ""),
          solution: String(ks.solution ?? ""),
          areas,
          tags: cleanTags(ks.tags),
          ticketId: session.ticket_id ?? null,
          consultantId: session.consultant_id ?? null,
          originKind: "session",
          deny,
        });
      } catch (e) {
        console.error("knowledge draft failed:", e instanceof Error ? e.message : String(e));
      }
    }

    // Update session with AI summary
    await supabase.from("sessions").update({
      ai_summary: analysis.meeting_minutes?.summary,
      ai_action_items: analysis.meeting_minutes?.action_items,
    }).eq("id", session_id);

    // Notify both parties
    await supabase.from("notifications").insert([
      {
        user_id: session.client_id,
        title: "Session Report Ready 📊",
        body: "Your AI-generated session feedback, meeting minutes, and survey are ready to view.",
        type: "feedback",
        link: `/client/sessions/${session_id}`,
      },
      ...(consultantProfile?.user_id ? [{
        user_id: consultantProfile.user_id,
        title: "Session Report Ready 📊",
        body: "Your AI-generated session feedback and performance review are ready.",
        type: "feedback",
        link: `/consultant/cases`,
      }] : []),
    ]);

    return new Response(JSON.stringify({ success: true, analysis }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: "Analysis failed. Please try again." }), {
      status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
