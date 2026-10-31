// Demo booking e-mails (docs/sql/demo-schedule-alerts.sql).
//
// 1. Browser call { token } right after the demo wizard / contact form saved a request: a confirmation to the visitor
//    and ONE alert "Demo booked: schedule needed" to the team notification address. Recipient, details, slots and the
//    deadline are all read from the database (the caller only knows the secret token), so this endpoint cannot send
//    arbitrary mail. The alert is claimed once per request by the service-only dsa_alert_claim (duplicate guard).
// 2. Job call { sweep: true } with the private x-job-token (pg_cron every 15 minutes): reminders for demos still not
//    scheduled after the deadline (dsa_reminder_claim: once at the deadline, then at most two more, one per day,
//    stopping by itself once a time is confirmed). Responses contain counts only.
import { adminClient, clientIp, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { TEAM_EMAIL } from '../_shared/contact.ts';
import { isJobCaller } from '../_shared/jobAuth.ts';
import { buildDemoAlertView, buildDemoUpdateView, readDemoSettings, type DemoRequestRow } from '../_shared/demoSchedule.ts';

const TOKEN_RE = /^[a-f0-9]{32}$/;
const NEW_REQUEST_WINDOW_MS = 15 * 60 * 1000;
// deno-lint-ignore no-explicit-any
type Db = any;

const missing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? ''));

async function settingsOf(admin: Db) {
  const { data } = await admin.from('platform_settings').select('value').eq('key', 'demo_schedule_alerts').maybeSingle();
  return readDemoSettings(data?.value);
}

async function logRow(admin: Db, templateName: string, recipient: string, status: string, error_message?: string) {
  const { error } = await admin.from('email_send_log').insert({
    message_id: null, template_name: templateName, recipient_email: recipient, status, error_message: error_message ?? null,
  });
  if (error) console.error('demo-request-notify: send log failed', { code: error.code });
}

async function send(admin: Db, template: string, to: string, key: string, data: Record<string, unknown>, replyTo?: string) {
  try {
    const result = await sendTemplateEmail(template, to, { idempotencyKey: key, replyTo, templateData: data });
    await logRow(admin, template, to, result.sent ? 'sent' : 'suppressed');
    return result.sent;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`demo-request-notify: ${template} failed`);
    await logRow(admin, template, to, 'failed', msg.slice(0, 1000));
    return false;
  }
}

async function sweep(req: Request, admin: Db) {
  const { data, error } = await admin.rpc('dsa_reminder_claim', { _limit: 20 });
  if (error) return jsonResponse(req, { ok: false, sent: 0 });
  const settings = await settingsOf(admin);
  let sent = 0;
  for (const item of (Array.isArray(data) ? data : []) as { id: string; n: number }[]) {
    const { data: row } = await admin.from('demo_requests').select('*').eq('id', item.id).maybeSingle();
    if (!row) continue;
    const view = buildDemoAlertView(row as DemoRequestRow, { site: SITE_URL, settings, now: new Date(), kind: 'reminder', reminderNo: item.n });
    if (await send(admin, 'demo-request-alert', TEAM_EMAIL, `demo-schedule-reminder-${row.id}-${item.n}`, view as unknown as Record<string, unknown>, row.email)) sent++;
  }
  return jsonResponse(req, { ok: true, sent });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const admin = adminClient();

  if (body?.sweep === true) {
    if (!(await isJobCaller(req, admin))) return jsonResponse(req, { error: 'Forbidden' }, 403);
    return await sweep(req, admin);
  }

  const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : '';
  if (!TOKEN_RE.test(token)) return jsonResponse(req, { error: 'Invalid token' }, 400);
  const withinIp = await withinRateLimit(admin, `demo-request-notify:ip:${clientIp(req)}`, 20, 3600);
  const withinToken = await withinRateLimit(admin, `demo-request-notify:token:${token}`, 3, 3600);
  if (!withinIp || !withinToken) return jsonResponse(req, { error: 'Too many requests' }, 429);

  // Uniform answer whether or not the token exists, so it cannot be probed.
  const accepted = () => jsonResponse(req, { ok: true });

  const { data: row, error } = await admin.from('demo_requests').select('*').eq('request_token', token).maybeSingle();
  if (error || !row) return accepted();

  // Only right after the request was created, and only while nobody has handled it yet.
  const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
  if (row.status !== 'received' || !createdAt || Date.now() - createdAt > NEW_REQUEST_WINDOW_MS) return accepted();

  const isContact = row.source === 'contact-form';
  const settings = await settingsOf(admin);
  const now = new Date();

  // 1. the confirmation to the visitor (a reply goes to the team mailbox)
  if (isContact) {
    await send(admin, 'contact-message-received', row.email, `contact-message-received-${row.id}`, { name: row.full_name }, TEAM_EMAIL);
  } else {
    const view = buildDemoUpdateView(row as DemoRequestRow, 'received', { site: SITE_URL, now, settings });
    await send(admin, 'demo-request-received', row.email, `demo-request-received-${row.id}`, view as unknown as Record<string, unknown>, TEAM_EMAIL);
  }

  // 2. ONE alert to the team (a reply goes to the visitor). Claimed once in the database when the update is applied.
  let bellText: string | null = null;
  let duplicate = false;
  const claim = await admin.rpc('dsa_alert_claim', { _id: row.id });
  if (claim.error && !missing(claim.error)) return accepted();
  if (!claim.error) {
    const c = (claim.data ?? {}) as { send?: boolean; bell_text?: string; duplicate_of?: string | null };
    if (!c.send) return accepted();
    bellText = c.bell_text ?? null;
    duplicate = !!c.duplicate_of;
  }
  const view = buildDemoAlertView(row as DemoRequestRow, { site: SITE_URL, settings, now, kind: 'alert', bellText, duplicate });
  await send(admin, 'demo-request-alert', TEAM_EMAIL, `demo-request-alert-${row.id}`, view as unknown as Record<string, unknown>, row.email);
  return accepted();
});
