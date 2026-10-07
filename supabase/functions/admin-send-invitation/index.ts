// Admin-only: emails one person an invitation to sign up as consultant or client.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body.email || '').trim().toLowerCase();
  const role = body.role === 'consultant' ? 'consultant' : 'client';
  const name = String(body.name || '').trim().slice(0, 80) || undefined;
  const message = String(body.message || '').trim().slice(0, 500) || undefined;
  if (!EMAIL_RE.test(email) || email.length > 254) return jsonResponse(req, { error: 'Valid email is required' }, 400);

  const url = `${SITE_URL}/signup?role=${role}&email=${encodeURIComponent(email)}&invite=admin`;
  try {
    const res = await sendTemplateEmail('platform-invitation', email, {
      templateData: { name, role, message, url },
      idempotencyKey: `invite-${role}-${email}-${crypto.randomUUID()}`,
    });
    return jsonResponse(req, res.sent ? { sent: true } : { sent: false, reason: res.reason });
  } catch (e) {
    console.error('invite failed', e);
    return jsonResponse(req, { error: 'Could not send the email' }, 500);
  }
});
