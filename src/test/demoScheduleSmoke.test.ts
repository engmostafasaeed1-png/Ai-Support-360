import { describe, it, expect } from 'vitest';
import { zonedToUtc, addBusinessMinutes, DEMO_ALERT_DEFAULTS, buildDemoAlertView, buildDemoUpdateView, viewLinks, dueWording, buildIcs } from '../../supabase/functions/_shared/demoSchedule.ts';
describe('demo smoke', () => {
  it('works', () => {
    expect(zonedToUtc('2026-11-03', '10:00', 'Europe/London')!.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(zonedToUtc('2026-11-03', '10:00', 'Asia/Riyadh')!.toISOString()).toBe('2026-11-03T07:00:00.000Z');
    // Thursday 17:30 Riyadh + 1 business hour -> Sunday 08:30 Riyadh
    expect(addBusinessMinutes(new Date('2026-11-05T14:30:00Z'), 60, DEMO_ALERT_DEFAULTS.calendar).toISOString()).toBe('2026-11-08T05:30:00.000Z');
    expect(dueWording(new Date('2026-11-01T10:45:00Z'), new Date('2026-11-01T10:00:00Z')).text).toBe('45 min left');
    const row = { id: 'a1', request_token: 'a'.repeat(32), demo_type: 'live', scheduling_preference: 'asap', scheduled_date: '2026-11-03', scheduled_slot: '10:00', timezone: 'Europe/London', full_name: 'Jane <b>Doe</b>', email: 'jane@acme.com', created_at: '2026-11-01T09:00:00Z' };
    const v = buildDemoAlertView(row, { site: 'https://evil.com', settings: DEMO_ALERT_DEFAULTS, now: new Date('2026-11-01T09:05:00Z'), kind: 'alert' });
    for (const l of viewLinks(v)) expect(l.startsWith('https://www.aisupport360.com/') || l.startsWith('mailto:jane@acme.com?')).toBe(true);
    expect(v.slots!.items[0].main).toContain('13:00');
    const u = buildDemoUpdateView({ ...row, language: 'ar', meeting_at: '2026-11-04T09:00:00Z' }, 'confirmed', { site: 'https://www.aisupport360.com', now: new Date() });
    expect(u.lang).toBe('ar');
    expect(buildIcs({ uid: 'x', start: new Date('2026-11-04T09:00:00Z'), durationMin: 30, title: 'Demo', status: 'TENTATIVE' })).toContain('DTSTART:20261104T090000Z');
  });
});
