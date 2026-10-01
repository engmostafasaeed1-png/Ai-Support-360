import { describe, expect, it } from 'vitest';
import {
  buildLiveInterviewIcs,
  defaultMeetingUrl,
  googleCalendarUrl,
  outlookCalendarUrl,
  resolveMeetingUrl,
  type LiveInterviewEvent,
} from './liveInterviewCalendar';

const ev: LiveInterviewEvent = {
  sessionId: '56920ab0-050e-4640-b975-c945514cc591',
  title: 'Live interview: Mostafa; "M 2", test',
  start: new Date('2026-10-08T06:00:00Z'),
  durationMinutes: 45,
  meetingUrl: 'https://meet.jit.si/qurtuba-interview-56920ab0050e4640b975c945514cc591',
  roomUrl: 'https://www.aisapsupportnow.com/interview/live/56920ab0-050e-4640-b975-c945514cc591',
  attendees: ['Mostafa', 'M 2'],
};

// number of UTF-8 bytes of a string
const bytes = (s: string) => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, 'x').length;

describe('live interview calendar helpers', () => {
  it('derives the free Jitsi room from the session id', () => {
    expect(defaultMeetingUrl(ev.sessionId)).toBe(ev.meetingUrl);
  });

  it('keeps a stored https link and ignores anything else', () => {
    expect(resolveMeetingUrl(ev.sessionId, 'https://zoom.us/j/123')).toBe('https://zoom.us/j/123');
    expect(resolveMeetingUrl(ev.sessionId, 'javascript:alert(1)')).toBe(ev.meetingUrl);
    expect(resolveMeetingUrl(ev.sessionId, 'http://insecure.example/x')).toBe(ev.meetingUrl);
    expect(resolveMeetingUrl(ev.sessionId, null)).toBe(ev.meetingUrl);
  });

  it('builds an .ics with the link in location, description and the conference fields', () => {
    const unfolded = buildLiveInterviewIcs(ev).replace(/\r\n /g, '');
    expect(unfolded).toContain('UID:live-interview-56920ab0-050e-4640-b975-c945514cc591@aisapsupportnow.com');
    expect(unfolded).toContain('DTSTART:20261008T060000Z');
    expect(unfolded).toContain('DTEND:20261008T064500Z');
    expect(unfolded).toContain(`LOCATION:${ev.meetingUrl}`);
    expect(unfolded).toContain(`X-GOOGLE-CONFERENCE:${ev.meetingUrl}`);
    expect(unfolded).toContain('SUMMARY:Live interview: Mostafa\\; "M 2"\\, test');
    expect(unfolded).toContain(ev.roomUrl);
  });

  it('uses CRLF line endings and never exceeds 75 octets per line', () => {
    const ics = buildLiveInterviewIcs(ev);
    expect(ics.endsWith('\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(bytes(line)).toBeLessThanOrEqual(75);
  });

  it('builds Google and Outlook links that carry the time and the video link', () => {
    const g = new URL(googleCalendarUrl(ev));
    expect(g.searchParams.get('dates')).toBe('20261008T060000Z/20261008T064500Z');
    expect(g.searchParams.get('location')).toBe(ev.meetingUrl);
    const o = new URL(outlookCalendarUrl(ev));
    expect(o.searchParams.get('startdt')).toBe('2026-10-08T06:00:00.000Z');
    expect(o.searchParams.get('location')).toBe(ev.meetingUrl);
  });
});
