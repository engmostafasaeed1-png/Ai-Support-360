// Admin endpoint: confirms a proposed reschedule slot and sends the requester a
// confirmation email with a tokenized link to their request page.
//
// Security: the link is always built from the server-side SITE_URL (never from the request
// body), and the caller must be an admin / super admin.
import {
  ADMIN_ROLES,
  adminClient,
  authenticateUser,
  getUserRoles,
  hasAnyRole,
  jsonResponse,
  preflight,
  SITE_URL,
} from '../_shared/security.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return jsonResponse(req, { error: 'Server misconfigured' }, 500);
  }

  // AuthN + AuthZ: a real user JWT whose account holds an admin role.
  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) {
    return jsonResponse(req, { error: 'Forbidden' }, 403);
  }

  let body: { request_id?: string; slot_index?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const requestId = body.request_id;
  const slotIndex = Number.isInteger(body.slot_index) ? (body.slot_index as number) : 0;
  const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : undefined;
  if (!requestId || !UUID_RE.test(requestId)) return jsonResponse(req, { error: 'request_id is required' }, 400);

  // Call the RPC as the user (the RPC re-checks the admin role).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: row, error: rpcErr } = await userClient.rpc('admin_confirm_reschedule_slot', {
    _request_id: requestId,
    _slot_index: slotIndex,
    _note: note,
  });
  if (rpcErr) return jsonResponse(req, { error: rpcErr.message }, 400);

  const { data: request, error: reqErr } = await admin
    .from('demo_requests')
    .select('email, full_name, request_token, scheduled_date, scheduled_slot, timezone')
    .eq('id', requestId)
    .maybeSingle();
  if (reqErr || !request) return jsonResponse(req, { ok: true, warning: 'request not found for email' });

  const templateName = 'demo-reschedule-confirmed';
  const logRow = async (status: string, error_message?: string) => {
    const { error: logErr } = await admin.from('email_send_log').insert({
      message_id: null, template_name: templateName, recipient_email: request.email, status, error_message: error_message ?? null,
    });
    if (logErr) console.error('send log failed', { code: logErr.code, message: logErr.message });
  };
  try {
    const result = await sendTemplateEmail(templateName, request.email, {
      idempotencyKey: `demo-reschedule-confirmed-${requestId}-${request.scheduled_date}-${request.scheduled_slot}`,
      templateData: {
        name: request.full_name,
        confirmationUrl: `${SITE_URL}/demo/confirmation/${request.request_token}`,
        scheduledDate: request.scheduled_date,
        scheduledSlot: request.scheduled_slot,
        timezone: request.timezone,
      },
    });
    await logRow(result.sent ? 'sent' : 'suppressed');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Failed to send confirmation email', msg);
    await logRow('failed', msg.slice(0, 1000));
  }

  return jsonResponse(req, { ok: true, request: row });
});
