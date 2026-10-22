// "Send test to me" for the Refer & earn e-mails (admin preview). Admins and super admins only (checked in code).
// The recipient is ALWAYS the signed-in admin's own confirmed address, read from the verified token - never from the
// request. Sample data only (masked sample name, sample amount), live programme numbers, subject prefixed "[TEST] ".
// Writes no queue row, notification or referral record. Rate limited per admin (6 per hour). Body: { kind, lang }.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import {
  REFERRAL_BANNER_URL, REFERRAL_EMAIL_KINDS, REFERRAL_EMAIL_SETTING_KEYS, referralEmailSettingsFrom, sampleReferralEmail,
  type ReferralEmailKind,
} from '../_shared/referralEmail.ts';
import { SENDER_SETTING_KEYS, senderFromSettings } from '../_shared/emailSender.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const roles = await getUserRoles(admin, caller.id);
  if (!hasAnyRole(roles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);

  let body: { kind?: unknown; lang?: unknown } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const kind = String(body.kind ?? '');
  if (!(REFERRAL_EMAIL_KINDS as readonly string[]).includes(kind)) return jsonResponse(req, { error: 'Choose one of the referral e-mails' }, 400);
  const lang = body.lang === 'ar' ? 'ar' : body.lang === 'en' || body.lang == null ? 'en' : null;
  if (!lang) return jsonResponse(req, { error: 'Language must be en or ar' }, 400);

  const { data: u } = await admin.auth.admin.getUserById(caller.id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return jsonResponse(req, { error: 'Your own e-mail address is not confirmed' }, 400);
  if (!(await withinRateLimit(admin, `referral-email-test:${caller.id}`, 6, 3600))) {
    return jsonResponse(req, { error: 'Too many test e-mails, try again later' }, 429);
  }

  const { data: settingRows } = await admin.from('platform_settings').select('key, value').in('key', [...REFERRAL_EMAIL_SETTING_KEYS, ...SENDER_SETTING_KEYS]);
  const sender = senderFromSettings(settingRows);
  let bannerUrl: string | null = null;
  try { const r = await fetch(REFERRAL_BANNER_URL, { method: 'HEAD' }); if (r.ok) bannerUrl = REFERRAL_BANNER_URL; } catch { /* without banner */ }
  try {
    const r = await sendTemplateEmail('referral-notice', email, {
      templateData: { ...sampleReferralEmail(kind as ReferralEmailKind, lang), settings: referralEmailSettingsFrom(settingRows), siteUrl: SITE_URL, bannerUrl, test: true, contactEmail: sender.contactEmail },
      subjectPrefix: '[TEST] ',
      displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
      idempotencyKey: `referral-email-test-${caller.id}-${crypto.randomUUID()}`,
    });
    return jsonResponse(req, { ok: r.sent, reason: r.sent ? undefined : r.reason, to: 'self',
      from: `${sender.displayName} <${sender.fromLocal}@aisupport360.com>`, reply_to: sender.replyTo }, 200);
  } catch (e) {
    const err = e as { code?: string; status?: number };
    return jsonResponse(req, { ok: false, error: err.code ?? 'send_failed' }, 502);
  }
});
