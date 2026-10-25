import { describe, expect, it } from 'vitest';
import {
  acceptanceSummary, addBusinessMinutes, businessMinutes, clockState, diffPolicies, dueSteps, escalationPlan, formatMinutes,
  hasErrors, inQuietHours, normalizeBody, normalizeSettings, platformDefaultBody, policyProblems, previewDue, repeatDue,
  replayClock, resolveCalendar, severityFor, snapshotFor, stepThreshold, templateBody, DEFAULT_BOUNDS, type ClockRow,
  type PolicyBody, type ResolvedCalendar,
} from '../../../supabase/functions/_shared/slaPolicy';

const utc = (s: string) => Date.parse(s);
const RIYADH: ResolvedCalendar = { mode: 'business', tz: 'Asia/Riyadh', days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', holidays: [] };
const ALWAYS: ResolvedCalendar = { mode: '24x7', tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', holidays: [] };
const meta = { name: 'Company SLA', description: '', applies_to: { kind: 'all' as const, values: [] } };
const ctx = { bounds: DEFAULT_BOUNDS, unpausableAllowed: true, allowedDomains: ['acme.com'], memberEmails: ['ops@acme.com'] };

describe('business-minute calculation', () => {
  it('24x7 counts every minute', () => {
    expect(businessMinutes(utc('2026-03-01T10:00:00Z'), utc('2026-03-02T10:00:00Z'), ALWAYS)).toBe(1440);
    expect(addBusinessMinutes(utc('2026-03-01T10:00:00Z'), 90, ALWAYS)).toBe(utc('2026-03-01T11:30:00Z'));
  });

  it('owner example: S2 opened Sunday 17:00 with 60 business minutes is due Monday 10:00 (Riyadh, Sun–Thu 09–17)', () => {
    // Sunday 2026-11-01 17:00 Riyadh (UTC+3) = 14:00Z.
    const due = addBusinessMinutes(utc('2026-11-01T14:00:00Z'), 60, RIYADH);
    expect(due).toBe(utc('2026-11-02T07:00:00Z')); // Monday 10:00 local
  });

  it('skips the weekend (Friday/Saturday) and counts only inside the window', () => {
    // Thursday 16:00 local -> 60 min left of Thursday, then Sunday.
    const thu = utc('2026-11-05T13:00:00Z');
    expect(addBusinessMinutes(thu, 120, RIYADH)).toBe(utc('2026-11-08T07:00:00Z')); // Sunday 10:00
    expect(businessMinutes(thu, utc('2026-11-08T07:00:00Z'), RIYADH)).toBe(120);
  });

  it('skips holidays', () => {
    const cal = { ...RIYADH, holidays: ['2026-11-02'] };
    expect(addBusinessMinutes(utc('2026-11-01T14:00:00Z'), 60, cal)).toBe(utc('2026-11-03T07:00:00Z'));
  });

  it('follows daylight saving time (Berlin, spring forward on 29 March 2026)', () => {
    const berlin: ResolvedCalendar = { mode: 'business', tz: 'Europe/Berlin', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00', holidays: [] };
    // Saturday 28 March 16:00 CET (15:00Z) + 120 min = Sunday 29 March 10:00 CEST = 08:00Z.
    expect(addBusinessMinutes(utc('2026-03-28T15:00:00Z'), 120, berlin)).toBe(utc('2026-03-29T08:00:00Z'));
    expect(businessMinutes(utc('2026-03-28T15:00:00Z'), utc('2026-03-29T08:00:00Z'), berlin)).toBe(120);
  });

  it('time zone moves the window (New York)', () => {
    const ny: ResolvedCalendar = { mode: 'business', tz: 'America/New_York', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', holidays: [] };
    // Monday 2 Nov 2026 08:00 EST = 13:00Z; first counted minute starts 09:00 EST = 14:00Z.
    expect(addBusinessMinutes(utc('2026-11-02T13:00:00Z'), 30, ny)).toBe(utc('2026-11-02T14:30:00Z'));
  });

  it('returns null when no working day exists, and 0 for an empty range', () => {
    expect(addBusinessMinutes(0, 10, { ...RIYADH, days: [] })).toBeNull();
    expect(businessMinutes(10, 5, RIYADH)).toBe(0);
  });

  it('uses the company time zone when the policy has none, UTC when neither is valid', () => {
    const body = templateBody('standard');
    expect(resolveCalendar(body.coverage, 'Asia/Dubai').tz).toBe('Asia/Dubai');
    expect(resolveCalendar(body.coverage, 'Not/AZone').tz).toBe('UTC');
    expect(resolveCalendar({ ...body.coverage, holiday_lists: ['SA'] }, null, { SA: ['2026-09-23'] }).holidays).toEqual(['2026-09-23']);
  });
});

describe('pause and resume', () => {
  it('pausing stops the clock and resuming continues it', () => {
    const start = utc('2026-11-01T06:00:00Z'); // Sunday 09:00 local
    const r = replayClock(240, RIYADH, [
      { at: start, type: 'start' },
      { at: start + 60 * 60_000, type: 'pause' }, // 1 h used
      { at: start + 180 * 60_000, type: 'resume' }, // 2 h paused
    ], start + 240 * 60_000);
    expect(r.consumed).toBe(120);
    expect(r.due).toBe(start + 360 * 60_000); // 3 h left after resuming at 12:00 -> 15:00 local
    expect(r.breached).toBe(false);
  });

  it('a stopped clock no longer counts', () => {
    const r = replayClock(60, ALWAYS, [{ at: 0, type: 'start' }, { at: 30 * 60_000, type: 'stop' }], 10 * 60 * 60_000);
    expect(r.consumed).toBe(30);
    expect(r.stoppedAt).toBe(30 * 60_000);
  });

  it('clock state: paused, at risk, breached, met late', () => {
    const base: ClockRow = { kind: 'response', target_min: 100, extended_min: 0, started_at: '2026-03-01T10:00:00Z', running_since: '2026-03-01T10:00:00Z',
      consumed_min: 0, paused_since: null, pause_reason: null, due_at: null, met_at: null, breached_at: null, stopped_at: null };
    expect(clockState(base, utc('2026-03-01T10:50:00Z'), ALWAYS).state).toBe('on_track');
    expect(clockState(base, utc('2026-03-01T11:20:00Z'), ALWAYS).state).toBe('at_risk');
    expect(clockState(base, utc('2026-03-01T11:41:00Z'), ALWAYS).state).toBe('breached');
    expect(clockState({ ...base, running_since: null, consumed_min: 20, paused_since: '2026-03-01T10:20:00Z' }, utc('2026-03-02T00:00:00Z'), ALWAYS).state).toBe('paused');
    expect(clockState({ ...base, met_at: '2026-03-01T12:00:00Z', breached_at: '2026-03-01T11:40:00Z' }, utc('2026-03-02T00:00:00Z'), ALWAYS).state).toBe('met_late');
    expect(clockState({ ...base, extended_min: 60 }, utc('2026-03-01T11:41:00Z'), ALWAYS).state).toBe('on_track');
  });
});

describe('escalation scheduling', () => {
  const steps = templateBody('standard').severities.S2.escalations;

  it('thresholds: percent of target and minutes after breach', () => {
    expect(stepThreshold({ ...steps[0], kind: 'percent', value: 75 }, 120)).toBe(90);
    expect(stepThreshold({ ...steps[0], kind: 'after_breach', value: 60 }, 120)).toBe(180);
  });

  it('fires each step once, in order, only when its share of the target is used', () => {
    expect(dueSteps(steps, 'response', 120, 59, new Set()).map((x) => x.s.value)).toEqual([]);
    const at60 = dueSteps(steps, 'response', 120, 60, new Set());
    expect(at60.map((x) => x.s.value)).toEqual([50]);
    expect(dueSteps(steps, 'response', 120, 120, new Set(at60.map((x) => x.key))).map((x) => x.s.value)).toEqual([75, 90, 100]);
  });

  it('repeats are at least 30 minutes apart, capped and stop after acknowledgement', () => {
    const s = { ...steps[0], repeat_min: 10, until_ack: true };
    const b = { max_repeats: 3, min_repeat_min: 30 };
    expect(repeatDue(s, 0, 0, 20 * 60_000, false, b)).toBeNull();
    expect(repeatDue(s, 0, 0, 31 * 60_000, false, b)).toBe(1);
    expect(repeatDue(s, 0, 1, 50 * 60_000, false, b)).toBeNull();
    expect(repeatDue(s, 0, 3, 600 * 60_000, false, b)).toBeNull();
    expect(repeatDue(s, 0, 0, 31 * 60_000, true, b)).toBeNull();
  });

  it('plans step times inside business hours', () => {
    const plan = escalationPlan(steps, 'response', 120, utc('2026-11-01T13:00:00Z'), RIYADH); // Sunday 16:00 local
    expect(plan[0].at).toBe(utc('2026-11-01T14:00:00Z')); // 50 % = 60 min -> 17:00
    expect(plan[1].at).toBe(utc('2026-11-02T06:30:00Z')); // 75 % = 90 min -> Monday 09:30
  });

  it('quiet hours wrap over midnight in the recipient time zone', () => {
    const q = { start: '22:00', end: '07:00' };
    expect(inQuietHours(utc('2026-11-01T20:30:00Z'), 'Asia/Riyadh', q)).toBe(true); // 23:30 local
    expect(inQuietHours(utc('2026-11-01T06:30:00Z'), 'Asia/Riyadh', q)).toBe(false); // 09:30 local
  });
});

describe('bounds validation', () => {
  it('the platform default and the three templates are valid', () => {
    for (const body of [platformDefaultBody(), templateBody('standard'), templateBody('enterprise_24x7'), templateBody('business_light')]) {
      expect(hasErrors(policyProblems(body, meta, ctx))).toBe(false);
    }
  });

  it('refuses targets below the admin minimum and resolution before response', () => {
    const body = templateBody('standard');
    body.severities.S1.response_min = 10;
    body.severities.S3.resolution_min = 400;
    body.severities.S4.resolution_min = body.severities.S4.response_min;
    const codes = policyProblems(body, meta, ctx).map((p) => p.code);
    expect(codes).toContain('below_min_response');
    expect(codes).toContain('below_min_resolution');
    expect(codes).toContain('resolution_before_response');
  });

  it('S1 response under 60 minutes needs the Critical service (warning, not error)', () => {
    const body = templateBody('standard');
    body.severities.S1.response_min = 30;
    const p = policyProblems(body, meta, ctx).find((x) => x.code === 'premium_required');
    expect(p).toMatchObject({ level: 'warning', params: { severity: 'S1', under: 60, requires: 'critical_service' } });
  });

  it('refuses SMS, repeats under 30 minutes and unpausable steps outside S1', () => {
    const raw = JSON.parse(JSON.stringify(templateBody('standard')));
    raw.severities.S2.escalations[0].channels = ['sms'];
    const body = normalizeBody(raw);
    body.severities.S3.escalations[0].repeat_min = 15;
    body.severities.S3.escalations[1].unpausable = true;
    const codes = policyProblems(body, meta, ctx, raw).map((p) => p.code);
    expect(codes).toContain('channel_not_allowed');
    expect(codes).toContain('repeat_too_often');
    expect(codes).toContain('unpausable_not_allowed');
  });

  it('extra contacts must be registered members on the company domain', () => {
    const body: PolicyBody = { ...templateBody('standard'), extra_contacts: ['ops@acme.com', 'boss@gmail.com', 'x@other.com', 'new@acme.com'] };
    const p = policyProblems(body, meta, ctx).filter((x) => x.path === 'extra_contacts').map((x) => `${x.code}:${x.params?.email}`);
    expect(p).toEqual(['contact_domain:boss@gmail.com', 'contact_domain:x@other.com', 'contact_not_member:new@acme.com']);
  });

  it('refuses coverage modes the admin does not allow and contact details in free text', () => {
    const body = templateBody('enterprise_24x7');
    const codes = policyProblems(body, { ...meta, description: 'call +966 55 123 4567' }, { ...ctx, bounds: { ...DEFAULT_BOUNDS, allowed_coverage: ['business'] } }).map((p) => p.code);
    expect(codes).toContain('coverage_not_allowed');
    expect(codes).toContain('contact_details');
  });

  it('business hours need working days and end after start', () => {
    const body = templateBody('standard');
    body.coverage = { ...body.coverage, days: [], start: '17:00', end: '09:00' };
    const codes = policyProblems(body, meta, ctx).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['no_working_days', 'end_before_start']));
  });
});

describe('snapshot immutability and diff', () => {
  it('editing the policy after the snapshot does not change the ticket copy', () => {
    const body = templateBody('standard');
    const snap = snapshotFor({ id: 'p1', name: 'Std', version: 3, body }, 'S2', { criticalService: false, premium: DEFAULT_BOUNDS.premium, calendar: RIYADH });
    body.severities.S2.response_min = 999;
    body.severities.S2.escalations.length = 0;
    expect(snap.response_min).toBe(120);
    expect(snap.escalations.length).toBe(6);
    expect(Object.isFrozen(snap) && Object.isFrozen(snap.escalations[0])).toBe(true);
    expect(() => { (snap as { response_min: number }).response_min = 1; }).toThrow();
  });

  it('caps a premium S1 target when the Critical service was not bought', () => {
    const body = templateBody('standard');
    body.severities.S1.response_min = 30;
    const opts = { premium: DEFAULT_BOUNDS.premium, calendar: RIYADH };
    expect(snapshotFor({ id: 'p', name: 'x', version: 1, body }, 'S1', { ...opts, criticalService: false })).toMatchObject({ response_min: 60, premium_capped: true });
    expect(snapshotFor({ id: 'p', name: 'x', version: 1, body }, 'S1', { ...opts, criticalService: true })).toMatchObject({ response_min: 30, premium_capped: false });
  });

  it('diff lists only changed fields', () => {
    const a = templateBody('standard');
    const b = templateBody('standard');
    b.severities.S2.response_min = 180;
    b.coverage.start = '08:00';
    expect(diffPolicies({ body: a }, { body: b }).map((d) => d.path)).toEqual(['coverage.start', 'severities.S2.response_min']);
  });
});

describe('defaults and text', () => {
  it('platform default equals today\'s SLA (24x7 from submission, breach notice to consultant and admins)', () => {
    const d = platformDefaultBody();
    expect([d.severities.S1.response_min, d.severities.S1.resolution_min, d.severities.S4.resolution_min]).toEqual([60, 480, 10080]);
    expect(d.coverage.mode).toBe('24x7');
    expect(d.clock).toEqual({ start: 'submitted', pause: [], stop: 'resolved' });
    expect(d.severities.S2.escalations.every((s) => s.value === 100 && s.channels.join() === 'in_app')).toBe(true);
  });

  it('settings default to OFF and fall back safely', () => {
    const s = normalizeSettings({ enabled: 'yes', bounds: { min_repeat_min: 5 } });
    expect(s.enabled).toBe(false);
    expect(s.bounds.min_repeat_min).toBe(30);
    expect(severityFor('critical', s.urgency_map)).toBe('S1');
    expect(severityFor('unknown')).toBe('S3');
  });

  it('preview and acceptance summary', () => {
    const body = templateBody('standard');
    const due = previewDue(body, 'S2', utc('2026-11-01T14:00:00Z'), RIYADH); // Sunday 17:00 local
    expect(due.response).toBe(utc('2026-11-02T08:00:00Z')); // 120 min -> Monday 11:00
    const snap = snapshotFor({ id: 'p', name: 'x', version: 1, body }, 'S2', { criticalService: false, premium: [], calendar: RIYADH });
    expect(acceptanceSummary(snap)).toBe('S2 response 2 h, resolution 2 business days (business hours), escalations to lead, all_assigned, client_manager, client_contact, admin');
    expect(formatMinutes(-95)).toBe('-1 h 35 m');
  });
});
