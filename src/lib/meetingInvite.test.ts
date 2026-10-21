import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  addInvitees, buildIcs, cleanInvitees, codeForDbError, googleCalendarUrl, inviteStatusText, isValidEmail, joinPageUrl, maskAddress,
  meetingErrorText, normalizeEmail, MAX_EXTERNAL_INVITEES,
} from './meetingInvite';

const invoke = vi.fn();
const report = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock('@/lib/errorReporter', () => ({ reportError: (x: unknown) => report(x) }));
import { scheduleMeeting } from './scheduleMeeting';

describe('external e-mail addresses', () => {
  it.each([
    'sara@example.com', 'Sara.Ali@Example.COM', 'name+meeting@gmail.com', 'first.last+tag-1@mail.dept.example.co.uk',
    "o'brien@example.ie", 'x_y-z@sub.example.sa', 'user@xn--mgbh0fb.xn--kgbechtv', 'a@b.co',
  ])('accepts %s', (e) => expect(isValidEmail(e)).toBe(true));
  it.each([
    '', 'plainaddress', '@example.com', 'sara@', 'sara@example', 'sara@@example.com', 'sara example@x.com', '.sara@x.com',
    'sara.@x.com', 'sa..ra@x.com', 'sara@-x.com', 'sara@x.c', 'sara@x..com', `${'a'.repeat(65)}@x.com`,
  ])('rejects %s', (e) => expect(isValidEmail(e)).toBe(false));
  it('keeps the plus part and the local case, lower-cases the domain', () => {
    expect(normalizeEmail('  <mailto:Name+Tag@Mail.Example.COM>  ')).toBe('Name+Tag@mail.example.com');
  });
});

describe('chips', () => {
  it('pasted list: valid ones added, invalid kept for fixing, duplicates ignored (case-insensitive)', () => {
    const r = addInvitees(['a@x.com'], 'A@X.com, b+1@y.org; bad@ c@z.io\nd@w.net');
    expect(r.list).toEqual(['a@x.com', 'b+1@y.org', 'c@z.io', 'd@w.net']);
    expect(r.invalid).toEqual(['bad@']);
    expect(r.duplicates).toEqual(['A@x.com']);
  });
  it(`at most ${MAX_EXTERNAL_INVITEES}`, () => {
    const many = Array.from({ length: 12 }, (_, i) => `p${i}@x.com`).join(',');
    const r = addInvitees([], many);
    expect(r.list).toHaveLength(10);
    expect(r.overLimit).toEqual(['p10@x.com', 'p11@x.com']);
  });
  it('server-side check refuses anything else', () => {
    expect(cleanInvitees(['a@x.com', 'A@X.COM'])).toEqual({ ok: true, emails: ['a@x.com'] });
    expect(cleanInvitees(['a@x.com', 'nope'])).toMatchObject({ ok: false, code: 'invalid_email' });
    expect(cleanInvitees(Array.from({ length: 11 }, (_, i) => `p${i}@x.com`))).toMatchObject({ ok: false, code: 'too_many_invitees' });
    expect(cleanInvitees('a@x.com')).toMatchObject({ ok: false });
  });
});

describe('plain messages (never the raw database text)', () => {
  it('row-level security, overlap and approval errors', () => {
    expect(codeForDbError({ code: '42501', message: 'new row violates row-level security policy for table "sessions"' })).toBe('not_allowed');
    expect(codeForDbError({ code: '23P01', message: 'This consultant is already booked at that time' })).toBe('consultant_busy');
    expect(codeForDbError({ code: '42501', message: 'Your account is not approved yet.' })).toBe('client_not_approved');
    expect(meetingErrorText('consultant_busy')).toBe('This consultant already has a meeting at that time. Choose another time.');
    expect(meetingErrorText('weird_unknown')).toMatch(/problem on our side/);
    expect(meetingErrorText('invalid_email', 'ar')).toBe('أحد عناوين البريد الإلكتروني غير صحيح. تحقق منه وحاول مرة أخرى.');
  });
  it('per-recipient status text', () => {
    expect(inviteStatusText('sent')).toBe('Invitation sent');
    expect(inviteStatusText('suppressed')).toMatch(/unsubscribed or bounced/);
    expect(inviteStatusText('failed', 'ar')).toMatch(/^لم تُرسل/);
  });
  it('masks addresses for logs', () => expect(maskAddress('Sara+x@Example.com')).toBe('S***@example.com'));
});

describe('links and calendar', () => {
  const start = new Date('2026-11-02T08:00:00Z');
  it('join page needs no account; pasted links travel in ?to=', () => {
    expect(joinPageUrl('https://www.aisupport360.com/', 'abc')).toBe('https://www.aisupport360.com/join/abc');
    expect(joinPageUrl('https://www.aisupport360.com', 'abc', 'https://zoom.us/j/1?pwd=x')).toBe('https://www.aisupport360.com/join/abc?to=https%3A%2F%2Fzoom.us%2Fj%2F1%3Fpwd%3Dx');
  });
  it('ICS with start, end and join link, CRLF and escaped text', () => {
    const ics = buildIcs({ uid: 's1', start, durationMinutes: 90, title: 'SAP FI; posting, issue', url: 'https://www.aisupport360.com/join/s1', now: start });
    expect(ics).toContain('DTSTART:20261102T080000Z\r\n');
    expect(ics).toContain('DTEND:20261102T093000Z\r\n');
    expect(ics).toContain('SUMMARY:SAP FI\\; posting\\, issue');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('Google Calendar link', () => {
    expect(googleCalendarUrl({ start, durationMinutes: 60, title: 'T', url: 'https://x.y/join/1' })).toContain('dates=20261102T080000Z%2F20261102T090000Z');
  });
});

describe('scheduleMeeting call', () => {
  const input = { ticket_id: 't', consultant_ids: [], external_emails: ['a@x.com'], session_type: 'video', platform: 'jitsi', scheduled_at: '2026-12-01T10:00:00Z', duration_minutes: 60, reminder_minutes: 15, lang: 'en' as const };
  beforeEach(() => { invoke.mockReset(); report.mockReset(); });
  it('reads the plain code from the function error and logs it once without addresses', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ ok: false, code: 'not_allowed' }), { status: 403 }) } });
    const r = await scheduleMeeting(input);
    expect(r).toEqual({ ok: false, code: 'not_allowed' });
    expect(report).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.mock.calls[0][0])).not.toContain('a@x.com');
  });
  it('network failure', async () => {
    invoke.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await scheduleMeeting(input)).toEqual({ ok: false, code: 'network' });
  });
  it('a failed invitation e-mail is reported once; the meeting itself is kept', async () => {
    invoke.mockResolvedValue({ data: { ok: true, session_id: 's', meeting_url: 'm', join_url: 'j', invitations: [{ email: 'a@x.com', status: 'failed' }] }, error: null });
    const r = await scheduleMeeting(input);
    expect(r.ok).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
