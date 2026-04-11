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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SyncRequest {
  integration_id: string;
  action: "sync_tickets" | "push_update" | "webhook_inbound";
  payload?: Record<string, unknown>;
}

// Platform-specific API adapters
const platformAdapters: Record<string, {
  fetchTickets: (config: Record<string, string>) => Promise<unknown[]>;
  pushUpdate: (config: Record<string, string>, ticket: Record<string, unknown>) => Promise<unknown>;
  mapInbound: (externalTicket: Record<string, unknown>) => Record<string, unknown>;
  mapOutbound: (localTicket: Record<string, unknown>) => Record<string, unknown>;
}> = {
  zendesk: {
    async fetchTickets(config) {
      const resp = await fetch(`${config.platform_url}/api/v2/tickets.json?sort_by=updated_at&sort_order=desc&per_page=50`, {
        headers: {
          "Authorization": `Basic ${btoa(`${config.email}/token:${config.api_key}`)}`,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) throw new Error(`Zendesk API error: ${resp.status}`);
      const data = await resp.json();
      return data.tickets || [];
    },
    async pushUpdate(config, ticket) {
      const resp = await fetch(`${config.platform_url}/api/v2/tickets/${ticket.external_id}.json`, {
        method: "PUT",
        headers: {
          "Authorization": `Basic ${btoa(`${config.email}/token:${config.api_key}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticket: { status: ticket.status, comment: { body: ticket.comment } } }),
      });
      if (!resp.ok) throw new Error(`Zendesk push error: ${resp.status}`);
      return resp.json();
    },
    mapInbound(ext) {
      const statusMap: Record<string, string> = { new: "new", open: "in_progress", pending: "waiting_for_client", solved: "resolved", closed: "closed" };
      const urgencyMap: Record<string, string> = { low: "low", normal: "medium", high: "high", urgent: "critical" };
      return {
        title: ext.subject,
        description: ext.description,
        status: statusMap[ext.status as string] || "new",
        urgency: urgencyMap[ext.priority as string] || "medium",
        external_id: String(ext.id),
      };
    },
    mapOutbound(local) {
      const statusMap: Record<string, string> = { new: "new", in_progress: "open", waiting_for_client: "pending", resolved: "solved", closed: "closed" };
      return { status: statusMap[local.status as string] || "open", comment: `Updated from Qurtuba: ${local.title}` };
    },
  },
  freshdesk: {
    async fetchTickets(config) {
      const resp = await fetch(`${config.platform_url}/api/v2/tickets?order_by=updated_at&order_type=desc&per_page=50`, {
        headers: { "Authorization": `Basic ${btoa(`${config.api_key}:X`)}`, "Content-Type": "application/json" },
      });
      if (!resp.ok) throw new Error(`Freshdesk API error: ${resp.status}`);
      return resp.json();
    },
    async pushUpdate(config, ticket) {
      const resp = await fetch(`${config.platform_url}/api/v2/tickets/${ticket.external_id}`, {
        method: "PUT",
        headers: { "Authorization": `Basic ${btoa(`${config.api_key}:X`)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: ticket.status }),
      });
      if (!resp.ok) throw new Error(`Freshdesk push error: ${resp.status}`);
      return resp.json();
    },
    mapInbound(ext) {
      const statusMap: Record<number, string> = { 2: "new", 3: "waiting_for_client", 4: "resolved", 5: "closed" };
      const urgencyMap: Record<number, string> = { 1: "low", 2: "medium", 3: "high", 4: "critical" };
      return {
        title: ext.subject,
        description: ext.description_text,
        status: statusMap[ext.status as number] || "new",
        urgency: urgencyMap[ext.priority as number] || "medium",
        external_id: String(ext.id),
      };
    },
    mapOutbound(local) {
      const statusMap: Record<string, number> = { new: 2, in_progress: 2, waiting_for_client: 3, resolved: 4, closed: 5 };
      return { status: statusMap[local.status as string] || 2 };
    },
  },
  jira: {
    async fetchTickets(config) {
      const jql = encodeURIComponent(`project=${config.project_key} ORDER BY updated DESC`);
      const resp = await fetch(`${config.platform_url}/rest/api/3/search?jql=${jql}&maxResults=50`, {
        headers: {
          "Authorization": `Basic ${btoa(`${config.email}:${config.api_key}`)}`,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) throw new Error(`Jira API error: ${resp.status}`);
      const data = await resp.json();
      return data.issues || [];
    },
    async pushUpdate(config, ticket) {
      const resp = await fetch(`${config.platform_url}/rest/api/3/issue/${ticket.external_id}`, {
        method: "PUT",
        headers: {
          "Authorization": `Basic ${btoa(`${config.email}:${config.api_key}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields: { summary: ticket.title } }),
      });
      if (!resp.ok) throw new Error(`Jira push error: ${resp.status}`);
      return { success: true };
    },
    mapInbound(ext) {
      const fields = ext.fields as Record<string, unknown>;
      const priority = (fields?.priority as Record<string, string>)?.name?.toLowerCase() || "medium";
      const urgencyMap: Record<string, string> = { lowest: "low", low: "low", medium: "medium", high: "high", highest: "critical" };
      return {
        title: fields?.summary || ext.key,
        description: typeof fields?.description === "string" ? fields.description : "",
        status: "new",
        urgency: urgencyMap[priority] || "medium",
        external_id: ext.key as string,
      };
    },
    mapOutbound(local) {
      return { summary: local.title };
    },
  },
  servicenow: {
    async fetchTickets(config) {
      const resp = await fetch(`${config.platform_url}/api/now/table/incident?sysparm_limit=50&sysparm_order_by=sys_updated_on desc`, {
        headers: {
          "Authorization": `Basic ${btoa(`${config.api_key}:${config.password}`)}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
      });
      if (!resp.ok) throw new Error(`ServiceNow API error: ${resp.status}`);
      const data = await resp.json();
      return data.result || [];
    },
    async pushUpdate(config, ticket) {
      const resp = await fetch(`${config.platform_url}/api/now/table/incident/${ticket.external_id}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Basic ${btoa(`${config.api_key}:${config.password}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ short_description: ticket.title, state: ticket.status }),
      });
      if (!resp.ok) throw new Error(`ServiceNow push error: ${resp.status}`);
      return resp.json();
    },
    mapInbound(ext) {
      const stateMap: Record<string, string> = { "1": "new", "2": "in_progress", "3": "waiting_for_client", "6": "resolved", "7": "closed" };
      const urgencyMap: Record<string, string> = { "1": "critical", "2": "high", "3": "medium", "4": "low" };
      return {
        title: ext.short_description,
        description: ext.description,
        status: stateMap[ext.state as string] || "new",
        urgency: urgencyMap[ext.urgency as string] || "medium",
        external_id: ext.sys_id as string,
      };
    },
    mapOutbound(local) {
      const stateMap: Record<string, string> = { new: "1", in_progress: "2", waiting_for_client: "3", resolved: "6", closed: "7" };
      return { state: stateMap[local.status as string] || "1", short_description: local.title };
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body: SyncRequest = await req.json();

    if (!body.integration_id || !body.action) {
      return new Response(JSON.stringify({ error: "integration_id and action are required" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Fetch integration config
    const { data: integration, error: intError } = await supabase
      .from("integrations")
      .select("*")
      .eq("id", body.integration_id)
      .single();

    if (intError || !integration) {
      return new Response(JSON.stringify({ error: "Integration not found" }), {
        status: 404,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const adapter = platformAdapters[integration.platform];
    if (!adapter) {
      return new Response(JSON.stringify({ error: `Unsupported platform: ${integration.platform}` }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const config = {
      platform_url: integration.platform_url,
      api_key: integration.api_key_encrypted, // In production, decrypt this
      ...((integration.settings as Record<string, string>) || {}),
    };

    let result: unknown;

    if (body.action === "sync_tickets") {
      // Fetch external tickets and sync inbound
      const externalTickets = await adapter.fetchTickets(config);
      const synced: unknown[] = [];

      for (const ext of externalTickets as Record<string, unknown>[]) {
        const mapped = adapter.mapInbound(ext);
        
        // Check if already synced
        const { data: existing } = await supabase
          .from("integration_sync_log")
          .select("local_ticket_id")
          .eq("integration_id", integration.id)
          .eq("external_ticket_id", mapped.external_id as string)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Log the sync attempt
        await supabase.from("integration_sync_log").insert({
          integration_id: integration.id,
          direction: "inbound",
          entity_type: "ticket",
          external_ticket_id: mapped.external_id as string,
          local_ticket_id: existing?.local_ticket_id || null,
          action: existing ? "ticket_updated" : "ticket_created",
          status: "success",
          payload: mapped,
        });

        synced.push(mapped);
      }

      // Update last synced
      await supabase.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", integration.id);

      result = { synced: synced.length, tickets: synced };
    } else if (body.action === "push_update") {
      const ticket = body.payload as Record<string, unknown>;
      const mapped = adapter.mapOutbound(ticket);
      await adapter.pushUpdate(config, { ...mapped, external_id: ticket.external_id, title: ticket.title });

      await supabase.from("integration_sync_log").insert({
        integration_id: integration.id,
        direction: "outbound",
        entity_type: "ticket",
        external_ticket_id: ticket.external_id as string,
        local_ticket_id: ticket.id as string,
        action: "status_updated",
        status: "success",
        payload: mapped,
      });

      result = { success: true };
    } else if (body.action === "webhook_inbound") {
      // Handle incoming webhook from external platform
      const mapped = adapter.mapInbound(body.payload as Record<string, unknown>);

      await supabase.from("integration_sync_log").insert({
        integration_id: integration.id,
        direction: "inbound",
        entity_type: "ticket",
        external_ticket_id: mapped.external_id as string,
        action: "webhook_received",
        status: "success",
        payload: mapped,
      });

      result = { received: true, mapped };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Sync error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
