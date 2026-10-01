// Public, token-gated notifier used by the demo confirmation page after a visitor proposes
// new time slots.
//
// The caller only supplies the secret request token. Recipient, name, proposed slots and the
// confirmation link are all read from the database here, so this endpoint cannot be used to
// send arbitrary email (the generic send-transactional-email function is service-role only).
import {
  adminClient,
  clientIp,
  jsonResponse,
  preflight,
  SITE_URL,
  withinRateLimit,
} from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const TOKEN_RE = /^[a-f0-9]{32}$/;
const RESCHEDULE_WINDOW_MS = 15 * 60 * 1000;

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
  const withinIp = await withinRateLimit(admin, `demo-notify:ip:${clientIp(req)}`, 20, 3600);
  const withinToken = await withinRateLimit(admin, `demo-notify:token:${token}`, 3, 3600);
  if (!withinIp || !withinToken) return jsonResponse(req, { error: 'Too many requests' }, 429);

  // Uniform answer whether or not the token exists, so it cannot be probed.
  const accepted = () => jsonResponse(req, { ok: true });

  const { data: row, error } = await admin
    .from('demo_requests')
    .select('id, email, full_name, request_token, status, proposed_slots, reschedule_reason, reschedule_requested_at')
    .eq('request_token', token)
    .maybeSingle();
  if (error || !row) return accepted();

  // Only notify right after a genuine reschedule request was recorded by the RPC.
  const requestedAt = row.reschedule_requested_at ? new Date(row.reschedule_requested_at).getTime() : 0;
  if (row.status !== 'rescheduling' || !requestedAt || Date.now() - requestedAt > RESCHEDULE_WINDOW_MS) {
    return accepted();
  }

  const templateName = 'demo-reschedule-received';
  const logRow = async (status: string, error_message?: string) => {
    const { error: logErr } = await admin.from('email_send_log').insert({
      message_id: null, template_name: templateName, recipient_email: row.email, status, error_message: error_message ?? null,
    });
    if (logErr) console.error('demo-reschedule-notify: send log failed', { code: logErr.code, message: logErr.message });
  };
  try {
    const result = await sendTemplateEmail(templateName, row.email, {
      idempotencyKey: `demo-reschedule-received-${row.id}-${row.reschedule_requested_at}`,
      templateData: {
        name: row.full_name,
        confirmationUrl: `${SITE_URL}/demo/confirmation/${row.request_token}`,
        proposedSlots: row.proposed_slots ?? [],
        reason: row.reschedule_reason ?? undefined,
      },
    });
    await logRow(result.sent ? 'sent' : 'suppressed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('demo-reschedule-notify: send failed:', msg);
    await logRow('failed', msg.slice(0, 1000));
  }
  return accepted();
});
