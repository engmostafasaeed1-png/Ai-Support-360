// Authenticated endpoint used by the organizer (the admin who requested the interview, or any admin).
//   action "send"       (default) -> e-mails every participant except the organizer a personal invitation with
//                                    Accept / Suggest another time / Decline buttons. Also used to send it again.
//   action "reschedule"           -> sets a new start time, clears the answers and sends the invitations again.
// Optional extra recipients (up to 5 each, nothing is stored):
//   extra_to -> more addresses for the candidate: they get the same invitation, with the candidate's own answer buttons.
//   cc       -> addresses that get a copy for information (no answer buttons), one e-mail per address.
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
  cleanEmails,
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

const MAX_OUTSIDE = 5;

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

  let body: { session_id?: string; action?: string; scheduled_at?: string; extra_to?: unknown; cc?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const sessionId = body.session_id;
  if (!sessionId || !UUID_RE.test(sessionId)) return jsonResponse(req, { error: 'session_id is required' }, 400);
  const action = body.action === 'reschedule' ? 'reschedule' : 'send';
  const extra = cleanEmails(body.extra_to, MAX_OUTSIDE);
  if (extra.error) return jsonResponse(req, { error: extra.error }, 400);
  const ccList = cleanEmails(body.cc, MAX_OUTSIDE);
  if (ccList.error) return jsonResponse(req, { error: ccList.error }, 400);

  if (!(await withinRateLimit(admin, `interview-invite:${user.id}`, 30, 3600))) {
    return jsonResponse(req, { error: 'Too many requests, try again later' }, 429);
  }

  const session = await loadSession(admin, sessionId);
  if (!session || session.interview_style !== 'live') return jsonResponse(req, { error: 'Interview not found' }, 404);
  const isAdmin = hasAnyRole(await getUserRoles(admin, user.id), ADMIN_ROLES);
  if (!isAdmin && session.requested_by !== user.id) return jsonResponse(req, { error: 'Forbidden' }, 403);
  if (isFinished(session.status)) return jsonResponse(req, { error: 'This interview is already finished' }, 409);

  // Addresses outside the platform are limited per organizer so the form cannot be used to mail strangers in bulk.
  for (let i = 0; i < extra.emails.length + ccList.emails.length; i++) {
    if (!(await withinRateLimit(admin, `interview-invite-outside:${user.id}`, 40, 3600))) {
      return jsonResponse(req, { error: 'Too many outside addresses this hour, try again later' }, 429);
    }
  }

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
  // Extra recipients and copies may only go to people already on this interview.
  const onInterview = new Set(
    [...people.map((p) => p.email), organizer.email].filter(Boolean).map((e) => String(e).toLowerCase()),
  );
  extra.emails = extra.emails.filter((e) => onInterview.has(e.toLowerCase()));
  ccList.emails = ccList.emails.filter((e) => onInterview.has(e.toLowerCase()));
  const invitees = people.filter((p) => p.user_id !== session.requested_by);
  const result = { sent: 0, suppressed: 0, failed: 0, skipped: 0 };
  const outside = {
    extra: { sent: 0, suppressed: 0, failed: 0 },
    cc: { sent: 0, suppressed: 0, failed: 0 },
  };
  if (!invitees.length) return jsonResponse(req, { ok: true, action, ...result, ...outside });

  const meetingUrl = meetingUrlFor(session);
  const roomUrl = `${SITE_URL}/interview/live/${sessionId}`;
  const candidate = people.find((p) => p.role === 'candidate');
  const durationMinutes = session.duration_minutes || 60;
  const start = scheduledAt ? new Date(scheduledAt) : null;
  const links = start
    ? calendarLinks({ title: `Live interview: ${candidate?.name ?? 'Candidate'}`, start, durationMinutes, meetingUrl, roomUrl })
    : null;
  const expiresAt = new Date((start ? start.getTime() : Date.now()) + 14 * 86_400_000).toISOString();
  const minute = Math.floor(Date.now() / 60_000);

  for (const person of invitees) {
    const ownAddress = person.email?.toLowerCase() ?? null;
    // Extra addresses belong to the candidate only; an address that is already theirs is not mailed twice.
    const extras = person.role === 'candidate' ? extra.emails.filter((e) => e !== ownAddress) : [];
    if (!ownAddress && !extras.length) {
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
    const options = (to: string) => ({
      replyTo: organizer.email ?? undefined,
      idempotencyKey: `interview-invitation-${sessionId}-${person.user_id}-${to}-${scheduledAt ?? 'now'}-${action}-${minute}`,
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
    if (person.email) {
      const status = await sendLogged(admin, 'interview-invitation', person.email, options(person.email));
      result[status]++;
    }
    for (const address of extras) {
      const status = await sendLogged(admin, 'interview-invitation', address, options(address));
      outside.extra[status]++;
    }
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

  // Copies for information: no answer buttons, one e-mail per address, never to someone who already got the real invitation.
  if (ccList.emails.length) {
    const alreadyMailed = new Set<string>([
      ...invitees.map((p) => p.email?.toLowerCase() ?? ''),
      ...extra.emails,
    ]);
    const invited = invitees.map((p) => `${p.name} (${p.role})`);
    for (const address of ccList.emails) {
      if (alreadyMailed.has(address)) continue;
      const status = await sendLogged(admin, 'interview-invitation-copy', address, {
        replyTo: organizer.email ?? undefined,
        idempotencyKey: `interview-copy-${sessionId}-${address}-${scheduledAt ?? 'now'}-${action}-${minute}`,
        templateData: {
          organizerName: organizer.name,
          invited,
          candidateName: candidate?.name ?? null,
          whenUtc: formatWhen(scheduledAt)?.utc ?? null,
          durationMinutes,
          meetingUrl,
          googleUrl: links?.google ?? null,
          outlookUrl: links?.outlook ?? null,
          updated: action === 'reschedule',
        },
      });
      outside.cc[status]++;
    }
  }

  return jsonResponse(req, { ok: true, action, ...result, ...outside });
});
