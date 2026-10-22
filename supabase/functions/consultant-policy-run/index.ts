// Consultant Service Policy notices (Feature N): first notice, one reminder after policy_reminder_days, admin reminders.
// Called hourly by pg_cron without credentials (verify_jwt=false). Safety lives server-side: the service-role-only
// claim_consultant_policy_notices RPC (called via adminClient) releases only due notices (one notice and one reminder per
// consultant and version, admin reminders at most once per 24 h, flag consultant_policy_emails, max 200), and a 30-minute
// guard ignores repeat calls. Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { reminderRunBody, startReminderRun } from '../_shared/profileReminderRun.ts';
import { formatPolicyDeadline, policyNoticeLang } from '../_shared/consultantPolicyCopy.ts';
import { policyEmailNumbers, type PolicyEmailNumbers } from '../_shared/consultantPolicyEmail.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface DueRow {
  log_id: string;
  consultant_id: string;
  user_id: string;
  kind: string;
  version: number;
  lang: string | null;
  deadline: string | null;
}

interface VersionText {
  title_en: string; title_ar: string; summary_en: string; summary_ar: string; body_en: string; body_ar: string; effective_at: string | null;
}

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: DueRow, text: VersionText | null, numbers: PolicyEmailNumbers): Promise<void> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email) return;
  const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', row.user_id).maybeSingle();
  const lang = policyNoticeLang(row.lang ?? undefined);
  await sendTemplateEmail('consultant-policy-notice', email, {
    templateData: {
      lang,
      kind: row.kind,
      name: p?.display_name || undefined,
      version: row.version,
      // Both languages in one mail (preferred first); the full published text, never shortened.
      texts: text ? {
        en: { title: text.title_en, summary: text.summary_en, body: text.body_en, effectiveDate: formatPolicyDeadline(text.effective_at, 'en'), deadline: formatPolicyDeadline(row.deadline, 'en') },
        ar: { title: text.title_ar, summary: text.summary_ar, body: text.body_ar, effectiveDate: formatPolicyDeadline(text.effective_at, 'ar'), deadline: formatPolicyDeadline(row.deadline, 'ar') },
      } : undefined,
      deadline: formatPolicyDeadline(row.deadline, lang),
      deadlinePassed: row.deadline ? new Date(row.deadline).getTime() <= Date.now() : false,
      numbers,
      confirmUrl: `${SITE_URL}/consultant/profile#service-policy`,
      policyUrl: `${SITE_URL}/consultant-policy`,
      privacyUrl: `${SITE_URL}/privacy-policy`,
    },
    idempotencyKey: `consultant-policy-${row.log_id}`,
  });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  if (!(await isJobCaller(req, adminClient()))) return jsonResponse(req, { error: 'Unauthorized' }, 401);

  const admin = adminClient();
  const result = await startReminderRun<DueRow>({
    now: Date.now(),
    lastSentAt: async () => {
      const { data, error } = await admin.from('consultant_policy_notice_log')
        .select('sent_at').not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error('guard read failed');
      return data?.sent_at ? new Date(data.sent_at).getTime() : null;
    },
    claim: async () => {
      const { data, error } = await admin.rpc('claim_consultant_policy_notices', { _limit: 200 });
      if (error) throw new Error('claim failed');
      return (data ?? []) as DueRow[];
    },
  });
  if (result.status === 'error') console.error('consultant policy run failed');

  if (result.rows.length > 0) {
    const task = async () => {
      // Key numbers for "What this means for you", read once per run from the real settings (defaults if unreadable).
      let numbers = policyEmailNumbers(null, null, 7);
      try {
        const { data } = await admin.from('platform_settings').select('key, value')
          .in('key', ['assignment_reminder_minutes', 'responsiveness_settings', 'policy_grace_days']);
        const get = (k: string) => (data ?? []).find((r: { key: string }) => r.key === k)?.value;
        numbers = policyEmailNumbers(get('assignment_reminder_minutes'), get('responsiveness_settings'), get('policy_grace_days'));
      } catch { /* defaults */ }
      const versions = new Map<number, VersionText | null>();
      for (const row of result.rows) {
        try {
          if (!versions.has(row.version)) {
            const { data } = await admin.from('consultant_policy_versions')
              .select('title_en, title_ar, summary_en, summary_ar, body_en, body_ar, effective_at').eq('version', row.version).maybeSingle();
            versions.set(row.version, (data as VersionText | null) ?? null);
          }
          await sendOne(admin, row, versions.get(row.version) ?? null, numbers);
        } catch {
          console.error('consultant policy send failed');
        }
      }
    };
    EdgeRuntime.waitUntil(task());
  }
  return jsonResponse(req, reminderRunBody(result), result.status === 'error' ? 500 : 202);
});
