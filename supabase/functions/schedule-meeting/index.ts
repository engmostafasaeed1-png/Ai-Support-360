// Bug H5: schedules a ticket meeting for the client of the ticket, an assigned consultant or an administrator, with
// assigned consultants and/or up to 10 external e-mail addresses (people without a portal account).
// The browser insert into sessions only allowed the ticket's client with an assigned consultant, so administrators and
// any "external only" meeting were refused by the row-level security policy. This function checks the caller itself
// (user token), validates every input, writes the session with the service role (the database guards for overlap,
// meeting links and tenant still run), tells extra consultants in-app and sends each external person one invitation
// e-mail with the public join page and calendar links. Responses carry plain error codes and per-recipient status.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import {
  cleanInvitees, codeForDbError, googleCalendarUrl, joinPageUrl, maskAddress, MAX_CONSULTANT_INVITEES, MEETING_PLATFORMS, SESSION_TYPES,
  type InviteResult, type MeetingErrorCode,
} from '../_shared/meetingInvite.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICS_FN = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1/meeting-ics`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const fail = (code: MeetingErrorCode, status: number) => jsonResponse(req, { ok: false, code }, status);
  if (req.method !== 'POST') return fail('invalid_input', 405);

  const caller = await authenticateUser(req);
  if (!caller) return fail('not_signed_in', 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail('invalid_input', 400); }
  const ticketId = String(b.ticket_id ?? '');
  const consultantIds = Array.isArray(b.consultant_ids) ? b.consultant_ids.map(String) : [];
  const sessionType = String(b.session_type ?? 'video');
  const platform = String(b.platform ?? 'jitsi');
  const lang = b.lang === 'ar' ? 'ar' : 'en';
  const duration = Number(b.duration_minutes);
  const reminder = Number(b.reminder_minutes ?? 15);
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 2000) : '';
  const startsAt = new Date(String(b.scheduled_at ?? ''));
  if (!UUID.test(ticketId) || consultantIds.length > MAX_CONSULTANT_INVITEES || consultantIds.some((c) => !UUID.test(c))) return fail('invalid_input', 400);
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType) || !(MEETING_PLATFORMS as readonly string[]).includes(platform)) return fail('invalid_input', 400);
  if (!Number.isInteger(duration) || duration < 15 || duration > 480 || !Number.isInteger(reminder) || reminder < 0 || reminder > 1440) return fail('invalid_input', 400);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 5 * 60_000 || startsAt.getTime() > Date.now() + 366 * 86_400_000) return fail('invalid_time', 400);
  const invitees = cleanInvitees(b.external_emails);
  if (!invitees.ok) return fail(invitees.code, 400);
  const uniqueConsultants = [...new Set(consultantIds)];
  if (uniqueConsultants.length === 0 && invitees.emails.length === 0) return fail('no_participants', 400);

  const pasted = (sessionType === 'video' || sessionType === 'screen_share') && platform !== 'jitsi';
  let pastedUrl = '';
  if (pasted) {
    pastedUrl = typeof b.meeting_url === 'string' ? b.meeting_url.trim() : '';
    try { const u = new URL(pastedUrl); if (u.protocol !== 'https:' || pastedUrl.length > 500) return fail('invalid_link', 400); } catch { return fail('invalid_link', 400); }
  }

  const admin = adminClient();
  if (!(await withinRateLimit(admin, `meeting-schedule:${caller.id}`, 20, 3600))) return fail('rate_limited', 429);

  const { data: ticket, error: tErr } = await admin.from('tickets').select('id, client_id, title').eq('id', ticketId).maybeSingle();
  if (tErr) return fail('server_error', 500);
  if (!ticket) return fail('ticket_not_found', 404);

  // Who may schedule: an administrator, the ticket's client, or a verified consultant assigned to the ticket.
  const roles = await getUserRoles(admin, caller.id);
  const isAdmin = hasAnyRole(roles, ADMIN_ROLES);
  const isClient = ticket.client_id === caller.id;
  let isAssignedConsultant = false;
  if (!isAdmin && !isClient) {
    const { data: me } = await admin.from('consultants').select('id, verification_status').eq('user_id', caller.id).maybeSingle();
    if (me?.verification_status === 'verified') {
      const { data: ok } = await admin.rpc('consultant_assigned_to_ticket', { _ticket_id: ticketId, _consultant_id: me.id });
      isAssignedConsultant = ok === true;
    }
    if (!isAssignedConsultant) return fail('not_allowed', 403);
  }
  if (isClient && !isAdmin) {
    const { data: required } = await admin.rpc('client_approval_required');
    if (required === true) {
      const { data: cp } = await admin.from('client_profiles').select('approval_status').eq('user_id', caller.id).maybeSingle();
      if (cp?.approval_status !== 'approved') return fail('client_not_approved', 403);
    }
  }
  // Every chosen consultant must be verified and assigned to this ticket.
  const consultantUsers = new Map<string, string>();
  if (uniqueConsultants.length) {
    const { data: cs } = await admin.from('consultants').select('id, user_id, verification_status').in('id', uniqueConsultants);
    for (const id of uniqueConsultants) {
      const c = (cs ?? []).find((x: { id: string }) => x.id === id) as { id: string; user_id: string; verification_status: string } | undefined;
      if (!c || c.verification_status !== 'verified') return fail('consultant_not_assigned', 400);
      const { data: ok } = await admin.rpc('consultant_assigned_to_ticket', { _ticket_id: ticketId, _consultant_id: id });
      if (ok !== true) return fail('consultant_not_assigned', 400);
      consultantUsers.set(id, c.user_id);
    }
  }

  const sessionId = crypto.randomUUID();
  const meetingUrl = pasted ? pastedUrl : `https://meet.jit.si/ai-support-360-${sessionId.replace(/-/g, '')}`;
  const primary = uniqueConsultants[0] ?? null;
  const { error: insErr } = await admin.from('sessions').insert({
    id: sessionId, ticket_id: ticketId, client_id: ticket.client_id, consultant_id: primary,
    session_type: sessionType, video_platform: platform, scheduled_at: startsAt.toISOString(), duration_minutes: duration,
    meeting_url: meetingUrl, status: 'scheduled', notes: notes || null, reminder_minutes: reminder,
  });
  if (insErr) {
    const code = codeForDbError(insErr);
    console.error('schedule-meeting insert failed', { code: insErr.code, mapped: code });
    return fail(code, code === 'server_error' ? 500 : 400);
  }

  // Extra consultants (the primary one is told by the database trigger).
  const when = startsAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const extra = uniqueConsultants.slice(1).map((id) => ({
    user_id: consultantUsers.get(id)!, title: 'Meeting Invitation', type: 'session', link: `/consultant/sessions/${sessionId}`,
    body: `You are invited to a ${sessionType.replace('_', ' ')} meeting for "${String(ticket.title ?? 'a request').slice(0, 120)}" on ${when}.`,
  }));
  if (extra.length) {
    const { error } = await admin.from('notifications').insert(extra);
    if (error) console.error('schedule-meeting: consultant notices failed');
  }

  // One invitation e-mail per external person (each person is invited individually; at most 10 per meeting).
  const { data: me } = await admin.from('profiles').select('display_name').eq('user_id', caller.id).maybeSingle();
  const organizer = (me?.display_name as string | undefined)?.trim() || 'AI Support 360';
  const join = joinPageUrl(SITE_URL, sessionId, pasted ? meetingUrl : null);
  const title = String(ticket.title ?? 'AI Support 360 meeting').slice(0, 160);
  const results: InviteResult[] = [];
  for (const email of invitees.emails) {
    if (!(await withinRateLimit(admin, `meeting-invite-email:${caller.id}`, 50, 3600))) { results.push({ email, status: 'rate_limited' }); continue; }
    try {
      const r = await sendTemplateEmail('meeting-invitation', email, {
        templateData: {
          lang, title, organizer, startsAt: startsAt.toISOString(), durationMinutes: duration, joinUrl: join,
          icsUrl: `${ICS_FN}?id=${sessionId}`, googleUrl: googleCalendarUrl({ start: startsAt, durationMinutes: duration, title, url: join }),
        },
        idempotencyKey: `meeting-invite-${sessionId}-${email.toLowerCase()}`,
      });
      results.push({ email, status: r.sent ? 'sent' : r.reason === 'recipient_suppressed' ? 'suppressed' : 'disabled' });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      results.push({ email, status: status === 429 ? 'rate_limited' : 'failed' });
      console.error('schedule-meeting: invitation failed', { to: maskAddress(email), status: status ?? null });
    }
  }

  await admin.from('audit_logs').insert({
    user_id: caller.id, action: 'meeting_scheduled', entity_type: 'sessions', entity_id: sessionId,
    metadata: { ticket_id: ticketId, consultants: uniqueConsultants.length, by: isAdmin ? 'admin' : isClient ? 'client' : 'consultant',
      external: results.map((r) => ({ to: maskAddress(r.email), status: r.status })) },
  });

  return jsonResponse(req, { ok: true, session_id: sessionId, meeting_url: meetingUrl, join_url: join, invitations: results }, 200);
});
