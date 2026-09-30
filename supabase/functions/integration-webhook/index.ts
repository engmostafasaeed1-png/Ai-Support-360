// Inbound webhook for helpdesk platforms (Zendesk, Freshdesk, Jira, ServiceNow).
//
// Third-party platforms cannot send a Supabase JWT, so this function is deployed with
// verify_jwt = false (see supabase/config.toml). Authentication is therefore done here:
//   * the integration must exist, be active and have a webhook secret (every integration now has one),
//   * the caller proves knowledge of the webhook secret either with the x-webhook-secret header or with an
//     HMAC-SHA256 body signature (x-hub-signature-256 / x-hub-signature, e.g. Jira); never via the URL,
//     and all comparisons are constant-time,
//   * unknown integration and wrong secret return the same 401 so integration IDs cannot be probed,
//   * the payload is size-limited and every mapped field is validated before anything is written,
//   * updates only touch local tickets that belong to the integration owner.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { clientIp, corsHeaders, timingSafeEqual, withinRateLimit } from '../_shared/security.ts';

const MAX_BODY_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const LOCAL_STATUSES = new Set(['new', 'in_progress', 'waiting_for_client', 'resolved', 'closed']);
const LOCAL_URGENCIES = new Set(['low', 'medium', 'high', 'critical']);

type Parsed = { event: string; ticket: Record<string, unknown> };
type Parser = (body: Record<string, unknown>) => Parsed | null;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const parseZendeskPayload: Parser = (body) => {
  const ticket = asRecord(body.ticket ?? body);
  if (!ticket.id) return null;
  const statusMap: Record<string, string> = { new: 'new', open: 'in_progress', pending: 'waiting_for_client', solved: 'resolved', closed: 'closed' };
  const urgencyMap: Record<string, string> = { low: 'low', normal: 'medium', high: 'high', urgent: 'critical' };
  return {
    event: typeof body.event === 'string' ? body.event : 'ticket_updated',
    ticket: {
      title: ticket.subject ?? ticket.title,
      description: ticket.description,
      status: statusMap[String(ticket.status)] || 'new',
      urgency: urgencyMap[String(ticket.priority)] || 'medium',
      external_id: String(ticket.id),
    },
  };
};

const parseFreshdeskPayload: Parser = (body) => {
  const data = asRecord(body.freshdesk_webhook ?? body);
  const ticket = asRecord(data.ticket_data ?? data);
  if (!ticket.id) return null;
  const statusMap: Record<number, string> = { 2: 'new', 3: 'waiting_for_client', 4: 'resolved', 5: 'closed' };
  const urgencyMap: Record<number, string> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' };
  return {
    event: typeof data.event === 'string' ? data.event : 'ticket_updated',
    ticket: {
      title: ticket.subject,
      description: ticket.description_text ?? ticket.description,
      status: statusMap[Number(ticket.status)] || 'new',
      urgency: urgencyMap[Number(ticket.priority)] || 'medium',
      external_id: String(ticket.id),
    },
  };
};

const parseJiraPayload: Parser = (body) => {
  const issue = asRecord(body.issue ?? body);
  const fields = asRecord(issue.fields);
  const key = typeof issue.key === 'string' ? issue.key : '';
  if (!key && !issue.id) return null;
  const priority = String(asRecord(fields.priority).name ?? 'medium').toLowerCase();
  const urgencyMap: Record<string, string> = { lowest: 'low', low: 'low', medium: 'medium', high: 'high', highest: 'critical' };
  return {
    event: typeof body.webhookEvent === 'string' ? body.webhookEvent : 'jira:issue_updated',
    ticket: {
      title: fields.summary ?? key,
      description: typeof fields.description === 'string' ? fields.description : '',
      status: 'new',
      urgency: urgencyMap[priority] || 'medium',
      external_id: key || String(issue.id),
    },
  };
};

const parseServiceNowPayload: Parser = (body) => {
  const incident = asRecord(body.incident ?? body);
  if (!incident.sys_id && !incident.number) return null;
  const stateMap: Record<string, string> = { '1': 'new', '2': 'in_progress', '3': 'waiting_for_client', '6': 'resolved', '7': 'closed' };
  const urgencyMap: Record<string, string> = { '1': 'critical', '2': 'high', '3': 'medium', '4': 'low' };
  return {
    event: typeof body.event === 'string' ? body.event : 'incident_updated',
    ticket: {
      title: incident.short_description,
      description: incident.description,
      status: stateMap[String(incident.state)] || 'new',
      urgency: urgencyMap[String(incident.urgency)] || 'medium',
      external_id: String(incident.sys_id ?? incident.number),
    },
  };
};

const parsers: Record<string, Parser> = {
  zendesk: parseZendeskPayload,
  freshdesk: parseFreshdeskPayload,
  jira: parseJiraPayload,
  servicenow: parseServiceNowPayload,
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function validSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const provided = header.trim().toLowerCase().replace(/^sha256=/, '');
  return timingSafeEqual(provided, await hmacHex(secret, rawBody));
}

function respond(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);

  // Expected path: /integration-webhook/{platform}/{integration_id}
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const platform = parts[1] ?? '';
  const integrationId = parts[2] ?? '';
  const parser = parsers[platform];
  if (!parser || !UUID_RE.test(integrationId)) {
    return respond(req, { error: 'URL must be /integration-webhook/{platform}/{integration_id}' }, 400);
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) return respond(req, { error: 'Payload too large' }, 413);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Throttle before doing any work (per integration and per source IP).
    const withinIntegration = await withinRateLimit(supabase, `webhook:${integrationId}`, 120, 60, true);
    const withinIp = await withinRateLimit(supabase, `webhook-ip:${clientIp(req)}`, 300, 60, true);
    if (!withinIntegration || !withinIp) return respond(req, { error: 'Too many requests' }, 429);

    const { data: integration } = await supabase
      .from('integrations')
      .select('id, platform, client_id, webhook_secret, status')
      .eq('id', integrationId)
      .eq('platform', platform)
      .maybeSingle();

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) return respond(req, { error: 'Payload too large' }, 413);

    // Constant-time authentication; unknown integrations and wrong secrets are indistinguishable.
    const expected = integration?.webhook_secret ?? crypto.randomUUID() + crypto.randomUUID();
    const headerSecret = req.headers.get('x-webhook-secret') ?? '';
    const secretOk = headerSecret.length >= 32 && timingSafeEqual(headerSecret, expected);
    const signatureOk = await validSignature(
      expected,
      rawBody,
      req.headers.get('x-hub-signature-256') ?? req.headers.get('x-hub-signature'),
    );
    if (!integration || !(secretOk || signatureOk)) return respond(req, { error: 'Unauthorized' }, 401);
    if (integration.status !== 'active') return respond(req, { error: 'Integration is not active' }, 403);
    let body: Record<string, unknown>;
    try {
      body = asRecord(JSON.parse(rawBody));
    } catch {
      return respond(req, { error: 'Invalid JSON body' }, 400);
    }

    const parsed = parser(body);
    const externalId = parsed ? String(parsed.ticket.external_id ?? '') : '';
    if (!parsed || !EXTERNAL_ID_RE.test(externalId)) {
      await supabase.from('integration_sync_log').insert({
        integration_id: integration.id,
        direction: 'inbound',
        entity_type: 'ticket',
        action: 'webhook_skipped',
        status: 'skipped',
        error_message: 'Could not parse payload',
      });
      return respond(req, { status: 'skipped', reason: 'Could not extract ticket data from payload' });
    }

    // Validate / normalise everything that may be written to the tickets table.
    const title = String(parsed.ticket.title ?? '').trim().slice(0, 500);
    const description = String(parsed.ticket.description ?? '').slice(0, 8000);
    const status = LOCAL_STATUSES.has(String(parsed.ticket.status)) ? String(parsed.ticket.status) : 'new';
    const urgency = LOCAL_URGENCIES.has(String(parsed.ticket.urgency)) ? String(parsed.ticket.urgency) : 'medium';
    const safeTicket = { title, description, status, urgency, external_id: externalId };

    const { data: existingSync } = await supabase
      .from('integration_sync_log')
      .select('local_ticket_id')
      .eq('integration_id', integration.id)
      .eq('external_ticket_id', externalId)
      .eq('status', 'success')
      .not('local_ticket_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let updatedLocalId: string | null = null;
    if (existingSync?.local_ticket_id && title) {
      // Only ever touch tickets that belong to the integration owner.
      const { data: updated } = await supabase
        .from('tickets')
        .update({ title, description, status, urgency })
        .eq('id', existingSync.local_ticket_id)
        .eq('client_id', integration.client_id)
        .select('id')
        .maybeSingle();
      updatedLocalId = updated?.id ?? null;
    }

    await supabase.from('integration_sync_log').insert({
      integration_id: integration.id,
      direction: 'inbound',
      entity_type: 'ticket',
      external_ticket_id: externalId,
      local_ticket_id: updatedLocalId,
      action: updatedLocalId ? 'webhook_ticket_updated' : 'webhook_ticket_received',
      status: 'success',
      payload: safeTicket,
    });
    await supabase.from('integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id);

    return respond(req, {
      status: 'ok',
      event: parsed.event,
      action: updatedLocalId ? 'updated' : 'received',
      external_id: externalId,
      local_ticket_id: updatedLocalId,
    });
  } catch (err) {
    console.error('Webhook processing error:', err instanceof Error ? err.message : String(err));
    return respond(req, { error: 'Internal error' }, 500);
  }
});
