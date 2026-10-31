import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEMO_ALERT_DEFAULTS, addBusinessMinutes, buildDemoAlertView, buildDemoUpdateView, buildIcs, demoSlots, dueWording, readDemoSettings,
  replyMailto, respondByFor, safeMeetingLink, viewLinks, zonedToUtc, type DemoRequestRow,
} from '../../supabase/functions/_shared/demoSchedule';
import { demoEmailText, renderDemoEmail } from '../../supabase/functions/_shared/demoScheduleEmail';

const SITE = 'https://www.aisupport360.com';
const row: DemoRequestRow = {
  id: '11111111-1111-1111-1111-111111111111', request_token: 'a'.repeat(32), demo_type: 'module-deep-dive', scheduling_preference: 'this-week',
  scheduled_date: '2026-11-03', scheduled_slot: '10:00', timezone: 'Europe/London', meeting_format: 'video',
  full_name: 'Jane <script>alert(1)</script> Doe', email: 'jane@acme.com', company: 'Acme & Co', requester_role: 'SAP FI lead',
  phone: '+44 20 7946 0000', sap_area: 'FI-AA', language: 'en', notes: 'See <b>FI-AA</b> runs\nand MM', source: 'landing-wizard',
  created_at: '2026-11-01T09:00:00Z',
};
const html = (v: ReturnType<typeof buildDemoAlertView>) => renderToStaticMarkup(renderDemoEmail(React.createElement as never, v) as React.ReactElement);
const now = new Date('2026-11-01T09:05:00Z');

describe('demo booking rules', () => {
  it('converts the requester wall time into the admin zone (daylight saving aware)', () => {
    expect(zonedToUtc('2026-11-03', '10:00', 'Europe/London')!.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(zonedToUtc('2026-07-03', '10:00', 'Europe/London')!.toISOString()).toBe('2026-07-03T09:00:00.000Z');
    const s = demoSlots(row, 'Asia/Riyadh', 'en', now)[0];
    expect(s.admin).toContain('13:00 (Asia/Riyadh)');
    expect(s.requester).toContain('10:00 (Europe/London)');
    expect(s.asEntered).toBe('2026-11-03 10:00 (Europe/London)');
  });

  it('deadline is 1 business hour by default, Sun–Thu 08:00–18:00 Riyadh', () => {
    expect(DEMO_ALERT_DEFAULTS.respond_business_hours).toBe(1);
    // Sunday 09:00 Riyadh -> 10:00 Riyadh
    expect(respondByFor(new Date('2026-11-01T06:00:00Z'), DEMO_ALERT_DEFAULTS).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    // Thursday 17:30 Riyadh -> Sunday 08:30 Riyadh (weekend skipped), same as the database checks
    expect(addBusinessMinutes(new Date('2026-11-05T14:30:00Z'), 60, DEMO_ALERT_DEFAULTS.calendar).toISOString()).toBe('2026-11-08T05:30:00.000Z');
    expect(readDemoSettings({ respond_business_hours: 500, daily_reminders_max: 9, admin_timezone: 'Mars/Base' })).toMatchObject({ respond_business_hours: 72, daily_reminders_max: 2, admin_timezone: 'Asia/Riyadh' });
  });

  it('countdown wording', () => {
    expect(dueWording(new Date('2026-11-01T10:00:00Z'), new Date('2026-11-01T09:15:00Z')).text).toBe('45 min left');
    expect(dueWording(new Date('2026-11-01T10:00:00Z'), new Date('2026-11-01T11:20:00Z')).text).toBe('Overdue by 1 h 20 min');
  });

  it('alert carries every form detail, both zones, the to-do box and the three buttons', () => {
    const v = buildDemoAlertView({ ...row, respond_by: '2026-11-01T10:00:00Z' }, { site: SITE, settings: DEMO_ALERT_DEFAULTS, now, kind: 'alert' });
    expect(v.title).toBe('Demo booked: schedule needed');
    const labels = v.rows.map((r) => r.label);
    for (const l of ['Name', 'Company', 'Role', 'E-mail', 'Phone / WhatsApp', 'Time zone', 'Language', 'SAP area / module', 'Source page', 'Request time']) expect(labels).toContain(l);
    expect(v.todo!.lines[0]).toContain('within 1 business hour');
    expect(v.todo!.strong).toContain('55 min left');
    expect(v.primary).toEqual({ label: 'Open request and schedule', href: `${SITE}/admin/demo-requests?request=${row.id}&action=schedule` });
    expect(v.secondary.map((s) => s.label)).toEqual(['Propose time', 'Reply to requester']);
    expect(v.secondary[1].href).toMatch(/^mailto:jane@acme\.com\?subject=Your%20AI%20Support%20360%20demo/);
  });

  it('no preferred time is flagged', () => {
    const v = buildDemoAlertView({ ...row, scheduled_date: null, scheduled_slot: null }, { site: SITE, settings: DEMO_ALERT_DEFAULTS, now, kind: 'alert' });
    expect(v.slots!.items).toHaveLength(0);
    expect(v.slots!.empty).toMatch(/^No preference/);
  });

  it('links only to our own site or the reply e-mail, even with a foreign site value', () => {
    for (const v of [
      buildDemoAlertView(row, { site: 'https://evil.example', settings: DEMO_ALERT_DEFAULTS, now, kind: 'alert' }),
      buildDemoAlertView(row, { site: SITE, settings: DEMO_ALERT_DEFAULTS, now, kind: 'reminder', reminderNo: 2 }),
      buildDemoUpdateView({ ...row, meeting_at: '2026-11-04T09:00:00Z', meeting_link: 'https://meet.example.com/x' }, 'confirmed', { site: SITE, now }),
      buildDemoUpdateView({ ...row, cancel_reason: 'Ill' }, 'cancelled', { site: SITE, now }),
    ]) {
      for (const l of viewLinks(v)) expect(l.startsWith(`${SITE}/`) || l.startsWith('mailto:jane@acme.com?')).toBe(true);
      const out = html(v);
      const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      for (const h of hrefs) expect(h.startsWith(SITE) || h.startsWith('mailto:')).toBe(true);
      expect(out).not.toContain('meet.example.com');
      // no tracking pixels: the logo is the only image
      expect((out.match(/<img /g) ?? []).length).toBe(1);
    }
  });

  it('escapes every text from the form', () => {
    const out = html(buildDemoAlertView(row, { site: SITE, settings: DEMO_ALERT_DEFAULTS, now, kind: 'alert' }));
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<b>FI-AA</b>');
    expect(out).toContain('Acme &amp; Co');
  });

  it('requester e-mail is in their language and time zone, Arabic right-to-left', () => {
    const v = buildDemoUpdateView({ ...row, language: 'ar', timezone: 'Asia/Dubai', meeting_at: '2026-11-04T09:00:00Z' }, 'rescheduled', { site: SITE, now });
    expect(v.title).toBe('موعد جديد للعرض التوضيحي');
    expect(v.rows[0].value).toContain('(Asia/Dubai)');
    expect(html(v)).toContain('dir="rtl"');
    expect(demoEmailText(v)).toContain('موعد جديد');
  });

  it('meeting links must be https without credentials; reply needs a valid address', () => {
    expect(safeMeetingLink('https://teams.microsoft.com/l/x')).toBe('https://teams.microsoft.com/l/x');
    expect(safeMeetingLink('http://x.com')).toBeNull();
    expect(safeMeetingLink('https://user:pw@x.com')).toBeNull();
    expect(safeMeetingLink('javascript:alert(1)')).toBeNull();
    expect(replyMailto({ ...row, email: 'a@b.com?cc=x@y.com' })).toBeNull();
  });

  it('calendar file is tentative per slot and escapes text', () => {
    const ics = buildIcs({ uid: 'demo-1', start: new Date('2026-11-04T09:00:00Z'), durationMin: 30, title: 'Demo, Acme; FI', status: 'TENTATIVE', now: new Date('2026-11-01T00:00:00Z') });
    expect(ics).toContain('DTSTART:20261104T090000Z');
    expect(ics).toContain('DTEND:20261104T093000Z');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('SUMMARY:Demo\\, Acme\\; FI');
  });
});
