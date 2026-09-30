// Outbound / on-demand sync with helpdesk platforms (Zendesk, Freshdesk, Jira, ServiceNow).
//
// Security model
//  * caller must be the integration owner (or an admin);
//  * the platform URL is validated (https, platform host allow-list, no IP literals, no private DNS
//    results) BEFORE any request carrying the customer's credentials is made, and redirects are refused;
//  * authoritative fields (platform_url, api_key) can never be overridden by the free-form settings JSON;
//  * every value interpolated into a URL path / JQL is validated or encoded;
//  * upstream error bodies are logged server-side only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { z } from 'https://esm.sh/zod@3.23.8';
import { authenticateUser, corsHeaders, jsonResponse, preflight, withinRateLimit } from '../_shared/security.ts';
import { decryptSecret } from '../_shared/credentials-crypto.ts';
import { assertJiraProjectKey, assertSafeOutboundUrl, pathSegment } from '../_shared/ssrf.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EXTERNAL_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const LOCAL_STATUSES = new Set(['new', 'in_progress', 'waiting_for_client', 'resolved', 'closed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SyncRequestSchema = z.object({
  integration_id: z.string().uuid(),
  action: z.enum(['sync_tickets', 'push_update', 'webhook_inbound']),
  payload: z.unknown().optional(),
});

// Only these keys of integrations.settings are honoured, and they can never replace platform_url / api_key.
const ALLOWED_SETTINGS = ['email', 'project_key', 'password', 'password_ciphertext'] as const;

type Config = { platform_url: string; api_key: string; email?: string; project_key?: string; password?: string };

async function upstream(url: string, init: RequestInit): Promise<Response> {
  return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
}

function basic(user: string, secret: string): string {
  return `Basic ${btoa(`${user}:${secret}`)}`;
}

const platformAdapters: Record<string, {
  fetchTickets: (config: Config) => Promise<unknown[]>;
  pushUpdate: (config: Config, ticket: Record<string, unknown>) => Promise<unknown>;
  mapInbound: (externalTicket: Record<string, unknown>) => Record<string, unknown>;
  mapOutbound: (localTicket: Record<string, unknown>) => Record<string, unknown>;
}> = {
  zendesk: {
    async fetchTickets(config) {
      const resp = await upstream(`${config.platform_url}/api/v2/tickets.json?sort_by=updated_at&sort_order=desc&per_page=50`, {
        headers: { Authorization: basic(`${config.email}/token`, config.api_key), 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Zendesk API error: ${resp.status}`);
      const data = await resp.json();
      return data.tickets || [];
    },
    async pushUpdate(config, ticket) {
      const resp = await upstream(`${config.platform_url}/api/v2/tickets/${pathSegment(ticket.external_id)}.json`, {
        method: 'PUT',
        headers: { Authorization: basic(`${config.email}/token`, config.api_key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: { status: ticket.status, comment: { body: ticket.comment } } }),
      });
      if (!resp.ok) throw new Error(`Zendesk push error: ${resp.status}`);
      return resp.json();
    },
    mapInbound(ext) {
      const statusMap: Record<string, string> = { new: 'new', open: 'in_progress', pending: 'waiting_for_client', solved: 'resolved', closed: 'closed' };
      const urgencyMap: Record<string, string> = { low: 'low', normal: 'medium', high: 'high', urgent: 'critical' };
      return {
        title: ext.subject,
        description: ext.description,
        status: statusMap[ext.status as string] || 'new',
        urgency: urgencyMap[ext.priority as string] || 'medium',
        external_id: String(ext.id),
      };
    },
    mapOutbound(local) {
      const statusMap: Record<string, string> = { new: 'new', in_progress: 'open', waiting_for_client: 'pending', resolved: 'solved', closed: 'closed' };
      return { status: statusMap[local.status as string] || 'open', comment: `Updated from Qurtuba: ${local.title}` };
    },
  },
  freshdesk: {
    async fetchTickets(config) {
      const resp = await upstream(`${config.platform_url}/api/v2/tickets?order_by=updated_at&order_type=desc&per_page=50`, {
        headers: { Authorization: basic(config.api_key, 'X'), 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Freshdesk API error: ${resp.status}`);
      return await resp.json();
    },
    async pushUpdate(config, ticket) {
      const resp = await upstream(`${config.platform_url}/api/v2/tickets/${pathSegment(ticket.external_id)}`, {
        method: 'PUT',
        headers: { Authorization: basic(config.api_key, 'X'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: ticket.status }),
      });
      if (!resp.ok) throw new Error(`Freshdesk push error: ${resp.status}`);
      return resp.json();
    },
    mapInbound(ext) {
      const statusMap: Record<number, string> = { 2: 'new', 3: 'waiting_for_client', 4: 'resolved', 5: 'closed' };
      const urgencyMap: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' };
      return {
        title: ext.subject,
        description: ext.description_text,
        status: statusMap[ext.status as number] || 'new',
        urgency: urgencyMap[ext.priority as number] || 'medium',
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
      const projectKey = assertJiraProjectKey(config.project_key);
      const jql = encodeURIComponent(`project=${projectKey} ORDER BY updated DESC`);
      const resp = await upstream(`${config.platform_url}/rest/api/3/search?jql=${jql}&maxResults=50`, {
        headers: { Authorization: basic(String(config.email), config.api_key), 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`Jira API error: ${resp.status}`);
      const data = await resp.json();
      return data.issues || [];
    },
    async pushUpdate(config, ticket) {
      const resp = await upstream(`${config.platform_url}/rest/api/3/issue/${pathSegment(ticket.external_id)}`, {
        method: 'PUT',
        headers: { Authorization: basic(String(config.email), config.api_key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { summary: ticket.title } }),
      });
      if (!resp.ok) throw new Error(`Jira push error: ${resp.status}`);
      return { success: true };
    },
    mapInbound(ext) {
      const fields = (ext.fields ?? {}) as Record<string, unknown>;
      const priority = ((fields.priority as Record<string, string>)?.name ?? 'medium').toLowerCase();
      const urgencyMap: Record<string, string> = { lowest: 'low', low: 'low', medium: 'medium', high: 'high', highest: 'critical' };
      return {
        title: fields.summary || ext.key,
        description: typeof fields.description === 'string' ? fields.description : '',
        status: 'new',
        urgency: urgencyMap[priority] || 'medium',
        external_id: ext.key as string,
      };
    },
    mapOutbound(local) {
      return { summary: local.title };
    },
  },
  servicenow: {
    async fetchTickets(config) {
      const resp = await upstream(`${config.platform_url}/api/now/table/incident?sysparm_limit=50&sysparm_order_by=sys_updated_on%20desc`, {
        headers: { Authorization: basic(config.api_key, String(config.password ?? '')), 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`ServiceNow API error: ${resp.status}`);
      const data = await resp.json();
      return data.result || [];
    },
    async pushUpdate(config, ticket) {
      const resp = await upstream(`${config.platform_url}/api/now/table/incident/${pathSegment(ticket.external_id)}`, {
        method: 'PATCH',
        headers: { Authorization: basic(config.api_key, String(config.password ?? '')), 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_description: ticket.title, state: ticket.status }),
      });
      if (!resp.ok) throw new Error(`ServiceNow push error: ${resp.status}`);
      return resp.json();
    },
    mapInbound(ext) {
      const stateMap: Record<string, string> = { '1': 'new', '2': 'in_progress', '3': 'waiting_for_client', '6': 'resolved', '7': 'closed' };
      const urgencyMap: Record<string, string> = { '1': 'critical', '2': 'high', '3': 'medium', '4': 'low' };
      return {
        title: ext.short_description,
        description: ext.description,
        status: stateMap[ext.state as string] || 'new',
        urgency: urgencyMap[ext.urgency as string] || 'medium',
        external_id: ext.sys_id as string,
      };
    },
    mapOutbound(local) {
      const stateMap: Record<string, string> = { new: '1', in_progress: '2', waiting_for_client: '3', resolved: '6', closed: '7' };
      return { state: stateMap[local.status as string] || '1', short_description: local.title };
    },
  },
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  try {
    const user = await authenticateUser(req);
    if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!(await withinRateLimit(supabase, `integration-sync:${user.id}`, 30, 60, true))) {
      return jsonResponse(req, { error: 'Too many requests' }, 429);
    }

    const parsedBody = SyncRequestSchema.safeParse(await req.json());
    if (!parsedBody.success) return jsonResponse(req, { error: parsedBody.error.flatten().fieldErrors }, 400);
    const body = parsedBody.data;

    const { data: integration, error: intError } = await supabase
      .from('integrations')
      .select('id, platform, platform_url, client_id, status, settings, api_key_ciphertext, api_key_encrypted')
      .eq('id', body.integration_id)
      .maybeSingle();
    if (intError || !integration) return jsonResponse(req, { error: 'Integration not found' }, 404);

    // The caller must own this integration (or be an admin).
    if (integration.client_id !== user.id) {
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'super_admin'])
        .limit(1)
        .maybeSingle();
      if (!adminRole) return jsonResponse(req, { error: 'Forbidden' }, 403);
    }
    if (integration.status === 'inactive') return jsonResponse(req, { error: 'Integration is disabled' }, 409);

    const adapter = platformAdapters[integration.platform];
    if (!adapter) return jsonResponse(req, { error: 'Unsupported platform' }, 400);

    // Validate the outbound URL before any credential leaves the platform.
    let baseUrl: string;
    try {
      const u = await assertSafeOutboundUrl(String(integration.platform_url), integration.platform);
      baseUrl = u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) {
      return jsonResponse(req, { error: e instanceof Error ? e.message : 'Invalid platform URL' }, 400);
    }

    // Credentials: prefer the encrypted column; the legacy plaintext column is only a fallback.
    let apiKey = '';
    if (integration.api_key_ciphertext) {
      apiKey = await decryptSecret(integration.api_key_ciphertext);
    } else if (integration.api_key_encrypted && integration.api_key_encrypted !== 'ENCRYPTED') {
      apiKey = integration.api_key_encrypted;
    }

    // Free-form settings first (whitelisted keys only), authoritative fields last.
    const rawSettings = (integration.settings && typeof integration.settings === 'object' ? integration.settings : {}) as Record<string, unknown>;
    const settings: Record<string, string> = {};
    for (const key of ALLOWED_SETTINGS) {
      if (typeof rawSettings[key] === 'string') settings[key] = rawSettings[key] as string;
    }
    if (settings.password_ciphertext) {
      settings.password = await decryptSecret(settings.password_ciphertext);
      delete settings.password_ciphertext;
    }
    const config: Config = { ...settings, platform_url: baseUrl, api_key: apiKey };

    let result: unknown;

    if (body.action === 'sync_tickets') {
      const externalTickets = await adapter.fetchTickets(config);
      const synced: unknown[] = [];

      for (const ext of externalTickets as Record<string, unknown>[]) {
        const mapped = adapter.mapInbound(ext);
        const externalId = String(mapped.external_id ?? '');
        if (!EXTERNAL_ID_RE.test(externalId)) continue;

        const { data: existing } = await supabase
          .from('integration_sync_log')
          .select('local_ticket_id')
          .eq('integration_id', integration.id)
          .eq('external_ticket_id', externalId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        await supabase.from('integration_sync_log').insert({
          integration_id: integration.id,
          direction: 'inbound',
          entity_type: 'ticket',
          external_ticket_id: externalId,
          local_ticket_id: existing?.local_ticket_id || null,
          action: existing ? 'ticket_updated' : 'ticket_created',
          status: 'success',
          payload: mapped,
        });
        synced.push(mapped);
      }

      await supabase.from('integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id);
      result = { synced: synced.length, tickets: synced };
    } else if (body.action === 'push_update') {
      const ticket = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
      const externalId = String(ticket.external_id ?? '');
      if (!EXTERNAL_ID_RE.test(externalId)) return jsonResponse(req, { error: 'payload.external_id is invalid' }, 400);
      const title = String(ticket.title ?? '').slice(0, 500);
      const status = LOCAL_STATUSES.has(String(ticket.status)) ? String(ticket.status) : 'in_progress';
      const localId = typeof ticket.id === 'string' && UUID_RE.test(ticket.id) ? ticket.id : null;

      // A local ticket reference must belong to the integration owner.
      if (localId) {
        const { data: owned } = await supabase.from('tickets').select('id').eq('id', localId).eq('client_id', integration.client_id).maybeSingle();
        if (!owned) return jsonResponse(req, { error: 'Ticket not found' }, 404);
      }

      const mapped = adapter.mapOutbound({ title, status });
      await adapter.pushUpdate(config, { ...mapped, external_id: externalId, title });

      await supabase.from('integration_sync_log').insert({
        integration_id: integration.id,
        direction: 'outbound',
        entity_type: 'ticket',
        external_ticket_id: externalId,
        local_ticket_id: localId,
        action: 'status_updated',
        status: 'success',
        payload: mapped,
      });
      result = { success: true };
    } else {
      // webhook_inbound (authenticated relay): validate and log only.
      const mapped = adapter.mapInbound((body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>);
      const externalId = String(mapped.external_id ?? '');
      if (!EXTERNAL_ID_RE.test(externalId)) return jsonResponse(req, { error: 'Could not extract a valid ticket id' }, 400);
      await supabase.from('integration_sync_log').insert({
        integration_id: integration.id,
        direction: 'inbound',
        entity_type: 'ticket',
        external_ticket_id: externalId,
        action: 'webhook_received',
        status: 'success',
        payload: mapped,
      });
      result = { received: true, mapped };
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Sync error:', err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: 'Sync failed. Check the integration settings and try again.' }, 500);
  }
});
