// Bug H5: calendar file for a meeting invitation (app e-mails can not carry attachments, so the invitation links here).
// Public like the /join/:sessionId page: the session id (122 random bits) is the key. Only a scheduled or running
// meeting is served, with a neutral title and the join page link - no ticket text, names or notes.
import { adminClient, clientIp, preflight, SITE_URL, withinRateLimit } from '../_shared/security.ts';
import { buildIcs, joinPageUrl } from '../_shared/meetingInvite.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return notFound();
  const admin = adminClient();
  if (!(await withinRateLimit(admin, `meeting-ics:${clientIp(req)}`, 60, 3600))) return new Response('Too many requests', { status: 429 });
  const { data: s } = await admin.from('sessions').select('id, scheduled_at, duration_minutes, meeting_url, video_platform, status').eq('id', id).maybeSingle();
  if (!s || !s.scheduled_at || !['scheduled', 'in_progress'].includes(String(s.status))) return notFound();
  const pasted = s.video_platform && s.video_platform !== 'jitsi';
  const url = joinPageUrl(SITE_URL, s.id, pasted ? s.meeting_url : null);
  const ics = buildIcs({ uid: s.id, start: new Date(s.scheduled_at), durationMinutes: Number(s.duration_minutes) || 60, title: 'AI Support 360 meeting', url });
  return new Response(ics, {
    status: 200,
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="meeting.ics"', 'Cache-Control': 'no-store' },
  });
});
