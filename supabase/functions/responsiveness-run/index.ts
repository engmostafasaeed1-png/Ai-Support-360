// Feature M: responsiveness sweep (overdue alarms and chats, nightly recalculation) and consultant notice e-mails.
// Credential-free like assignment-reminders (verify_jwt=false, POST only): safe to be called by anyone.
// Safety lives in the service-only responsiveness_sweep and claim_responsiveness_notices RPCs (atomic FOR UPDATE SKIP
// LOCKED, each notice e-mailed once, max 200 per run, nightly work at most once per 20 hours) plus an 8-minute repeat
// guard here. Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { respRunGuarded } from '../_shared/responsiveness.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface NoticeRow {
  notice_id: string;
  kind: string;
  user_id: string;
  lang: string | null;
  ticket_title: string | null;
  count_30d: number | null;
  warnings_total: number | null;
  dispute_days: number | null;
  event_id: string;
}

const counts = (r: { skipped: boolean; claimed: number; ok: boolean }) => ({ skipped: r.skipped, claimed: Math.max(0, r.claimed | 0), ok: r.ok });

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: NoticeRow): Promise<void> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email) return;
  try {
    await sendTemplateEmail('responsiveness-notice', email, {
      templateData: {
        lang: row.lang === 'ar' ? 'ar' : 'en',
        kind: row.kind,
        ticketTitle: row.ticket_title || undefined,
        count30: row.count_30d ?? undefined,
        warningsTotal: row.warnings_total ?? undefined,
        disputeDays: row.dispute_days ?? undefined,
        pageUrl: `${SITE_URL}/consultant/responsiveness?event=${row.event_id}`,
      },
      idempotencyKey: `responsiveness-${row.notice_id}`,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code || 'email send failed';
    await admin.from('responsiveness_notices').update({ email_error: String(code).slice(0, 60) }).eq('id', row.notice_id);
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();

  let rows: NoticeRow[] = [];
  try {
    const { data: last, error: lastError } = await admin.from('responsiveness_runs')
      .select('ran_at').eq('kind', 'sweep').order('ran_at', { ascending: false }).limit(1).maybeSingle();
    if (lastError) throw new Error('guard read failed');
    if (respRunGuarded(last?.ran_at ? new Date(last.ran_at).getTime() : null, Date.now())) {
      return jsonResponse(req, counts({ skipped: true, claimed: 0, ok: true }), 202);
    }
    const { error: sweepError } = await admin.rpc('responsiveness_sweep');
    if (sweepError) throw new Error('sweep failed');
    const { data, error } = await admin.rpc('claim_responsiveness_notices', { _limit: 200 });
    if (error) throw new Error('claim failed');
    rows = (data ?? []) as NoticeRow[];
  } catch {
    console.error('responsiveness run failed');
    return jsonResponse(req, counts({ skipped: false, claimed: 0, ok: false }), 500);
  }

  const task = async () => {
    for (const row of rows) {
      try { await sendOne(admin, row); }
      catch { console.error('responsiveness notice send failed'); }
    }
  };
  EdgeRuntime.waitUntil(task());
  return jsonResponse(req, counts({ skipped: false, claimed: rows.length, ok: true }), 202);
});
