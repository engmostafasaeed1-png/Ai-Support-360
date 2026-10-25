// Support agreement e-mails (docs/sql/support-agreements.sql). Two callers:
//  * the database (pg_net, sa_wake) while rows wait in sa_email_queue - job-token checked (_shared/jobAuth.ts,
//    verify_jwt=false). It can only send what the database queued; the service-only claim RPC leases rows and drops
//    rows while the feature is off or the person paused activity e-mails. Registered, confirmed addresses only.
//  * an administrator's "Send test to me" ({ action: 'test', lang }): sample data, own address only, 6 per hour.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { SENDER_SETTING_KEYS, senderFromSettings } from '../_shared/emailSender.ts';
import { sampleAgreementEmail } from '../_shared/agreementEmail.ts';

interface Row { id: string; user_id: string; agreement_id: string; kind: string; payload: Record<string, unknown>; email: string | null }
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  const { data: senderRows } = await admin.from('platform_settings').select('key, value').in('key', [...SENDER_SETTING_KEYS]);
  const sender = senderFromSettings(senderRows);

  if (await isJobCaller(req, admin)) {
    const { data, error } = await admin.rpc('sa_claim_emails', { _limit: 50 });
    if (error) {
      console.error('agreement claim failed', error.code ?? '');
      return jsonResponse(req, { ok: false, notReady: true }, 503);
    }
    const rows = (data ?? []) as Row[];
    let sent = 0, skipped = 0, failed = 0;
    for (const row of rows) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(row.user_id);
        if (!row.email || !u?.user?.email_confirmed_at) {
          skipped++;
          await admin.rpc('sa_finish_email', { _id: row.id, _ok: false, _error: 'no_address' });
          continue;
        }
        const p = row.payload ?? {};
        const r = await sendTemplateEmail('agreement-notice', row.email, {
          templateData: { lang: p.lang === 'ar' ? 'ar' : 'en', title: str(p.title, 160), body: str(p.body, 1000), name: str(p.name, 120), path: str(p.path, 200),
            role: str(p.role, 20), siteUrl: SITE_URL, contactEmail: sender.contactEmail },
          idempotencyKey: `sa-${row.id}`,
          displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
          pause: { userId: row.user_id, category: 'activity' },
        });
        if (r.sent) sent++; else skipped++;
        await admin.rpc('sa_finish_email', { _id: row.id, _ok: r.sent, _error: r.sent ? null : r.reason ?? 'skipped' });
      } catch (e) {
        failed++;
        await admin.rpc('sa_finish_email', { _id: row.id, _ok: false, _error: (e instanceof Error ? e.message : 'send failed').slice(0, 200) });
      }
    }
    return jsonResponse(req, { ok: true, claimed: rows.length, sent, skipped, failed }, 200);
  }

  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const roles = await getUserRoles(admin, caller.id);
  if (!hasAnyRole(roles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
  let body: { action?: unknown; lang?: unknown } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  if (body.action !== 'test') return jsonResponse(req, { error: 'Unknown action' }, 400);
  const lang = body.lang === 'ar' ? 'ar' : 'en';
  const { data: u } = await admin.auth.admin.getUserById(caller.id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return jsonResponse(req, { error: 'Your own e-mail address is not confirmed' }, 400);
  if (!(await withinRateLimit(admin, `agreement-test:${caller.id}`, 6, 3600))) return jsonResponse(req, { error: 'Too many test e-mails, try again later' }, 429);
  try {
    const r = await sendTemplateEmail('agreement-notice', email, {
      templateData: { ...sampleAgreementEmail(lang), siteUrl: SITE_URL, contactEmail: sender.contactEmail, test: true },
      subjectPrefix: '[TEST] ', displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
      idempotencyKey: `agreement-test-${caller.id}-${crypto.randomUUID()}`,
    });
    return jsonResponse(req, { ok: r.sent, reason: r.sent ? undefined : r.reason, to: 'self' }, 200);
  } catch (e) {
    return jsonResponse(req, { ok: false, error: (e as { code?: string }).code ?? 'send_failed' }, 502);
  }
});
