// Daily consultant profile-completion reminders (Feature B).
// Called hourly by pg_cron; the claim_profile_reminders RPC only releases
// consultants whose local time is 09:00 and who are due (24 h after sign-up,
// one per 20 h, weekly after profile_reminder_daily_days, stop when complete).
import { adminClient, isServiceRoleRequest, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  // Scheduler only: reads private profile data and sends e-mails.
  if (!isServiceRoleRequest(req)) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  const admin = adminClient();
  const { data: due, error } = await admin.rpc('claim_profile_reminders', { _limit: 200 });
  if (error) return jsonResponse(req, { error: error.message }, 500);

  let sent = 0;
  for (const row of due ?? []) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(row.user_id);
      const email = u?.user?.email;
      if (!email) continue;
      const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', row.user_id).maybeSingle();
      const lang = row.lang === 'ar' ? 'ar' : 'en';
      const res = await sendTemplateEmail('profile-reminder', email, {
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
      });
      if (res.sent) sent++;
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
      });
    } catch (e) {
      console.error('profile reminder failed', row.consultant_id, e);
    }
  }
  return jsonResponse(req, { claimed: (due ?? []).length, sent });
});
