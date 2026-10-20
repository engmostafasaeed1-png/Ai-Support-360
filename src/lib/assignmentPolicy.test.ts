import { describe, expect, it } from 'vitest';
import {
  POLICY_DEFAULTS, dueStep, nextPopup, policyText, popupKey, readPolicyMinutes, responseDeadline, responseRate, scheduleFor,
  stepRecipient, timeLeftLabel, type RequestState, type StepRow,
} from '../../supabase/functions/_shared/assignmentPolicy';

const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);
const MIN = 60_000;
const H = 60 * MIN;

const rows = (critical = false): StepRow[] =>
  scheduleFor({ createdAt: T0, critical }).map((s) => ({ ...s, sentAt: null, cancelled: false }));

const state = (steps: StepRow[], patch: Partial<RequestState> = {}): RequestState => ({
  status: 'pending', ticketClosed: false, flagOn: true, steps, consultantRemindersLastHour: 0, hourlyLimit: 6, ...patch,
});

/** Marks steps as sent at the given time. */
const sent = (steps: StepRow[], names: string[], at: number) => steps.map((s) => (names.includes(s.step) ? { ...s, sentAt: at } : s));

describe('assignment reminder schedule', () => {
  it('reminds after 2 h, 4 h and 24 h and ends the reply window at 24 h', () => {
    const s = scheduleFor({ createdAt: T0, critical: false });
    expect(s.map((x) => [x.step, (x.dueAt - T0) / MIN])).toEqual([
      ['request', 0], ['r1', 120], ['r2', 240], ['r3', 1440], ['expire', 1440],
    ]);
  });

  it('uses 10 / 20 / 30 minutes and a 30-minute window for Critical requests', () => {
    const s = scheduleFor({ createdAt: T0, critical: true });
    expect(s.map((x) => [x.step, (x.dueAt - T0) / MIN])).toEqual([
      ['request', 0], ['r1', 10], ['r2', 20], ['r3', 30], ['expire', 30],
    ]);
  });

  it('bid invitations use the bid deadline and skip reminders after it', () => {
    const deadline = T0 + 3 * H;
    expect(responseDeadline({ createdAt: T0, critical: false, bidInvite: true, bidDeadline: deadline })).toBe(deadline);
    const s = scheduleFor({ createdAt: T0, critical: false, bidInvite: true, bidDeadline: deadline });
    expect(s.map((x) => x.step)).toEqual(['request', 'r1', 'expire']);
    // a normal request ignores the bid deadline
    expect(responseDeadline({ createdAt: T0, critical: false, bidDeadline: deadline })).toBe(T0 + 24 * H);
  });

  it('reads admin timings and falls back to the defaults when the order breaks', () => {
    expect(readPolicyMinutes({ r1: 60, r2: 180, r3: 600, expire: 720 })).toMatchObject({ r1: 60, r2: 180, r3: 600, expire: 720 });
    expect(readPolicyMinutes({ r1: 500, r2: 100 })).toMatchObject({ r1: 120, r2: 240, r3: 1440, expire: 1440 });
    expect(readPolicyMinutes(null)).toEqual(POLICY_DEFAULTS);
  });
});

describe('assignment reminder due selection', () => {
  it('sends the first request message at once, then nothing until 2 h', () => {
    const steps = rows();
    expect(dueStep(state(steps), T0)).toEqual({ action: 'send', step: 'request', superseded: [] });
    const after = sent(steps, ['request'], T0);
    expect(dueStep(state(after), T0 + 119 * MIN)).toEqual({ action: 'none' });
    expect(dueStep(state(after), T0 + 2 * H)).toMatchObject({ action: 'send', step: 'r1' });
  });

  it('sends reminder 2 at 4 h and reminder 3 at 24 h', () => {
    let steps = sent(rows(), ['request', 'r1'], T0 + 2 * H);
    expect(dueStep(state(steps), T0 + 4 * H)).toMatchObject({ action: 'send', step: 'r2' });
    steps = sent(steps, ['r2'], T0 + 4 * H);
    expect(dueStep(state(steps), T0 + 23 * H)).toEqual({ action: 'none' });
    expect(dueStep(state(steps), T0 + 24 * H)).toMatchObject({ action: 'send', step: 'r3' });
  });

  it('sends only the latest due reminder after an outage', () => {
    const steps = sent(rows(), ['request'], T0);
    expect(dueStep(state(steps), T0 + 5 * H)).toEqual({ action: 'send', step: 'r2', superseded: ['r1'] });
  });

  it('stops every message the moment the consultant answers, the request is withdrawn or the ticket closes', () => {
    const steps = sent(rows(), ['request'], T0);
    for (const status of ['accepted', 'rejected', 'withdrawn', 'expired']) {
      expect(dueStep(state(steps, { status }), T0 + 2 * H)).toEqual({ action: 'stop' });
    }
    expect(dueStep(state(steps, { ticketClosed: true }), T0 + 2 * H)).toEqual({ action: 'stop' });
  });

  it('escalates to the client only after reminder 3 went out in an earlier run', () => {
    const before = sent(rows(), ['request', 'r1', 'r2'], T0 + 4 * H);
    // at 24 h reminder 3 goes first
    expect(dueStep(state(before), T0 + 24 * H)).toMatchObject({ action: 'send', step: 'r3' });
    const after = sent(before, ['r3'], T0 + 24 * H);
    // same run (same clock): still waiting
    expect(dueStep(state(after), T0 + 24 * H)).toEqual({ action: 'none' });
    // next run: "No response" goes to the client
    const next = dueStep(state(after), T0 + 24 * H + 5 * MIN);
    expect(next).toEqual({ action: 'send', step: 'expire', superseded: [] });
    expect(stepRecipient('expire')).toBe('client');
    expect(stepRecipient('r3')).toBe('consultant');
  });

  it('escalates Critical requests at 30 minutes', () => {
    const steps = sent(rows(true), ['request', 'r1', 'r2', 'r3'], T0 + 30 * MIN);
    expect(dueStep(state(steps), T0 + 29 * MIN)).toEqual({ action: 'none' });
    expect(dueStep(state(steps), T0 + 35 * MIN)).toMatchObject({ action: 'send', step: 'expire' });
  });

  it('holds reminders at the hourly limit and when the admin switch is off, but never the first request message', () => {
    const steps = rows();
    expect(dueStep(state(steps, { flagOn: false }), T0)).toMatchObject({ action: 'send', step: 'request' });
    const after = sent(steps, ['request'], T0);
    expect(dueStep(state(after, { flagOn: false }), T0 + 2 * H)).toEqual({ action: 'none' });
    expect(dueStep(state(after, { consultantRemindersLastHour: 6 }), T0 + 2 * H)).toEqual({ action: 'none' });
  });
});

describe('assignment request popup', () => {
  const req = { id: 'q1', status: 'pending', created_at: new Date(T0).toISOString(), response_due_at: new Date(T0 + 24 * H).toISOString(), reminders_sent: 0, extended_at: null };

  it('is shown once per request until acknowledged', () => {
    expect(nextPopup([req], new Set())?.id).toBe('q1');
    expect(nextPopup([req], new Set([popupKey(req)]))).toBeNull();
  });

  it('comes back after a reminder and after an extension', () => {
    const acked = new Set([popupKey(req)]);
    expect(nextPopup([{ ...req, reminders_sent: 1 }], acked)?.id).toBe('q1');
    expect(nextPopup([{ ...req, extended_at: new Date(T0).toISOString() }], acked)?.id).toBe('q1');
  });

  it('shows one request at a time, nearest deadline first, and never answered ones', () => {
    const later = { ...req, id: 'q2', response_due_at: new Date(T0 + 30 * H).toISOString() };
    const answered = { ...req, id: 'q3', status: 'accepted', response_due_at: new Date(T0 + H).toISOString() };
    expect(nextPopup([later, answered, req], new Set())?.id).toBe('q1');
  });
});

describe('assignment policy text', () => {
  it('matches the owner wording with the default timings', () => {
    expect(policyText()).toBe('Please accept or decline within 24 hours (30 minutes for Critical requests). We remind you after 2 hours, 4 hours and 1 day. If there is no reply the client is told and may choose another consultant; repeated non-response lowers your response rate and ranking.');
    expect(policyText(POLICY_DEFAULTS, 'ar')).toContain('خلال 24 ساعة (30 دقيقة للطلبات الحرجة)');
    expect(policyText(POLICY_DEFAULTS, 'ar')).toContain('بعد ساعتين و4 ساعات ويوم واحد');
  });

  it('shows the time left', () => {
    expect(timeLeftLabel(T0 + 200 * MIN, T0)).toBe('3 h 20 min left');
    expect(timeLeftLabel(T0 + 12 * MIN, T0)).toBe('12 min left');
    expect(timeLeftLabel(T0, T0)).toBe('Time is up');
  });

  it('only rates consultants with at least 3 requests', () => {
    expect(responseRate(1, 1)).toBeNull();
    expect(responseRate(3, 1)).toBe(0.75);
  });
});

import { parseRunBody, runResponse, sweepGuarded } from '../../supabase/functions/_shared/assignmentPolicy';

describe('assignment reminder function entry', () => {
  it('ignores a sweep within 4 minutes of the previous one, allows it after', () => {
    expect(sweepGuarded(T0 - 3 * MIN, T0)).toBe(true);
    expect(sweepGuarded(T0 - 4 * MIN, T0)).toBe(false);
    expect(sweepGuarded(null, T0)).toBe(false);
  });

  it('narrows a run only to a well-formed request id', () => {
    expect(parseRunBody({ request_id: '0f8fad5b-d9cb-469f-a165-70867728950e' }).requestId).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(parseRunBody({ request_id: "x' or 1=1" }).requestId).toBeNull();
    expect(parseRunBody(null).requestId).toBeNull();
  });

  it('returns counts only', () => {
    expect(runResponse({ skipped: false, claimed: 3, ok: true })).toEqual({ skipped: false, claimed: 3, ok: true });
  });
});
