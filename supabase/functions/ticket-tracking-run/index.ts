// Ticket tracking e-mails (docs/sql/ticket-tracking.sql): working status changes, "please confirm the resolution",
// expected-date and review reminders. Woken by the database (pg_net, tt_wake) only while e-mails wait in
// ticket_tracking_email_queue - no schedule of its own. Job-token checked (_shared/jobAuth.ts, verify_jwt=false):
// a call can only send what the database queued; the service-only tt_claim_emails RPC leases rows (10 minutes,
// at most 5 attempts) and drops rows for people no longer on the ticket. Pause rules: status notices use the
// activity category, reminders the reminders category. Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface Row {
  id: string;
  user_id: string;
  ticket_id: string;
  kind: 'status' | 'completed' | 'due_tomorrow' | 'overdue' | 'review';
  payload: Record<string, unknown>;
  dedupe_key: string;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: Row): Promise<'sent' | 'skipped'> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return 'skipped';
  const p = row.payload ?? {};
  const path = str(p.path, 200) ?? '';
  const res = await sendTemplateEmail('ticket-tracking', email, {
    templateData: {
      lang: p.lang === 'ar' ? 'ar' : 'en',
      kind: row.kind,
      ticketTitle: str(p.ticket_title, 120),
      statusLabel: str(p.status_label, 80),
      actor: ['client', 'consultant', 'admin'].includes(String(p.actor)) ? p.actor : 'consultant',
      note: str(p.note, 300),
      expectedDate: str(p.expected_date, 10),
      days: typeof p.days === 'number' ? p.days : undefined,
      url: /^\/(client\/tickets|consultant\/cases)\/[0-9a-f-]{36}$/.test(path) ? `${SITE_URL}${path}` : SITE_URL,
    },
    idempotencyKey: row.dedupe_key,
    pause: { userId: row.user_id, category: row.kind === 'status' || row.kind === 'completed' ? 'activity' : 'reminders' },
  });
  return res.sent ? 'sent' : 'skipped';
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();
  if (!(await isJobCaller(req, admin))) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const { data, error } = await admin.rpc('tt_claim_emails', { _limit: 50 });
  if (error) {
    // Before docs/sql/ticket-tracking.sql is applied the RPC does not exist: nothing to send.
    console.error('ticket tracking claim failed', error.code ?? '');
    return jsonResponse(req, { ok: false, notReady: true }, 503);
  }
  const rows = (data ?? []) as Row[];
  let sent = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await sendOne(admin, row);
      if (r === 'sent') sent++; else skipped++;
      await admin.rpc('tt_finish_email', { _id: row.id, _ok: true });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : 'send failed';
      await admin.rpc('tt_finish_email', { _id: row.id, _ok: false, _error: msg.slice(0, 200) });
    }
  }
  return jsonResponse(req, { ok: true, claimed: rows.length, sent, skipped, failed }, 200);
});
