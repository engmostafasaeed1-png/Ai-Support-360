// Feature Z e-mails: one short referral notice per event to one consultant (registered with your code, invited, passed,
// active, reminders, expired, acknowledgement request, verified, first reward). Woken by the database (pg_net,
// referral_wake) only while e-mails wait in referral_email_queue - no permanent schedule. Credential-free like the other
// sweeps (verify_jwt=false): safety lives in the service-role-only referral_email_claim RPC (atomic, at most 5 attempts,
// 10-minute lease) and a call can only send what the database queued. Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface Row {
  id: string; user_id: string; kind: string; lang: string | null; display_name: string | null; referred_name: string | null;
  amount: number | null; currency: string | null; next_step: string | null; days: number | null; pass_mark: number | null;
}

// Reward, payout and bank-detail change notices are essential; everything else follows the recipient's pause choice.
const ESSENTIAL = new Set(['first_reward', 'payout_details_changed']);
const REMINDERS = new Set(['reminder', 'ack_request']);

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: Row): Promise<'sent' | 'skipped'> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return 'skipped';
  await sendTemplateEmail('referral-notice', email, {
    templateData: {
      kind: row.kind, lang: row.lang === 'ar' ? 'ar' : 'en', name: row.display_name || undefined, other: row.referred_name || undefined,
      nextStep: row.next_step || undefined, passMark: row.pass_mark ?? 50, days: row.days ?? undefined,
      amount: row.amount != null ? Number(row.amount).toFixed(2) : undefined, currency: row.currency || undefined,
      url: `${SITE_URL}/consultant/referrals`,
    },
    idempotencyKey: `referral-${row.kind}-${row.id}`,
    ...(ESSENTIAL.has(row.kind) ? {} : { pause: { userId: row.user_id, category: REMINDERS.has(row.kind) ? 'reminders' as const : 'activity' as const } }),
  });
  return 'sent';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  const { data, error } = await admin.rpc('referral_email_claim', { _limit: 100 });
  if (error) {
    console.error('referral claim failed');
    return jsonResponse(req, { ok: false }, 500);
  }
  const rows = (data ?? []) as Row[];
  let sent = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await sendOne(admin, row);
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
