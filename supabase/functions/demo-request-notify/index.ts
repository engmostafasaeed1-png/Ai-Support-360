// Public, token-gated notifier used by the demo wizard and the contact form right after a request was submitted.
//
// The caller only supplies the secret request token. Recipient, name, requested slot and the
// confirmation link are all read from the database here, so this endpoint cannot be used to
// send arbitrary email (the generic send-transactional-email function is service-role only).
// Two e-mails go out: a confirmation to the visitor and an alert to the team mailbox.
import {
  adminClient,
  clientIp,
  jsonResponse,
  preflight,
  SITE_URL,
  withinRateLimit,
} from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { TEAM_EMAIL } from '../_shared/contact.ts';

const TOKEN_RE = /^[a-f0-9]{32}$/;
const NEW_REQUEST_WINDOW_MS = 15 * 60 * 1000;

const DEMO_LABELS: Record<string, string> = {
  'live': 'Live platform walkthrough',
  'ai-triage': 'AI triage demo',
  'pricing-roi': 'Pricing & ROI call',
  'module-deep-dive': 'Custom module deep-dive',
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  let token = '';
  try {
    const body = await req.json();
    token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  if (!TOKEN_RE.test(token)) return jsonResponse(req, { error: 'Invalid token' }, 400);

  const admin = adminClient();
  const withinIp = await withinRateLimit(admin, `demo-request-notify:ip:${clientIp(req)}`, 20, 3600);
  const withinToken = await withinRateLimit(admin, `demo-request-notify:token:${token}`, 3, 3600);
  if (!withinIp || !withinToken) return jsonResponse(req, { error: 'Too many requests' }, 429);

  // Uniform answer whether or not the token exists, so it cannot be probed.
  const accepted = () => jsonResponse(req, { ok: true });

  const { data: row, error } = await admin
    .from('demo_requests')
    .select('id, email, full_name, company, notes, source, request_token, status, demo_type, scheduling_preference, scheduled_date, scheduled_slot, timezone, created_at')
    .eq('request_token', token)
    .maybeSingle();
  if (error || !row) return accepted();

  // Only right after the request was created, and only while nobody has handled it yet.
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
  if (row.status !== 'received' || !createdAt || Date.now() - createdAt > NEW_REQUEST_WINDOW_MS) {
    return accepted();
  }

  const isContact = row.source === 'contact-form';
  const logRow = async (templateName: string, recipient: string, status: string, error_message?: string) => {
    const { error: logErr } = await admin.from('email_send_log').insert({
      message_id: null, template_name: templateName, recipient_email: recipient, status, error_message: error_message ?? null,
    });
    if (logErr) console.error('demo-request-notify: send log failed', { code: logErr.code, message: logErr.message });
  };

  // 1. the confirmation to the visitor (a reply goes to the team mailbox)
  const confirmation = isContact ? 'contact-message-received' : 'demo-request-received';
  try {
    const result = await sendTemplateEmail(confirmation, row.email, {
      idempotencyKey: `${confirmation}-${row.id}`,
      replyTo: TEAM_EMAIL,
      templateData: {
        name: row.full_name,
        demoType: DEMO_LABELS[row.demo_type] ?? row.demo_type,
        requestedDate: row.scheduled_date ?? undefined,
        requestedSlot: row.scheduled_slot ?? undefined,
        preference: row.scheduling_preference,
        timezone: row.timezone ?? undefined,
        confirmationUrl: `${SITE_URL}/demo/confirmation/${row.request_token}`,
      },
    });
    await logRow(confirmation, row.email, result.sent ? 'sent' : 'suppressed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('demo-request-notify: confirmation failed:', msg);
    await logRow(confirmation, row.email, 'failed', msg.slice(0, 1000));
  }

  // 2. the alert to the team (a reply goes to the visitor)
  const when = row.scheduled_date
    ? `${row.scheduled_date}${row.scheduled_slot ? ` at ${row.scheduled_slot}` : ''}${row.timezone ? ` (${row.timezone})` : ''}`
    : row.scheduling_preference ?? undefined;
  try {
    const result = await sendTemplateEmail('demo-request-alert', TEAM_EMAIL, {
      idempotencyKey: `demo-request-alert-${row.id}`,
      replyTo: row.email,
      templateData: {
        name: row.full_name,
        email: row.email,
        company: row.company ?? undefined,
        demoType: isContact ? undefined : (DEMO_LABELS[row.demo_type] ?? row.demo_type),
        when: isContact ? undefined : when,
        source: row.source ?? undefined,
        notes: row.notes ? String(row.notes).slice(0, 1500) : undefined,
        adminUrl: `${SITE_URL}/admin/demo-requests`,
      },
    });
    await logRow('demo-request-alert', TEAM_EMAIL, result.sent ? 'sent' : 'suppressed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('demo-request-notify: team alert failed:', msg);
    await logRow('demo-request-alert', TEAM_EMAIL, 'failed', msg.slice(0, 1000));
  }
  return accepted();
});
