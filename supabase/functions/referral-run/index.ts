// Feature Z e-mails: one short referral notice per event to one consultant (registered with your code, invited, passed,
// active, reminders, expired, acknowledgement request, verified, rewards earned / held / available / paid / reversed,
// referral not accepted, bank details changed) plus, once docs/sql/referral-emails.sql is applied, the monthly statement
// (to the consultant) and the weekly Refer & earn summary (to each administrator). Woken by the database (pg_net, referral_wake) only while e-mails wait in
// referral_email_queue - no permanent schedule. Credential-free like the other sweeps (verify_jwt=false): safety lives in
// the service-role-only referral_email_claim RPC (atomic, at most 5 attempts, 10-minute lease) and a call can only send
// what the database queued. Responses contain counts only. Layout: _shared/referralEmail.ts (shared with the admin preview).
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import {
  normaliseKind, NOT_APP_EMAIL_KINDS, pauseCategoryFor, REFERRAL_BANNER_URL, REFERRAL_EMAIL_SETTING_KEYS, referralEmailSettingsFrom,
  type ReferralEmailSettings,
} from '../_shared/referralEmail.ts';
import { SENDER_SETTING_KEYS, senderFromSettings, type SenderSettings } from '../_shared/emailSender.ts';

interface Row {
  id: string; user_id: string; kind: string; lang: string | null; display_name: string | null; referred_name: string | null;
  amount: number | null; currency: string | null; next_step: string | null; days: number | null; pass_mark: number | null;
}

/** The banner is a file of the published site; until it is live the e-mail goes out without it (alt-only would look broken). */
async function bannerLive(): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(REFERRAL_BANNER_URL, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(timer);
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/') ? REFERRAL_BANNER_URL : null;
  } catch {
    return null;
  }
}

/** Extra data per queued e-mail (level progress, statement / digest lines) from the service-only referral_email_payload;
 * empty until docs/sql/referral-emails.sql is applied, so the e-mail simply goes out without those blocks. */
// deno-lint-ignore no-explicit-any
async function payloadFor(admin: any, id: string): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await admin.rpc('referral_email_payload', { _id: id });
    return !error && data && typeof data === 'object' ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: Row, settings: ReferralEmailSettings, bannerUrl: string | null, sender: SenderSettings): Promise<'sent' | 'skipped'> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return 'skipped';
  const kind = normaliseKind(row.kind);
  // Campaign designs (same message to many people) are never sent through the app e-mail sender.
  if ((NOT_APP_EMAIL_KINDS as readonly string[]).includes(kind)) return 'skipped';
  const category = pauseCategoryFor(kind);
  const s = { ...settings, passMark: row.pass_mark ?? settings.passMark, activationDays: kind === 'expired' && row.days ? row.days : settings.activationDays,
    payoutChangeDays: kind === 'payout_details_changed' && row.days != null ? row.days : settings.payoutChangeDays };
  const extra = await payloadFor(admin, row.id);
  const r = await sendTemplateEmail('referral-notice', email, {
    templateData: {
      kind, lang: row.lang === 'ar' ? 'ar' : 'en', name: row.display_name || undefined, other: row.referred_name || undefined,
      nextStep: row.next_step || undefined, amount: row.amount ?? undefined, currency: row.currency || undefined,
      settings: s, siteUrl: SITE_URL, bannerUrl,
      tier: extra.tier ?? undefined, period: extra.period ?? undefined, lines: extra.lines ?? undefined,
      totals: extra.totals ?? undefined, stats: extra.stats ?? undefined, contactEmail: sender.contactEmail,
    },
    displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
    idempotencyKey: `referral-${row.kind}-${row.id}`,
    ...(category === 'essential' ? {} : { pause: { userId: row.user_id, category } }),
  });
  return r.sent ? 'sent' : 'skipped';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  if (!(await isJobCaller(req, adminClient()))) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const { data, error } = await admin.rpc('referral_email_claim', { _limit: 100 });
  if (error) {
    console.error('referral claim failed');
    return jsonResponse(req, { ok: false }, 500);
  }
  const rows = (data ?? []) as Row[];
  if (!rows.length) return jsonResponse(req, { ok: true, claimed: 0, sent: 0, skipped: 0, failed: 0 }, 200);
  const { data: settingRows } = await admin.from('platform_settings').select('key, value').in('key', [...REFERRAL_EMAIL_SETTING_KEYS, ...SENDER_SETTING_KEYS]);
  const settings = referralEmailSettingsFrom(settingRows);
  const sender = senderFromSettings(settingRows);
  const bannerUrl = await bannerLive();
  let sent = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await sendOne(admin, row, settings, bannerUrl, sender);
      if (r === 'sent') sent++; else skipped++;
      await admin.rpc('referral_email_done', { _id: row.id, _ok: true });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : 'send failed';
      await admin.rpc('referral_email_done', { _id: row.id, _ok: false, _error: msg.slice(0, 200) });
    }
  }
  return jsonResponse(req, { ok: true, claimed: rows.length, sent, skipped, failed }, 200);
});
