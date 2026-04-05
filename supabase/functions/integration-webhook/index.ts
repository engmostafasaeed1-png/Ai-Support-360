import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Platform-specific payload parsers
function parseZendeskPayload(body: Record<string, unknown>): { event: string; ticket: Record<string, unknown> } | null {
  // Zendesk sends triggers/webhooks with ticket data
  const ticket = (body.ticket || body) as Record<string, unknown>;
  if (!ticket.id) return null;
  const statusMap: Record<string, string> = { new: "new", open: "in_progress", pending: "waiting_for_client", solved: "resolved", closed: "closed" };
  const urgencyMap: Record<string, string> = { low: "low", normal: "medium", high: "high", urgent: "critical" };
  return {
    event: body.event as string || "ticket_updated",
    ticket: {
      title: ticket.subject || ticket.title,
      description: ticket.description,
      status: statusMap[(ticket.status as string)] || "new",
      urgency: urgencyMap[(ticket.priority as string)] || "medium",
      external_id: String(ticket.id),
    },
  };
}

function parseFreshdeskPayload(body: Record<string, unknown>): { event: string; ticket: Record<string, unknown> } | null {
  const data = (body.freshdesk_webhook || body) as Record<string, unknown>;
  const ticket = (data.ticket_data || data) as Record<string, unknown>;
  if (!ticket.id) return null;
  const statusMap: Record<number, string> = { 2: "new", 3: "waiting_for_client", 4: "resolved", 5: "closed" };
  const urgencyMap: Record<number, string> = { 1: "low", 2: "medium", 3: "high", 4: "critical" };
  return {
    event: (data.event as string) || "ticket_updated",
    ticket: {
      title: ticket.subject,
      description: ticket.description_text || ticket.description,
      status: statusMap[ticket.status as number] || "new",
      urgency: urgencyMap[ticket.priority as number] || "medium",
      external_id: String(ticket.id),
    },
  };
}

function parseJiraPayload(body: Record<string, unknown>): { event: string; ticket: Record<string, unknown> } | null {
  // Jira sends webhooks with issue data
  const issue = (body.issue || body) as Record<string, unknown>;
  const fields = (issue.fields || {}) as Record<string, unknown>;
  const key = issue.key as string;
  if (!key && !issue.id) return null;
  const priority = ((fields.priority as Record<string, string>)?.name || "medium").toLowerCase();
  const urgencyMap: Record<string, string> = { lowest: "low", low: "low", medium: "medium", high: "high", highest: "critical" };
  return {
    event: (body.webhookEvent as string) || "jira:issue_updated",
    ticket: {
      title: fields.summary || key,
      description: typeof fields.description === "string" ? fields.description : "",
      status: "new",
      urgency: urgencyMap[priority] || "medium",
      external_id: key || String(issue.id),
    },
  };
}

function parseServiceNowPayload(body: Record<string, unknown>): { event: string; ticket: Record<string, unknown> } | null {
  const incident = (body.incident || body) as Record<string, unknown>;
  if (!incident.sys_id && !incident.number) return null;
  const stateMap: Record<string, string> = { "1": "new", "2": "in_progress", "3": "waiting_for_client", "6": "resolved", "7": "closed" };
  const urgencyMap: Record<string, string> = { "1": "critical", "2": "high", "3": "medium", "4": "low" };
  return {
    event: (body.event as string) || "incident_updated",
    ticket: {
      title: incident.short_description,
      description: incident.description,
      status: stateMap[incident.state as string] || "new",
      urgency: urgencyMap[incident.urgency as string] || "medium",
      external_id: (incident.sys_id as string) || (incident.number as string),
    },
  };
}

const parsers: Record<string, (body: Record<string, unknown>) => { event: string; ticket: Record<string, unknown> } | null> = {
  zendesk: parseZendeskPayload,
  freshdesk: parseFreshdeskPayload,
  jira: parseJiraPayload,
  servicenow: parseServiceNowPayload,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Expected path: /integration-webhook/{platform}/{integration_id}
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts = ["integration-webhook", platform, integration_id]
  const platform = pathParts[1];
  const integrationId = pathParts[2];

  if (!platform || !integrationId) {
    return new Response(
      JSON.stringify({ error: "URL must be /integration-webhook/{platform}/{integration_id}" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const parser = parsers[platform];
  if (!parser) {
    return new Response(
      JSON.stringify({ error: `Unsupported platform: ${platform}. Supported: ${Object.keys(parsers).join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify integration exists
    const { data: integration, error: intError } = await supabase
      .from("integrations")
      .select("id, platform, client_id, webhook_secret, sync_enabled, status")
      .eq("id", integrationId)
      .eq("platform", platform)
      .single();

    if (intError || !integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found or platform mismatch" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (integration.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Integration is not active" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify webhook secret if configured
    if (integration.webhook_secret) {
      const providedSecret = req.headers.get("x-webhook-secret") || url.searchParams.get("secret");
      if (providedSecret !== integration.webhook_secret) {
        return new Response(
          JSON.stringify({ error: "Invalid webhook secret" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Parse the incoming payload
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = parser(body);
    if (!parsed) {
      // Log as skipped
      await supabase.from("integration_sync_log").insert({
        integration_id: integration.id,
        direction: "inbound" as const,
        entity_type: "ticket",
        action: "webhook_skipped",
        status: "skipped" as const,
        error_message: "Could not parse payload",
        payload: body,
      });

      return new Response(
        JSON.stringify({ status: "skipped", reason: "Could not extract ticket data from payload" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if this external ticket already has a sync record
    const { data: existingSync } = await supabase
      .from("integration_sync_log")
      .select("local_ticket_id")
      .eq("integration_id", integration.id)
      .eq("external_ticket_id", parsed.ticket.external_id as string)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isUpdate = !!existingSync?.local_ticket_id;

    if (isUpdate && existingSync.local_ticket_id) {
      // Update existing local ticket
      await supabase
        .from("tickets")
        .update({
          title: parsed.ticket.title as string,
          description: parsed.ticket.description as string,
          status: parsed.ticket.status as string,
          urgency: parsed.ticket.urgency as string,
        })
        .eq("id", existingSync.local_ticket_id);
    }
    // Note: For new tickets from webhook, we log but don't auto-create
    // (creating tickets requires a client_id which comes from the integration)

    // Log successful webhook receipt
    await supabase.from("integration_sync_log").insert({
      integration_id: integration.id,
      direction: "inbound" as const,
      entity_type: "ticket",
      external_ticket_id: parsed.ticket.external_id as string,
      local_ticket_id: existingSync?.local_ticket_id || null,
      action: isUpdate ? "webhook_ticket_updated" : "webhook_ticket_received",
      status: "success" as const,
      payload: parsed.ticket,
    });

    // Update last synced timestamp
    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", integration.id);

    return new Response(
      JSON.stringify({
        status: "ok",
        event: parsed.event,
        action: isUpdate ? "updated" : "received",
        external_id: parsed.ticket.external_id,
        local_ticket_id: existingSync?.local_ticket_id || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
