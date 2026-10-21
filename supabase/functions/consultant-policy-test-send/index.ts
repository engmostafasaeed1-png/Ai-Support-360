// Owner test send of the Consultant Service Policy e-mail (Feature N). Super admin only; the recipient is fixed to the
// owner's address below and never taken from the request. Uses the real published policy version, the live settings
// numbers and a sample deadline 7 days from now, through the same sendTemplateEmail path consultants get, subject
// prefixed "[TEST] ". Touches no notice log, notification, acknowledgement or consultant. Rate limited (6 per hour).
// Every mail carries both languages. Body: { "lang": "ar" (Arabic first) | "en" (English first) | "both" } (default
// "both" = two mails, one Arabic first and one English first).
import { adminClient, authenticateUser, getUserRoles, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { formatPolicyDeadline } from '../_shared/consultantPolicyCopy.ts';
import { policyEmailNumbers } from '../_shared/consultantPolicyEmail.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

const TEST_RECIPIENT = 'eng.mostafasaeed1@gmail.com';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  const roles = await getUserRoles(admin, caller.id);
  if (!roles.includes('super_admin')) return jsonResponse(req, { error: 'Forbidden' }, 403);
  if (!(await withinRateLimit(admin, `policy-test-send:${caller.id}`, 6, 3600))) {
    return jsonResponse(req, { error: 'Too many test sends, try again later' }, 429);
  }

  let body: { lang?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const langs: Array<'en' | 'ar'> = body.lang === 'en' ? ['en'] : body.lang === 'ar' ? ['ar'] : ['ar', 'en'];

  const { data: v, error: vErr } = await admin.from('consultant_policy_versions')
    .select('version, title_en, title_ar, summary_en, summary_ar, body_en, body_ar, effective_at')
    .lte('effective_at', new Date().toISOString())
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (vErr || !v) return jsonResponse(req, { error: 'No published policy version' }, 404);

  const { data: s } = await admin.from('platform_settings').select('key, value')
    .in('key', ['assignment_reminder_minutes', 'responsiveness_settings', 'policy_grace_days']);
  const get = (k: string) => (s ?? []).find((r: { key: string }) => r.key === k)?.value;
  const numbers = policyEmailNumbers(get('assignment_reminder_minutes'), get('responsiveness_settings'), get('policy_grace_days'));
  const deadlineIso = new Date(Date.now() + 7 * 86400000).toISOString();
  const { data: p } = await admin.from('profiles').select('display_name').eq('user_id', caller.id).maybeSingle();

  const results: Array<Record<string, unknown>> = [];
  for (const lang of langs) {
    try {
      const r = await sendTemplateEmail('consultant-policy-notice', TEST_RECIPIENT, {
        templateData: {
          lang,
          kind: 'notice',
          name: p?.display_name || undefined,
          version: v.version,
          texts: {
            en: { title: v.title_en, summary: v.summary_en, body: v.body_en, effectiveDate: formatPolicyDeadline(v.effective_at, 'en'), deadline: formatPolicyDeadline(deadlineIso, 'en') },
            ar: { title: v.title_ar, summary: v.summary_ar, body: v.body_ar, effectiveDate: formatPolicyDeadline(v.effective_at, 'ar'), deadline: formatPolicyDeadline(deadlineIso, 'ar') },
          },
          deadlinePassed: false,
          numbers,
          confirmUrl: `${SITE_URL}/consultant/profile#service-policy`,
          policyUrl: `${SITE_URL}/consultant-policy`,
          privacyUrl: `${SITE_URL}/privacy-policy`,
        },
        subjectPrefix: '[TEST] ',
        idempotencyKey: `consultant-policy-test-${lang}-${crypto.randomUUID()}`,
      });
      results.push({ first: lang, ...r });
    } catch (e) {
      const err = e as { code?: string; status?: number; message?: string };
      results.push({ first: lang, sent: false, error: err.code ?? err.message ?? 'send failed', status: err.status });
    }
  }
  return jsonResponse(req, { version: v.version, deadline: deadlineIso, numbers, results }, 200);
});
