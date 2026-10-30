// Admin messages by e-mail (docs/sql/admin-message-email.sql). Woken by the database (pg_net, ame_wake) only while
// rows wait, plus a one-off timer for rate-limited rows (ame_arm); no schedule of its own. Job-token checked
// (_shared/jobAuth.ts, verify_jwt=false): it can only send what the database queued. The service-only ame_claim RPC
// applies the switch, daily cap, per-admin and per-recipient limits (digest), pause, test-tag and address rules and
// leases rows; content is only the stored notification text (_shared/adminMessageEmail.ts). Counts-only responses.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { SENDER_SETTING_KEYS, senderFromSettings } from '../_shared/emailSender.ts';
import { buildAdminMessageData, finishFor, type ClaimMail } from '../_shared/adminMessageEmail.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  if (!(await isJobCaller(req, admin))) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const { data, error } = await admin.rpc('ame_claim', { _limit: 50 });
  if (error) {
    // Before docs/sql/admin-message-email.sql is applied the RPC does not exist: nothing to send.
    console.error('admin message claim failed', error.code ?? '');
    return jsonResponse(req, { ok: false, notReady: true }, 503);
  }
  const mails = (Array.isArray(data) ? data : []) as ClaimMail[];
  if (!mails.length) return jsonResponse(req, { ok: true, claimed: 0 }, 200);
  const { data: senderRows } = await admin.from('platform_settings').select('key, value').in('key', [...SENDER_SETTING_KEYS]);
  const sender = senderFromSettings(senderRows);
  let sent = 0, skipped = 0, failed = 0;
  for (const mail of mails) {
    try {
      const res = await sendTemplateEmail('admin-message', mail.email, {
        templateData: buildAdminMessageData(mail, SITE_URL),
        idempotencyKey: mail.mail_key,
        displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
      });
      const fin = finishFor(res);
      if (fin.status === 'sent') sent++; else skipped++;
      await admin.rpc('ame_finish', { _mail_key: mail.mail_key, _status: fin.status, _reason: fin.reason ?? null });
    } catch (e) {
      failed++;
      const code = (e as { code?: string }).code;
      await admin.rpc('ame_finish', { _mail_key: mail.mail_key, _status: 'failed', _reason: String(code ?? 'send_failed').slice(0, 60) });
    }
  }
  return jsonResponse(req, { ok: true, claimed: mails.length, sent, skipped, failed }, 200);
});
