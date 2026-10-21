// Daily consultant profile-completion reminders (Feature B).
// Called hourly by pg_cron without credentials (verify_jwt=false). Safety lives server-side:
// the service-role-only claim_profile_reminders RPC (called via adminClient) releases only
// consultants whose local time is 09:00 and who are due (24 h after sign-up, one per 20 h,
// weekly after profile_reminder_daily_days, stop when complete, max 200, admin flag), and a
// 30-minute guard ignores repeat calls. Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { reminderRunBody, startReminderRun } from '../_shared/profileReminderRun.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface DueRow {
  consultant_id: string;
  user_id: string;
  kind: string;
  percent: number | null;
  missing: string[] | null;
  interview_done: boolean | null;
  earned_badge: string | null;
  payout_ready: boolean | null;
  lang: string | null;
}

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: DueRow): Promise<void> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email) return;
  const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', row.user_id).maybeSingle();
  const lang = row.lang === 'ar' ? 'ar' : 'en';
  await sendTemplateEmail('profile-reminder', email, {
    templateData: {
      name: p?.display_name || undefined,
      percent: row.percent ?? 0,
      missing: row.missing ?? [],
      interviewDone: row.interview_done === true,
      earnedBadge: row.earned_badge || undefined,
      payoutReady: row.payout_ready === true,
      lang,
      profileUrl: `${SITE_URL}/consultant/profile?section=setup`,
      interviewUrl: `${SITE_URL}/consultant/interviews?start=1`,
    },
    idempotencyKey: `profile-reminder-${row.consultant_id}-${new Date().toISOString().slice(0, 10)}`,
    // Feature Q: held while the consultant has paused reminder e-mails; the in-app notice below is kept quietly.
    pause: { userId: row.user_id, category: 'reminders' },
  });
  // One in-app notification per reminder (the log guarantees at most one per 20 h).
  const pct = row.percent ?? 0;
  const body = row.interview_done
    ? (lang === 'ar'
        ? `ملفك مكتمل بنسبة ${pct}٪ — حافظ على اكتماله ليظهر للعملاء.`
        : `Your profile is ${pct} % complete — keep it complete to stay visible to clients.`)
    : (lang === 'ar'
        ? `ملفك مكتمل بنسبة ${pct}٪ — أكمله وابدأ مقابلة الذكاء الاصطناعي لتكسب شارتك ويظهر ملفك أولاً.`
        : `Your profile is ${pct} % complete — finish it and take the AI interview to earn your badge and be shown first.`);
  await admin.from('notifications').insert({
    user_id: row.user_id,
    title: lang === 'ar' ? 'أكمل ملفك الشخصي' : 'Complete your profile',
    body,
    link: row.interview_done ? '/consultant/profile?section=setup' : '/consultant/interviews?start=1',
    type: 'profile_reminder',
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const admin = adminClient();
  const result = await startReminderRun<DueRow>({
    now: Date.now(),
    lastSentAt: async () => {
      const { data, error } = await admin.from('profile_reminder_log')
        .select('sent_at').order('sent_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error('guard read failed');
      return data?.sent_at ? new Date(data.sent_at).getTime() : null;
    },
    claim: async () => {
      const { data, error } = await admin.rpc('claim_profile_reminders', { _limit: 200 });
      if (error) throw new Error('claim failed');
      return (data ?? []) as DueRow[];
    },
  });
  if (result.status === 'error') console.error('profile reminder run failed');

  // Claims are already logged; send in the background so the scheduler call returns quickly.
  if (result.rows.length > 0) {
    const task = async () => {
      for (const row of result.rows) {
        try { await sendOne(admin, row); }
        catch { console.error('profile reminder send failed'); }
      }
    };
    EdgeRuntime.waitUntil(task());
  }
  return jsonResponse(req, reminderRunBody(result), result.status === 'error' ? 500 : 202);
});
