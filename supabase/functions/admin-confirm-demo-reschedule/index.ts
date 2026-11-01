// Admin endpoint for demo bookings (Demo requests page). Caller must be an admin / super admin.
//
//   { request_id, slot_index, note }                   confirm a time the requester proposed (via admin_demo_schedule)
//   { action: 'schedule', request_id, date, time, tz, duration_min, meeting_link, note }   confirm / move the demo
//   { action: 'cancel', request_id, reason }           cancel the demo
//
// The database functions (docs/sql/demo-schedule-alerts.sql) re-check the role, validate and record the change; this
// function then e-mails the requester once per change (demo-meeting-update: confirmed / new time / cancelled) in their
// language and time zone. Links are built only from the server-side SITE_URL; the meeting link is shown on their
// request page, never in the e-mail.
import { ADMIN_ROLES, adminClient, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL } from '../_shared/security.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { TEAM_EMAIL } from '../_shared/contact.ts';
import { buildDemoUpdateView, readDemoSettings, validTz, type DemoRequestRow, type DemoUpdateKind } from '../_shared/demoSchedule.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return jsonResponse(req, { error: 'Server misconfigured' }, 500);

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();
  if (!hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES)) return jsonResponse(req, { error: 'Forbidden' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const requestId = str(body.request_id, 40);
  if (!UUID_RE.test(requestId)) return jsonResponse(req, { error: 'request_id is required' }, 400);
  const action = body.action === 'schedule' || body.action === 'cancel' ? body.action : 'legacy';
  const note = str(body.note, 500) || null;

  // The RPCs run as the admin (they re-check the role and write the audit row).
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  let kind: DemoUpdateKind = 'confirmed';
  let version = '';
  if (action === 'schedule') {
    const duration = Number(body.duration_min);
    const { data, error } = await userClient.rpc('admin_demo_schedule', {
      _id: requestId, _date: str(body.date, 10), _time: str(body.time, 5), _tz: str(body.tz, 64),
      _duration_min: Number.isFinite(duration) ? Math.round(duration) : 30, _meeting_link: str(body.meeting_link, 500) || null, _note: note,
    });
    if (error) return jsonResponse(req, { error: error.code === 'PGRST202' ? 'not_installed' : error.message }, 400);
    kind = (data as { kind?: string })?.kind === 'rescheduled' ? 'rescheduled' : 'confirmed';
    version = String((data as { version?: number })?.version ?? '');
  } else if (action === 'cancel') {
    const { data, error } = await userClient.rpc('admin_demo_cancel', { _id: requestId, _reason: str(body.reason, 500) || null });
    if (error) return jsonResponse(req, { error: error.code === 'PGRST202' ? 'not_installed' : error.message }, 400);
    kind = 'cancelled';
    version = String((data as { version?: number })?.version ?? '');
  } else {
    // "Confirm this time" on a slot the requester proposed. It goes through admin_demo_schedule so meeting_at (what the
    // e-mail, their page, the .ics and the admin list read) moves to the new time; the legacy RPC never touched it.
    const slotIndex = Number.isInteger(body.slot_index) ? (body.slot_index as number) : 0;
    const { data: cur } = await admin.from('demo_requests')
      .select('status, proposed_slots, timezone, meeting_duration_min, meeting_link').eq('id', requestId).maybeSingle();
    if (!cur) return jsonResponse(req, { error: 'Demo request not found' }, 404);
    if (cur.status !== 'rescheduling') return jsonResponse(req, { error: 'This demo is not waiting for a new time' }, 400);
    const slots = Array.isArray(cur.proposed_slots) ? (cur.proposed_slots as Array<{ date?: unknown; time?: unknown }>) : [];
    const slot = slots[slotIndex];
    const date = str(slot?.date, 10);
    const time = str(slot?.time, 8).slice(0, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return jsonResponse(req, { error: 'This proposed time is not valid' }, 400);
    const { data: st } = await admin.from('platform_settings').select('value').eq('key', 'demo_schedule_alerts').maybeSingle();
    const duration = cur.meeting_duration_min ?? readDemoSettings(st?.value).default_duration_min;
    const { data, error } = await userClient.rpc('admin_demo_schedule', {
      _id: requestId, _date: date, _time: time, _tz: validTz(cur.timezone) ? cur.timezone : 'UTC',
      _duration_min: duration, _meeting_link: cur.meeting_link || null, _note: note,
    });
    if (error) return jsonResponse(req, { error: error.code === 'PGRST202' ? 'not_installed' : error.message }, 400);
    kind = (data as { kind?: string })?.kind === 'rescheduled' ? 'rescheduled' : 'confirmed';
    version = String((data as { version?: number })?.version ?? '');
    // The proposal is answered: clear it, as the legacy confirm did.
    const { error: clearErr } = await admin.from('demo_requests')
      .update({ scheduled_date: date, scheduled_slot: time, proposed_slots: null, reschedule_reason: null, reschedule_requested_at: null })
      .eq('id', requestId);
    if (clearErr) console.error('admin-confirm-demo-reschedule: clearing proposal failed', { code: clearErr.code });
  }

  const { data: row } = await admin.from('demo_requests').select('*').eq('id', requestId).maybeSingle();
  if (!row) return jsonResponse(req, { ok: true, kind, email: 'skipped' });
  const { data: s } = await admin.from('platform_settings').select('value').eq('key', 'demo_schedule_alerts').maybeSingle();
  const view = buildDemoUpdateView(row as DemoRequestRow, kind, { site: SITE_URL, now: new Date(), settings: readDemoSettings(s?.value), note });
  const key = version ? `demo-meeting-${requestId}-${version}` : `demo-meeting-${requestId}-${row.scheduled_date}-${row.scheduled_slot}`;

  const template = 'demo-meeting-update';
  let email: 'sent' | 'skipped' | 'failed' = 'skipped';
  try {
    const result = await sendTemplateEmail(template, row.email, { idempotencyKey: key, replyTo: TEAM_EMAIL, templateData: view as unknown as Record<string, unknown> });
    email = result.sent ? 'sent' : 'skipped';
  } catch (e) {
    email = 'failed';
    console.warn('admin-confirm-demo-reschedule: e-mail failed', e instanceof Error ? e.message.slice(0, 200) : '');
  }
  const { error: logErr } = await admin.from('email_send_log').insert({
    message_id: null, template_name: template, recipient_email: row.email, status: email === 'sent' ? 'sent' : email === 'failed' ? 'failed' : 'suppressed', error_message: null,
  });
  if (logErr) console.error('send log failed', { code: logErr.code });
  return jsonResponse(req, { ok: true, kind, email });
});
