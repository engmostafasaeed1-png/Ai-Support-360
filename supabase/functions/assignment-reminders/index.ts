// Feature L: assignment request e-mails, reminders and "No response" escalation.
// Credential-free like consultant-profile-reminder (verify_jwt=false, POST only): safe to be called by anyone.
// - body {request_id}: the insert trigger asks for the first e-mail of one request right away; only that request's due
//   messages can be claimed, each exactly once.
// - empty body: the 5-minute pg_cron sweep; ignored when the previous sweep ran less than 4 minutes ago.
// - body {info_id}: a "Request more information" question or its answer (docs/sql/assignment-info-requests.sql) wants
//   its e-mail now; the sweep also returns unanswered questions to the client and sends what is still due.
// Safety lives in the service-only claim_assignment_reminders / claim_assignment_info_emails RPCs (atomic FOR UPDATE SKIP LOCKED, due times, stop rules,
// per-consultant hourly limit, admin switch assignment_reminders, max 200 per run). Responses contain counts only.
import { adminClient, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { parseRunBody, readPolicyMinutes, runResponse, sweepGuarded, type PolicyMinutes } from '../_shared/assignmentPolicy.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';

interface InfoClaimRow {
  info_id: string;
  request_id: string;
  kind: 'ask' | 'answer' | 'timeout';
  recipient_user_id: string;
  lang: string | null;
  ticket_id: string;
  ticket_title: string | null;
  consultant_name: string | null;
  topics: string[] | null;
  question: string | null;
  client_due_at: string | null;
  response_due_at: string | null;
  timezone: string | null;
}

interface ClaimRow {
  log_id: string;
  request_id: string;
  step: 'request' | 'r1' | 'r2' | 'r3' | 'expire' | 'expire2';
  recipient: 'consultant' | 'client';
  recipient_user_id: string;
  ticket_id: string;
  ticket_title: string | null;
  sap_area: string | null;
  urgency: string | null;
  is_critical: boolean | null;
  response_kind: string | null;
  response_due_at: string | null;
  minutes_left: number | null;
  proposed_rate: number | null;
  rate_currency: string | null;
  consultant_name: string | null;
  can_extend: boolean | null;
  lang: string | null;
  timezone: string | null;
}

// deno-lint-ignore no-explicit-any
async function sendInfo(admin: any, row: InfoClaimRow): Promise<void> {
  const { data: u } = await admin.auth.admin.getUserById(row.recipient_user_id);
  const email = u?.user?.email;
  if (!email) return;
  const url = row.kind === 'answer'
    ? `${SITE_URL}/consultant/requests?request=${row.request_id}`
    : `${SITE_URL}/client/tickets/${row.ticket_id}?info=${row.info_id}`;
  try {
    await sendTemplateEmail('assignment-info', email, {
      templateData: {
        lang: row.lang === 'ar' ? 'ar' : 'en',
        kind: row.kind,
        ticketTitle: row.ticket_title || undefined,
        consultantName: row.consultant_name || undefined,
        topics: row.topics ?? [],
        question: row.question || undefined,
        clientDueAt: row.client_due_at || undefined,
        responseDueAt: row.response_due_at || undefined,
        timezone: row.timezone || 'Asia/Riyadh',
        url,
      },
      idempotencyKey: `assignment-info-${row.info_id}-${row.kind}`,
    });
  } catch {
    console.error('assignment info e-mail failed');
  }
}

/** Information-request e-mails (and time-outs); an empty list until the prepared SQL is applied. */
// deno-lint-ignore no-explicit-any
async function claimInfo(admin: any, infoId: string | null): Promise<InfoClaimRow[]> {
  const { data, error } = await admin.rpc('claim_assignment_info_emails', { _limit: infoId ? 5 : 200, _info_id: infoId });
  if (error) return [];
  return (data ?? []) as InfoClaimRow[];
}

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: ClaimRow, policy: PolicyMinutes, infoOptions: boolean): Promise<void> {
  const { data: u } = await admin.auth.admin.getUserById(row.recipient_user_id);
  const email = u?.user?.email;
  if (!email) return;
  const lang = row.lang === 'ar' ? 'ar' : 'en';
  try {
    if (row.recipient === 'client') {
      const base = `${SITE_URL}/client/tickets/${row.ticket_id}?noresponse=${row.request_id}`;
      await sendTemplateEmail('assignment-no-response', email, {
        templateData: {
          lang,
          consultantName: row.consultant_name || undefined,
          ticketTitle: row.ticket_title || undefined,
          canExtend: row.can_extend !== false,
          inviteUrl: `${base}&action=invite`,
          bidsUrl: `${base}&action=bids`,
          waitUrl: `${base}&action=wait`,
        },
        idempotencyKey: `assignment-${row.log_id}`,
      });
    } else {
      await sendTemplateEmail('assignment-request', email, {
        templateData: {
          lang,
          step: row.step,
          ticketTitle: row.ticket_title || undefined,
          sapArea: row.sap_area || undefined,
          urgency: row.urgency || undefined,
          critical: row.is_critical === true,
          bid: row.response_kind === 'bid',
          proposedRate: row.proposed_rate ?? undefined,
          currency: row.rate_currency || undefined,
          deadline: row.response_due_at || undefined,
          minutesLeft: row.minutes_left ?? undefined,
          timezone: row.timezone || 'Asia/Riyadh',
          requestUrl: `${SITE_URL}/consultant/requests?request=${row.request_id}`,
          previewUrl: infoOptions ? `${SITE_URL}/consultant/requests?request=${row.request_id}&preview=1` : undefined,
          infoOptions,
          policy,
        },
        idempotencyKey: `assignment-${row.log_id}`,
      });
    }
  } catch (error) {
    // Unsubscribed recipients resolve without throwing; anything else is recorded by code only (no text, no addresses).
    const code = (error as { code?: string })?.code || 'email send failed';
    await admin.from('assignment_reminder_log').update({ email_error: String(code).slice(0, 60) }).eq('id', row.log_id);
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const { requestId, infoId } = parseRunBody(body);
  const admin = adminClient();

  if (infoId) {
    let infoRows: InfoClaimRow[] = [];
    try { infoRows = await claimInfo(admin, infoId); } catch { infoRows = []; }
    EdgeRuntime.waitUntil((async () => {
      for (const row of infoRows) {
        try { await sendInfo(admin, row); } catch { console.error('assignment info send failed'); }
      }
    })());
    return jsonResponse(req, runResponse({ skipped: false, claimed: infoRows.length, ok: true }), 202);
  }

  let rows: ClaimRow[] = [];
  try {
    if (!requestId) {
      const { data: last, error: lastError } = await admin.from('assignment_reminder_runs')
        .select('ran_at').order('ran_at', { ascending: false }).limit(1).maybeSingle();
      if (lastError) throw new Error('guard read failed');
      if (sweepGuarded(last?.ran_at ? new Date(last.ran_at).getTime() : null, Date.now())) {
        return jsonResponse(req, runResponse({ skipped: true, claimed: 0, ok: true }), 202);
      }
      await admin.from('assignment_reminder_runs').insert({});
    }
    const { data, error } = await admin.rpc('claim_assignment_reminders', { _limit: requestId ? 5 : 200, _request_id: requestId });
    if (error) throw new Error('claim failed');
    rows = (data ?? []) as ClaimRow[];
  } catch {
    console.error('assignment reminder run failed');
    return jsonResponse(req, runResponse({ skipped: false, claimed: 0, ok: false }), 500);
  }

  // Claims are already recorded; send in the background so the caller returns quickly.
  const task = async () => {
    let policy = readPolicyMinutes(null);
    try {
      const { data: pm } = await admin.rpc('assignment_policy_minutes');
      policy = readPolicyMinutes(pm);
    } catch { /* defaults */ }
    let infoOptions = false;
    try {
      const { error } = await admin.rpc('assignment_info_ready');
      infoOptions = !error;
    } catch { /* not applied yet */ }
    for (const row of rows) {
      try { await sendOne(admin, row, policy, infoOptions); }
      catch { console.error('assignment reminder send failed'); }
    }
    if (!requestId && infoOptions) {
      try {
        for (const row of await claimInfo(admin, null)) {
          try { await sendInfo(admin, row); } catch { console.error('assignment info send failed'); }
        }
      } catch { console.error('assignment info sweep failed'); }
    }
    if (!requestId) {
      try { await admin.rpc('assignment_admin_digest'); }
      catch { console.error('assignment digest failed'); }
    }
  };
  EdgeRuntime.waitUntil(task());
  return jsonResponse(req, runResponse({ skipped: false, claimed: rows.length, ok: true }), 202);
});
