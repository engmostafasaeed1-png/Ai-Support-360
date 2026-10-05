// Calendar helpers for live interviews: the free video-conference link plus Google / Outlook links and a downloadable .ics file.

export interface LiveInterviewEvent {
  sessionId: string;
  title: string;
  start: Date;
  durationMinutes: number;
  meetingUrl: string;
  roomUrl: string;
  attendees?: string[];
}

/** Free Jitsi Meet room derived from the session id (the database stores the same value in interview_sessions.meeting_url). */
export function defaultMeetingUrl(sessionId: string): string {
  return `https://meet.jit.si/qurtuba-interview-${sessionId.replace(/-/g, '')}`;
}

/** The stored link when it is a normal https link, otherwise the derived Jitsi room. */
export function resolveMeetingUrl(sessionId: string, stored?: string | null): string {
  return stored && /^https:\/\/\S+$/i.test(stored) ? stored : defaultMeetingUrl(sessionId);
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const endOf = (ev: LiveInterviewEvent) => new Date(ev.start.getTime() + ev.durationMinutes * 60_000);

const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const utf8Length = (s: string) => {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
};

// RFC 5545: lines are folded at 75 octets; continuation lines start with one space.
const fold = (line: string) => {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = utf8Length(ch);
    if (size + n > 75) {
      parts.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n');
};

export function buildLiveInterviewIcs(ev: LiveInterviewEvent): string {
  const description = [
    `Video call (free, opens in your browser): ${ev.meetingUrl}`,
    `Interview room and chat: ${ev.roomUrl}`,
    ev.attendees && ev.attendees.length ? `Participants: ${ev.attendees.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Support Now//Live interview//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:live-interview-${ev.sessionId}@aisupport360.com`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(ev.start)}`,
    `DTEND:${utc(endOf(ev))}`,
    `SUMMARY:${escapeText(ev.title)}`,
    `LOCATION:${escapeText(ev.meetingUrl)}`,
    `URL:${ev.roomUrl}`,
    `DESCRIPTION:${escapeText(description)}`,
    `CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL=Video call:${ev.meetingUrl}`,
    `X-GOOGLE-CONFERENCE:${ev.meetingUrl}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Live interview starts in 15 minutes',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadLiveInterviewIcs(ev: LiveInterviewEvent) {
  const blob = new Blob([buildLiveInterviewIcs(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `live-interview-${ev.start.toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const details = (ev: LiveInterviewEvent) => `Video call: ${ev.meetingUrl}\nInterview room and chat: ${ev.roomUrl}`;

export function googleCalendarUrl(ev: LiveInterviewEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${utc(ev.start)}/${utc(endOf(ev))}`,
    details: details(ev),
    location: ev.meetingUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function outlookUrl(base: string, ev: LiveInterviewEvent): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: ev.title,
    startdt: ev.start.toISOString(),
    enddt: endOf(ev).toISOString(),
    body: details(ev),
    location: ev.meetingUrl,
  });
  return `${base}/calendar/0/deeplink/compose?${params.toString()}`;
}

export const outlookCalendarUrl = (ev: LiveInterviewEvent) => outlookUrl('https://outlook.live.com', ev);
export const office365CalendarUrl = (ev: LiveInterviewEvent) => outlookUrl('https://outlook.office.com', ev);
