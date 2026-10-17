import { adminClient, authenticateUser, getUserRoles, ADMIN_ROLES, hasAnyRole, timingSafeEqual, jsonResponse, preflight } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { adminMailLink, ADMIN_MAIL_ATTEMPTS } from '../_shared/admin-notification-email.ts';

async function deliver(id: string) {
  const admin = adminClient();
  for (let attempt = 0; attempt < ADMIN_MAIL_ATTEMPTS; attempt++) {
    const { data: row, error: claimError } = await admin.rpc('claim_admin_notification_email', { _id: id });
    if (claimError || !row) return;
    let retryDelay = 1000 * (attempt + 1);
    try {
      const { data: recipient, error } = await admin.auth.admin.getUserById(row.user_id);
      if (error || !recipient?.user?.email) throw new Error('Recipient email unavailable');
      const result = await sendTemplateEmail('admin-notification', recipient.user.email, {
        templateData: { title: row.title, body: row.body, url: adminMailLink(row.link) },
        idempotencyKey: `admin-notification-${id}`,
      });
      const reason = result.sent ? null : result.reason;
      const { error: finishError } = await admin.rpc('finish_admin_notification_email', { _id: id, _attempt: row.retry_count, _handled: true, _error: reason });
      if (finishError) throw new Error('Could not record email outcome');
      return;
    } catch (error) {
      const failure = error as { status?: number; retryAfterSeconds?: number; code?: string };
      if (failure.status === 429) retryDelay = Math.max(1000, (failure.retryAfterSeconds ?? 60) * 1000);
      const detail = failure.status === 429 ? 'provider rate limited' : 'email send failed';
      await admin.rpc('finish_admin_notification_email', { _id: id, _attempt: row.retry_count, _handled: false, _error: detail });
      if (row.retry_count >= ADMIN_MAIL_ATTEMPTS) return;
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('ADMIN_NOTIFICATION_EMAIL_SECRET');
  if (!secret) return jsonResponse(req, { error: 'Email event authentication is not configured' }, 503);
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse(req, { error: 'Invalid request' }, 400); }
  // One-time authenticated setup copies the generated secret to Vault entirely server-side.
  if (body?.action === 'configure') {
    const user = await authenticateUser(req);
    const admin = adminClient();
    if (!user || !hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Unauthorized' }, 401);
    const { error } = await admin.rpc('configure_admin_notification_email', {
      _secret: secret, _url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/admin-notification-email`,
    });
    return jsonResponse(req, error ? { error: 'Could not configure email events' } : { configured: true }, error ? 500 : 200);
  }
  const supplied = req.headers.get('x-admin-email-secret') ?? '';
  if (!supplied || !timingSafeEqual(supplied, secret)) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const id = body?.notification_id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return jsonResponse(req, { error: 'Invalid notification ID' }, 400);
  EdgeRuntime.waitUntil(deliver(id));
  return jsonResponse(req, { accepted: true }, 202);
});