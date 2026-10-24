// BRD approval e-mails (docs/sql/ticket-brd-approval.sql). Two callers:
//  * the database (pg_net, brd_approval_wake) while e-mails wait in ticket_brd_approval_email_queue - job-token checked
//    (_shared/jobAuth.ts, verify_jwt=false); a call can only send what the database queued; the service-only claim RPC
//    leases rows (10 minutes, 5 attempts) and drops rows for people who can no longer open the ticket;
//  * an administrator's "Send test to me" ({ action: 'test', kind, lang }): sample data only, always to the admin's
//    own confirmed address from the verified token, "[TEST] " subject, 6 per hour, writes nothing.
// "What changed since the approved version" is computed here from the two stored versions (section titles only).
// Pause rules: reminders / waiting / escalation use the reminders category, the rest activity. Counts-only responses.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { SENDER_SETTING_KEYS, senderFromSettings } from '../_shared/emailSender.ts';
import { BRD_APPROVAL_EMAIL_KINDS, normaliseBrdKind, pauseCategoryForBrd, sampleBrdApprovalEmail, type BrdApprovalEmailKind } from '../_shared/brdApprovalEmail.ts';
import { diffContents } from '../_shared/brdDiff.ts';
import { normalizeContent } from '../_shared/brdModel.ts';

interface Row { id: string; user_id: string; ticket_id: string; kind: string; payload: Record<string, unknown>; dedupe_key: string }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : undefined);

// deno-lint-ignore no-explicit-any
async function changedSections(admin: any, ticketId: string, version?: number, previous?: number, lang: 'en' | 'ar' = 'en'): Promise<string[] | undefined> {
  if (!version || !previous) return undefined;
  const { data, error } = await admin.rpc('brd_approval_email_contents', { _ticket: ticketId, _version: version, _previous: previous });
  if (error || !data?.current || !data?.previous) return undefined;
  try {
    return diffContents(normalizeContent(data.previous), normalizeContent(data.current), lang).filter((d) => d.changed).map((d) => d.title).slice(0, 16);
  } catch {
    return undefined;
  }
}

// deno-lint-ignore no-explicit-any
async function sendOne(admin: any, row: Row, sender: ReturnType<typeof senderFromSettings>): Promise<'sent' | 'skipped'> {
  const { data: u } = await admin.auth.admin.getUserById(row.user_id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return 'skipped';
  const p = row.payload ?? {};
  const kind = normaliseBrdKind(row.kind);
  const lang = p.lang === 'ar' ? 'ar' : 'en';
  const version = int(p.version);
  const previous = int(p.previous_version);
  const res = await sendTemplateEmail('brd-approval', email, {
    templateData: {
      kind, lang, version, previousVersion: previous ?? null, ticketTitle: str(p.ticket_title, 120), ref: str(p.ref, 12),
      who: str(p.who, 80), note: str(p.note, 1500), summary: str(p.summary, 240), days: int(p.days), dueAt: str(p.due_at, 40),
      path: str(p.path, 200), siteUrl: SITE_URL, contactEmail: sender.contactEmail,
      changedSections: kind === 'request' || kind === 'reminder' ? await changedSections(admin, row.ticket_id, version, previous, lang) : undefined,
    },
    idempotencyKey: row.dedupe_key,
    displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
    pause: { userId: row.user_id, category: pauseCategoryForBrd(kind) },
  });
  return res.sent ? 'sent' : 'skipped';
}

// deno-lint-ignore no-explicit-any
async function senderOf(admin: any) {
  const { data } = await admin.from('platform_settings').select('key, value').in('key', [...SENDER_SETTING_KEYS]);
  return senderFromSettings(data);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  const admin = adminClient();

  if (await isJobCaller(req, admin)) {
    const { data, error } = await admin.rpc('brd_approval_claim_emails', { _limit: 50 });
    if (error) {
      // Before docs/sql/ticket-brd-approval.sql is applied the RPC does not exist: nothing to send.
      console.error('brd approval claim failed', error.code ?? '');
      return jsonResponse(req, { ok: false, notReady: true }, 503);
    }
    const rows = (data ?? []) as Row[];
    const sender = await senderOf(admin);
    let sent = 0, skipped = 0, failed = 0;
    for (const row of rows) {
      try {
        const r = await sendOne(admin, row, sender);
        if (r === 'sent') sent++; else skipped++;
        await admin.rpc('brd_approval_finish_email', { _id: row.id, _ok: true });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : 'send failed';
        await admin.rpc('brd_approval_finish_email', { _id: row.id, _ok: false, _error: msg.slice(0, 200) });
      }
    }
    return jsonResponse(req, { ok: true, claimed: rows.length, sent, skipped, failed }, 200);
  }

  // Administrator test send (sample data, own address only).
  const caller = await authenticateUser(req);
  if (!caller) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const roles = await getUserRoles(admin, caller.id);
  if (!hasAnyRole(roles, ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);
  let body: { action?: unknown; kind?: unknown; lang?: unknown } = {};
  try { body = await req.json(); } catch { /* validated below */ }
  if (body.action !== 'test') return jsonResponse(req, { error: 'Unknown action' }, 400);
  const kind = String(body.kind ?? '');
  if (!(BRD_APPROVAL_EMAIL_KINDS as readonly string[]).includes(kind)) return jsonResponse(req, { error: 'Choose one of the BRD approval e-mails' }, 400);
  const lang = body.lang === 'ar' ? 'ar' : body.lang === 'en' || body.lang == null ? 'en' : null;
  if (!lang) return jsonResponse(req, { error: 'Language must be en or ar' }, 400);
  const { data: u } = await admin.auth.admin.getUserById(caller.id);
  const email = u?.user?.email;
  if (!email || !u.user.email_confirmed_at) return jsonResponse(req, { error: 'Your own e-mail address is not confirmed' }, 400);
  if (!(await withinRateLimit(admin, `brd-approval-test:${caller.id}`, 6, 3600))) return jsonResponse(req, { error: 'Too many test e-mails, try again later' }, 429);
  const sender = await senderOf(admin);
  try {
    const r = await sendTemplateEmail('brd-approval', email, {
      templateData: { ...sampleBrdApprovalEmail(kind as BrdApprovalEmailKind, lang), siteUrl: SITE_URL, contactEmail: sender.contactEmail, test: true },
      subjectPrefix: '[TEST] ',
      displayName: sender.displayName, fromLocal: sender.fromLocal, replyTo: sender.replyTo,
      idempotencyKey: `brd-approval-test-${caller.id}-${crypto.randomUUID()}`,
    });
    return jsonResponse(req, { ok: r.sent, reason: r.sent ? undefined : r.reason, to: 'self' }, 200);
  } catch (e) {
    const err = e as { code?: string };
    return jsonResponse(req, { ok: false, error: err.code ?? 'send_failed' }, 502);
  }
});
