// Public endpoint (verify_jwt = false): a participant answers a live-interview invitation.
// The caller proves who they are with EITHER the one-time secret from their invitation e-mail (body.token)
// OR a signed-in session (Authorization header + body.session_id). Identity and links never come from the body.
//   action "get"     (default) -> what the reply page needs to show
//   action "respond"           -> response = accepted | declined | reschedule_requested (+ note, + up to 3 proposed_slots)
import {
  adminClient,
  authenticateUser,
  clientIp,
  jsonResponse,
  preflight,
  SITE_URL,
  withinRateLimit,
} from '../_shared/security.ts';
import {
  TOKEN_RE,
  UUID_RE,
  formatWhen,
  isFinished,
  loadPeople,
  loadSession,
  meetingUrlFor,
  notifyUser,
  personContact,
  sendLogged,
  sha256Hex,
} from '../_shared/interview-invitations.ts';

const RESPONSES = ['accepted', 'declined', 'reschedule_requested'] as const;
type Answer = (typeof RESPONSES)[number];

function cleanNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 1000);
  return text || null;
}

function cleanSlots(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const slots: string[] = [];
  for (const item of value.slice(0, 3)) {
    const raw = typeof item === 'string' ? item : (item as { start?: unknown })?.start;
    const date = new Date(typeof raw === 'string' ? raw : '');
    if (Number.isNaN(date.getTime())) return null;
    if (date.getTime() < Date.now() || date.getTime() > Date.now() + 120 * 86_400_000) return null;
    slots.push(date.toISOString());
  }
  return slots;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405);
  if (!Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return jsonResponse(req, { error: 'Server misconfigured' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON' }, 400);
  }
  const admin = adminClient();

  let sessionId: string;
  let userId: string;
  let invitationId: string | null = null;

  if (typeof body.token === 'string') {
    if (!TOKEN_RE.test(body.token)) return jsonResponse(req, { error: 'This link is not valid' }, 400);
    if (!(await withinRateLimit(admin, `interview-rsvp:ip:${clientIp(req)}`, 60, 3600))) {
      return jsonResponse(req, { error: 'Too many requests, try again later' }, 429);
    }
    const hash = await sha256Hex(body.token);
    const { data: invitation } = await admin
      .from('interview_invitations')
      .select('id, session_id, user_id, expires_at')
      .eq('token_hash', hash)
      .maybeSingle();
    if (!invitation || new Date(invitation.expires_at).getTime() < Date.now()) {
      return jsonResponse(req, { error: 'This link is invalid or has expired' }, 404);
    }
    if (!(await withinRateLimit(admin, `interview-rsvp:tok:${hash.slice(0, 16)}`, 20, 86_400))) {
      return jsonResponse(req, { error: 'Too many replies, try again later' }, 429);
    }
    sessionId = invitation.session_id;
    userId = invitation.user_id;
    invitationId = invitation.id;
  } else {
    const user = await authenticateUser(req);
    if (!user) return jsonResponse(req, { error: 'Unauthorized' }, 401);
    const id = body.session_id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) return jsonResponse(req, { error: 'session_id is required' }, 400);
    if (!(await withinRateLimit(admin, `interview-rsvp:user:${user.id}`, 60, 3600))) {
      return jsonResponse(req, { error: 'Too many requests, try again later' }, 429);
    }
    sessionId = id;
    userId = user.id;
  }

  const session = await loadSession(admin, sessionId);
  if (!session || session.interview_style !== 'live') return jsonResponse(req, { error: 'Interview not found' }, 404);
  const people = await loadPeople(admin, sessionId);
  const me = people.find((p) => p.user_id === userId);
  if (!me) return jsonResponse(req, { error: 'You are not part of this interview' }, 403);
  const organizer = session.requested_by
    ? await personContact(admin, session.requested_by)
    : { name: 'The organizer', email: null as string | null };
  const candidate = people.find((p) => p.role === 'candidate');
  const finished = isFinished(session.status);

  const details = {
    role: me.role,
    myStatus: me.rsvp_status,
    organizerName: organizer.name,
    candidateName: candidate?.name ?? null,
    others: people.filter((p) => p.user_id !== userId).map((p) => ({ name: p.name, role: p.role })),
    scheduledAt: session.scheduled_at,
    durationMinutes: session.duration_minutes || 60,
    meetingUrl: meetingUrlFor(session),
    finished,
    roomPath: `/interview/live/${sessionId}`,
  };

  if (body.action !== 'respond') return jsonResponse(req, { ok: true, ...details });

  if (finished) return jsonResponse(req, { error: 'This interview is already finished' }, 409);
  const answer = body.response as Answer;
  if (!RESPONSES.includes(answer)) return jsonResponse(req, { error: 'Unknown response' }, 400);
  const note = cleanNote(body.note);
  let slots: string[] | null = null;
  if (answer === 'reschedule_requested') {
    slots = cleanSlots(body.proposed_slots);
    if (!slots) return jsonResponse(req, { error: 'Please suggest one to three times in the future' }, 400);
  }

  const now = new Date().toISOString();
  const { error: saveError } = await admin
    .from('interview_participants')
    .update({
      rsvp_status: answer,
      rsvp_at: now,
      rsvp_note: note,
      proposed_slots: slots ? slots.map((start) => ({ start })) : null,
    })
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (saveError) {
    console.error('reply save failed', { code: saveError.code, message: saveError.message });
    return jsonResponse(req, { error: 'Could not save your answer' }, 500);
  }
  if (invitationId) await admin.from('interview_invitations').update({ responded_at: now }).eq('id', invitationId);

  // Tell the organizer: in the app and by e-mail (replying to that e-mail writes to the participant).
  if (session.requested_by && session.requested_by !== userId) {
    const when = formatWhen(session.scheduled_at, null);
    const roomPath = `/interview/live/${sessionId}`;
    const title = answer === 'accepted' ? 'Interview accepted' : answer === 'declined' ? 'Interview declined' : 'Another time requested';
    const text =
      answer === 'reschedule_requested'
        ? `${me.name} would like another time for the live interview.`
        : `${me.name} ${answer === 'accepted' ? 'accepted' : 'declined'} the live interview${when ? ` on ${when.utc}` : ''}.`;
    await notifyUser(admin, session.requested_by, title, note ? `${text} Note: ${note}` : text, roomPath);
    if (organizer.email) {
      await sendLogged(admin, 'interview-response', organizer.email, {
        replyTo: me.email ?? undefined,
        idempotencyKey: `interview-response-${sessionId}-${userId}-${answer}-${Math.floor(Date.now() / 60_000)}`,
        templateData: {
          organizerName: organizer.name,
          responderName: me.name,
          responderRole: me.role,
          response: answer,
          whenUtc: when?.utc ?? null,
          proposedSlots: (slots ?? []).map((s) => formatWhen(s, null)?.utc ?? s),
          note,
          roomUrl: `${SITE_URL}${roomPath}`,
        },
      });
    }
  }

  return jsonResponse(req, { ok: true, ...details, myStatus: answer });
});
