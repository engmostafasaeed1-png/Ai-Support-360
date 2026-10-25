// Bug H5 + Schedule meeting fix (Oct 25): schedules a ticket meeting for the client of the ticket, an assigned consultant or an
// administrator, with assigned consultants, optional colleagues of the same company and (when the administrator allows it)
// up to 10 external e-mail addresses (people without a portal account).
//
// Two actions:
// - "options": what the Schedule meeting dialog may offer (external switch, colleagues, busy times of the assigned
//   consultants for the conflict check). Busy times carry no titles, notes or names.
// - schedule (default): checks the caller itself (user token), validates every input, refuses a time at which a chosen
//   consultant is booked or marked unavailable, writes the session with the service role (the database guards for overlap,
//   meeting links and tenant still run), tells extra consultants and colleagues in-app, and sends each participant one
//   invitation e-mail (join page + .ics + Google Calendar links; pauses respected for portal members).
// Responses carry plain error codes and per-recipient status. The meeting link is never put in a notification: people open
// the session (participants) or the join page.
import { adminClient, ADMIN_ROLES, authenticateUser, getUserRoles, hasAnyRole, jsonResponse, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import {
  cleanInvitees, codeForDbError, googleCalendarUrl, joinPageUrl, maskAddress, MAX_CONSULTANT_INVITEES, MEETING_PLATFORMS, SESSION_TYPES,
  type InviteResult, type MeetingErrorCode,
} from '../_shared/meetingInvite.ts';
import { externalInvitesAllowed, findConflicts, type BusyInterval } from '../_shared/meetingSchedule.ts';
import { cleanText } from '../_shared/brdSafety.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICS_FN = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1/meeting-ics`;
const MAX_COLLEAGUES = 10;
const CLOSED = ['closed', 'cancelled'];
type Admin = ReturnType<typeof adminClient>;

async function setting(admin: Admin, key: string): Promise<unknown> {
  const { data } = await admin.from('platform_settings').select('value').eq('key', key).maybeSingle();
  return data?.value;
}

/** Busy times (sessions + unavailable periods) of the given consultants between from and to. */
async function busyTimes(admin: Admin, ids: string[], from: Date, to: Date): Promise<BusyInterval[]> {
  if (!ids.length) return [];
  const out: BusyInterval[] = [];
  const { data: sessions } = await admin.from('sessions').select('consultant_id, scheduled_at, duration_minutes')
    .in('consultant_id', ids).in('status', ['scheduled', 'in_progress'])
    .gte('scheduled_at', new Date(from.getTime() - 8 * 3600_000).toISOString()).lte('scheduled_at', to.toISOString()).limit(1000);
  for (const s of sessions ?? []) {
    if (!s.scheduled_at) continue;
    const start = new Date(s.scheduled_at);
    const mins = Math.max(1, Number(s.duration_minutes) || 60);
    out.push({ consultant_id: s.consultant_id, start: start.toISOString(), end: new Date(start.getTime() + mins * 60_000).toISOString(), kind: 'session' });
  }
  const { data: periods } = await admin.from('consultant_unavailable_periods').select('consultant_id, starts_at, ends_at')
    .in('consultant_id', ids).lte('starts_at', to.toISOString()).gte('ends_at', from.toISOString()).limit(500);
  for (const p of periods ?? []) out.push({ consultant_id: p.consultant_id, start: p.starts_at, end: p.ends_at, kind: 'unavailable' });
  return out;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const fail = (code: MeetingErrorCode, status: number) => jsonResponse(req, { ok: false, code }, status);
  if (req.method !== 'POST') return fail('invalid_input', 405);

  const caller = await authenticateUser(req);
  if (!caller) return fail('not_signed_in', 401);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail('invalid_input', 400); }
  const action = b.action === 'options' ? 'options' : 'schedule';
  const ticketId = String(b.ticket_id ?? '');
  if (!UUID.test(ticketId)) return fail('invalid_input', 400);

  const admin = adminClient();
  const { data: ticket, error: tErr } = await admin.from('tickets').select('id, client_id, title, status, consultant_id, tenant_id').eq('id', ticketId).maybeSingle();
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
  const canInviteColleagues = (isClient || isAdmin) && !!ticket.tenant_id;
  const externalAllowed = externalInvitesAllowed(await setting(admin, 'meeting_external_invites'));

  // The consultants assigned to the ticket (ticket consultant + active assignments).
  const { data: assigns } = await admin.from('ticket_assignments').select('consultant_id').eq('ticket_id', ticketId).eq('status', 'active');
  const assignedIds = [...new Set([ticket.consultant_id, ...(assigns ?? []).map((a: { consultant_id: string }) => a.consultant_id)].filter(Boolean) as string[])];

  // Colleagues = members of the ticket's company (not the ticket owner, not the caller).
  const colleagueList = async () => {
    if (!canInviteColleagues) return [] as { user_id: string; name: string }[];
    const { data: members } = await admin.from('tenant_members').select('user_id').eq('tenant_id', ticket.tenant_id).limit(200);
    const ids = [...new Set((members ?? []).map((m: { user_id: string }) => m.user_id))].filter((id) => id !== ticket.client_id && id !== caller.id);
    if (!ids.length) return [];
    const { data: profs } = await admin.from('profiles').select('user_id, display_name').in('user_id', ids);
    return ids.map((id) => ({ user_id: id, name: String((profs ?? []).find((p: { user_id: string }) => p.user_id === id)?.display_name ?? '').trim() || 'Colleague' }));
  };

  if (action === 'options') {
    const now = new Date();
    const busy = await busyTimes(admin, assignedIds, now, new Date(now.getTime() + 62 * 86_400_000));
    return jsonResponse(req, {
      ok: true, external_allowed: externalAllowed, can_invite_colleagues: canInviteColleagues,
      colleagues: await colleagueList(), busy, primary_consultant_id: ticket.consultant_id ?? null,
    }, 200);
  }

  // ---------------------------------------------------------------------------------------------- schedule
  const consultantIds = Array.isArray(b.consultant_ids) ? b.consultant_ids.map(String) : [];
  const colleagueIds = Array.isArray(b.colleague_ids) ? b.colleague_ids.map(String) : [];
  const sessionType = String(b.session_type ?? 'video');
  const platform = String(b.platform ?? 'jitsi');
  const lang = b.lang === 'ar' ? 'ar' : 'en';
  const duration = Number(b.duration_minutes);
  const reminder = Number(b.reminder_minutes ?? 15);
  const notes = typeof b.notes === 'string' ? cleanText(b.notes.trim().slice(0, 2000)).text : '';
  const startsAt = new Date(String(b.scheduled_at ?? ''));
  if (consultantIds.length > MAX_CONSULTANT_INVITEES || consultantIds.some((c) => !UUID.test(c))) return fail('invalid_input', 400);
  if (colleagueIds.length > MAX_COLLEAGUES || colleagueIds.some((c) => !UUID.test(c))) return fail('invalid_input', 400);
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType) || !(MEETING_PLATFORMS as readonly string[]).includes(platform)) return fail('invalid_input', 400);
  if (!Number.isInteger(duration) || duration < 15 || duration > 480 || !Number.isInteger(reminder) || reminder < 0 || reminder > 1440) return fail('invalid_input', 400);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 5 * 60_000 || startsAt.getTime() > Date.now() + 366 * 86_400_000) return fail('invalid_time', 400);
  const invitees = cleanInvitees(b.external_emails);
  if (!invitees.ok) return fail(invitees.code, 400);
  if (invitees.emails.length && !externalAllowed) return fail('external_disabled', 403);
  const uniqueConsultants = [...new Set(consultantIds)];
  const uniqueColleagues = [...new Set(colleagueIds)];
  if (uniqueConsultants.length === 0 && invitees.emails.length === 0 && uniqueColleagues.length === 0) return fail('no_participants', 400);
  if (CLOSED.includes(String(ticket.status ?? ''))) return fail('ticket_closed', 400);

  const pasted = (sessionType === 'video' || sessionType === 'screen_share') && platform !== 'jitsi';
  let pastedUrl = '';
  if (pasted) {
    pastedUrl = typeof b.meeting_url === 'string' ? b.meeting_url.trim() : '';
    try { const u = new URL(pastedUrl); if (u.protocol !== 'https:' || pastedUrl.length > 500) return fail('invalid_link', 400); } catch { return fail('invalid_link', 400); }
  }

  if (!(await withinRateLimit(admin, `meeting-schedule:${caller.id}`, 20, 3600))) return fail('rate_limited', 429);

  if (isClient && !isAdmin) {
    const { data: required } = await admin.rpc('client_approval_required');
    if (required === true) {
      const { data: cp } = await admin.from('client_profiles').select('approval_status').eq('user_id', caller.id).maybeSingle();
      if (cp?.approval_status !== 'approved') return fail('client_not_approved', 403);
    }
  }
  // Every chosen consultant must be verified, assigned to this ticket and not the client himself.
  const consultantUsers = new Map<string, string>();
  if (uniqueConsultants.length) {
    const { data: cs } = await admin.from('consultants').select('id, user_id, verification_status').in('id', uniqueConsultants);
    for (const id of uniqueConsultants) {
      const c = (cs ?? []).find((x: { id: string }) => x.id === id) as { id: string; user_id: string; verification_status: string } | undefined;
      if (!c || c.verification_status !== 'verified' || !assignedIds.includes(id)) return fail('consultant_not_assigned', 400);
      if (c.user_id === ticket.client_id) return fail('self_session', 400);
      consultantUsers.set(id, c.user_id);
    }
  }
  // Every chosen colleague must be a member of the ticket's company.
  if (uniqueColleagues.length) {
    const allowed = new Set((await colleagueList()).map((c) => c.user_id));
    if (uniqueColleagues.some((id) => !allowed.has(id))) return fail('colleague_not_allowed', 400);
  }
  // Conflict check for every chosen consultant (the database checks the primary one again under a lock).
  if (uniqueConsultants.length) {
    const end = new Date(startsAt.getTime() + duration * 60_000);
    const conflicts = findConflicts(await busyTimes(admin, uniqueConsultants, startsAt, end), uniqueConsultants, startsAt, duration);
    if (conflicts.length) return fail(conflicts.some((c) => c.kind === 'session') ? 'consultant_busy' : 'consultant_unavailable', 409);
  }

  const sessionId = crypto.randomUUID();
  const meetingUrl = pasted ? pastedUrl : `https://meet.jit.si/ai-support-360-${sessionId.replace(/-/g, '')}`;
  // The ticket's own consultant is the primary one when chosen (so the session shows on his calendar and in his lists).
  const primary = (ticket.consultant_id && uniqueConsultants.includes(ticket.consultant_id)) ? ticket.consultant_id : (uniqueConsultants[0] ?? null);
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

  const join = joinPageUrl(SITE_URL, sessionId, pasted ? meetingUrl : null);
  const joinPath = join.slice(SITE_URL.length) || `/join/${sessionId}`;
  const extraConsultants = uniqueConsultants.filter((id) => id !== primary);

  // Optional participant list (docs/sql/meeting-participants.sql). Before it is applied the insert fails quietly and
  // extra people use the join page; afterwards they also see the session in their portal.
  const participantRows = [
    ...extraConsultants.map((id) => ({ session_id: sessionId, user_id: consultantUsers.get(id)!, role: 'consultant', added_by: caller.id })),
    ...uniqueColleagues.map((id) => ({ session_id: sessionId, user_id: id, role: 'colleague', added_by: caller.id })),
  ];
  let participantsSaved = false;
  if (participantRows.length) {
    const { error } = await admin.from('session_participants').insert(participantRows);
    participantsSaved = !error;
  }

  // In-app notices for extra consultants and colleagues (the client and the primary consultant are told by the database trigger).
  const when = startsAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const ticketTitle = String(ticket.title ?? 'a request').slice(0, 120);
  const notices = [
    ...extraConsultants.map((id) => ({
      user_id: consultantUsers.get(id)!, title: 'Meeting Invitation', type: 'session',
      link: participantsSaved ? `/consultant/sessions/${sessionId}` : joinPath,
      body: `You are invited to a ${sessionType.replace('_', ' ')} meeting for "${ticketTitle}" on ${when}.`,
    })),
    ...uniqueColleagues.map((id) => ({
      user_id: id, title: 'Meeting Invitation', type: 'session',
      link: participantsSaved ? `/client/sessions/${sessionId}` : joinPath,
      body: `You are invited to a ${sessionType.replace('_', ' ')} meeting for "${ticketTitle}" on ${when}.`,
    })),
  ];
  if (notices.length) {
    const { error } = await admin.from('notifications').insert(notices);
    if (error) console.error('schedule-meeting: participant notices failed');
  }

  const { data: me } = await admin.from('profiles').select('display_name').eq('user_id', caller.id).maybeSingle();
  const organizer = (me?.display_name as string | undefined)?.trim() || 'AI Support 360';
  const title = String(ticket.title ?? 'AI Support 360 meeting').slice(0, 160);
  const mailData = (audience: 'guest' | 'member') => ({
    lang, audience, title, organizer, startsAt: startsAt.toISOString(), durationMinutes: duration, joinUrl: join,
    icsUrl: `${ICS_FN}?id=${sessionId}`, googleUrl: googleCalendarUrl({ start: startsAt, durationMinutes: duration, title, url: join }),
  });

  // Invitation e-mails to portal members (all chosen consultants and colleagues), pauses respected.
  const memberIds = [...new Set([...uniqueConsultants.map((id) => consultantUsers.get(id)!), ...uniqueColleagues])].filter((id) => id !== caller.id);
  let membersMailed = 0;
  if (memberIds.length) {
    const { data: users } = await admin.from('profiles').select('user_id, email').in('user_id', memberIds);
    for (const u of (users ?? []) as { user_id: string; email: string | null }[]) {
      if (!u.email) continue;
      try {
        const r = await sendTemplateEmail('meeting-invitation', u.email, {
          templateData: mailData('member'),
          idempotencyKey: `meeting-invite-${sessionId}-${u.user_id}`,
          pause: { userId: u.user_id, category: 'activity' },
        });
        if (r.sent) membersMailed++;
      } catch {
        console.error('schedule-meeting: member invitation failed', { to: maskAddress(u.email) });
      }
    }
  }

  // One invitation e-mail per external person (each person is invited individually; at most 10 per meeting).
  const results: InviteResult[] = [];
  for (const email of invitees.emails) {
    if (!(await withinRateLimit(admin, `meeting-invite-email:${caller.id}`, 50, 3600))) { results.push({ email, status: 'rate_limited' }); continue; }
    try {
      const r = await sendTemplateEmail('meeting-invitation', email, {
        templateData: mailData('guest'),
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
    metadata: { ticket_id: ticketId, consultants: uniqueConsultants.length, colleagues: uniqueColleagues.length, members_mailed: membersMailed,
      participants_saved: participantsSaved, by: isAdmin ? 'admin' : isClient ? 'client' : 'consultant',
      external: results.map((r) => ({ to: maskAddress(r.email), status: r.status })) },
  });

  return jsonResponse(req, { ok: true, session_id: sessionId, meeting_url: meetingUrl, join_url: join, invitations: results, members_mailed: membersMailed }, 200);
});
