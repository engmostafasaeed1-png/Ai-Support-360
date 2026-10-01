// Authenticated endpoint used by the organizer (the admin who requested the interview, or any admin).
//   action "send"       (default) -> e-mails every participant except the organizer a personal invitation with
//                                    Accept / Suggest another time / Decline buttons. Also used to send it again.
//   action "reschedule"           -> sets a new start time, clears the answers and sends the invitations again.
// Links are always built from the server-side SITE_URL, never from the request body.
import {
  ADMIN_ROLES,
  adminClient,
  authenticateUser,
  getUserRoles,
  hasAnyRole,
  jsonResponse,
  preflight,
  SITE_URL,
  withinRateLimit,
} from '../_shared/security.ts';
import {
  UUID_RE,
  calendarLinks,
  formatWhen,
  isFinished,
  loadPeople,
  loadSession,
  meetingUrlFor,
  newToken,
  notifyUser,
  personContact,
  sendLogged,
  sha256Hex,
} from '../_shared/interview-invitations.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  if (!Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return jsonResponse(req, { error: 'Server misconfigured' }, 500);
  }

  const user = await authenticateUser(req);
  if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
  const admin = adminClient();

  let body: { session_id?: string; action?: string; scheduled_at?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const sessionId = body.session_id;
  if (!sessionId || !UUID_RE.test(sessionId)) return jsonResponse(req, { error: 'session_id is required' }, 400);
  const action = body.action === 'reschedule' ? 'reschedule' : 'send';

  if (!(await withinRateLimit(admin, `interview-invite:${user.id}`, 30, 3600))) {
    return jsonResponse(req, { error: 'Too many requests, try again later' }, 429);
  }

  const session = await loadSession(admin, sessionId);
  if (!session || session.interview_style !== 'live') return jsonResponse(req, { error: 'Interview not found' }, 404);
  const isAdmin = hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES);
  if (!isAdmin && session.requested_by !== user.id) return jsonResponse(req, { error: 'Forbidden' }, 403);
  if (isFinished(session.status)) return jsonResponse(req, { error: 'This interview is already finished' }, 409);

  let scheduledAt = session.scheduled_at;
  if (action === 'reschedule') {
    const when = body.scheduled_at ? new Date(body.scheduled_at) : null;
    if (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000 || when.getTime() > Date.now() + 365 * 86_400_000) {
      return jsonResponse(req, { error: 'scheduled_at must be a valid time in the future' }, 400);
    }
    scheduledAt = when.toISOString();
    const { error: updateError } = await admin.from('interview_sessions').update({ scheduled_at: scheduledAt }).eq('id', sessionId);
    if (updateError) {
      console.error('reschedule failed', { code: updateError.code, message: updateError.message });
      return jsonResponse(req, { error: 'Could not change the interview time' }, 500);
    }
    await admin
      .from('interview_participants')
      .update({ rsvp_status: 'pending', rsvp_at: null, rsvp_note: null, proposed_slots: null })
      .eq('session_id', sessionId);
  }

  const organizer = session.requested_by
    ? await personContact(admin, session.requested_by)
    : { name: 'The organizer', email: null as string | null };
  const people = await loadPeople(admin, sessionId);
  const invitees = people.filter((p) => p.user_id !== session.requested_by);
  const result = { sent: 0, suppressed: 0, failed: 0, skipped: 0 };
  if (!invitees.length) return jsonResponse(req, { ok: true, action, ...result });

  const meetingUrl = meetingUrlFor(session);
  const roomUrl = `${SITE_URL}/interview/live/${sessionId}`;
  const candidate = people.find((p) => p.role === 'candidate');
  const durationMinutes = session.duration_minutes || 60;
  const start = scheduledAt ? new Date(scheduledAt) : null;
  const links = start
    ? calendarLinks({ title: `Live interview: ${candidate?.name ?? 'Candidate'}`, start, durationMinutes, meetingUrl, roomUrl })
    : null;
  const expiresAt = new Date((start ? start.getTime() : Date.now()) + 14 * 86_400_000).toISOString();

  for (const person of invitees) {
    if (!person.email) {
      result.skipped++;
      continue;
    }
    const token = newToken();
    const { error: inviteError } = await admin.from('interview_invitations').upsert(
      {
        session_id: sessionId,
        user_id: person.user_id,
        token_hash: await sha256Hex(token),
        expires_at: expiresAt,
        sent_at: new Date().toISOString(),
        responded_at: null,
      },
      { onConflict: 'session_id,user_id' },
    );
    if (inviteError) {
      console.error('invitation save failed', { code: inviteError.code, message: inviteError.message });
      result.failed++;
      continue;
    }
    const replyBase = `${SITE_URL}/interview/respond/${token}`;
    const when = formatWhen(scheduledAt, person.timezone);
    const status = await sendLogged(admin, 'interview-invitation', person.email, {
      replyTo: organizer.email ?? undefined,
      idempotencyKey: `interview-invitation-${sessionId}-${person.user_id}-${scheduledAt ?? 'now'}-${action}-${Math.floor(Date.now() / 60_000)}`,
      templateData: {
        recipientName: person.name,
        organizerName: organizer.name,
        role: person.role,
        candidateName: candidate?.name ?? null,
        whenUtc: when?.utc ?? null,
        whenLocal: when?.local ?? null,
        durationMinutes,
        meetingUrl,
        roomUrl,
        acceptUrl: `${replyBase}?a=accept`,
        rescheduleUrl: `${replyBase}?a=reschedule`,
        declineUrl: `${replyBase}?a=decline`,
        googleUrl: links?.google ?? null,
        outlookUrl: links?.outlook ?? null,
        updated: action === 'reschedule',
      },
    });
    result[status]++;
    if (action === 'reschedule') {
      await notifyUser(
        admin,
        person.user_id,
        'Interview rescheduled',
        `Your live interview is now ${when?.utc ?? 'ready to start'}. Please confirm that you can join.`,
        `/interview/live/${sessionId}`,
      );
    }
  }

  return jsonResponse(req, { ok: true, action, ...result });
});
