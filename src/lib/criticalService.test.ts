import { describe, it, expect } from 'vitest';
import {
  NO_CRITICAL_CHOICE, alertKey, choiceSummary, criticalColumns, describeEvent, effectiveRate, extendedDeadline, extensionProblem, extraMinuteOptions,
  formatCountdown, formatPercent, formatWindow, isOpenAlert, msLeft, openAlerts, percentOptions, readTerms, surchargeApplies, termsProblem, windowOptions,
  type CriticalAlert, type CriticalView,
} from './criticalService';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const alert = (over: Partial<CriticalAlert> = {}): CriticalAlert => ({
  ticket_id: 't1', title: 'Posting fails', areas: ['SAP FI/CO'], due_at: at(20), minutes: 30, surcharge_percent: 30, status: 'waiting',
  extensions: 0, alerted_at: at(-10), last_alerted_at: at(-10), dismissed_at: null, replied_at: null, ...over,
});

const view = (over: Partial<CriticalView> = {}): CriticalView => ({
  critical_response: true, status: 'waiting', due_at: at(20), minutes: 30, surcharge_percent: 30, extensions: 0, max_minutes: 240,
  max_surcharge_percent: 100, can_extend: true, alerted_count: 5, reply_count: 1, in_time_consultants: ['c1'], ...over,
});

describe('readTerms', () => {
  it('reads the terms and keeps numbers that arrive as text', () => {
    expect(readTerms({ enabled: true, minutes: 30, surcharge_percent: '30.5', max_minutes: 240, max_surcharge_percent: 100 })).toEqual({
      enabled: true, minutes: 30, surcharge_percent: 30.5, max_minutes: 240, max_surcharge_percent: 100,
    });
  });

  it('is switched off with the standard numbers when the answer is empty or broken', () => {
    expect(readTerms(null)).toEqual({ enabled: false, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 });
    expect(readTerms({ enabled: 'yes', minutes: 'x' }).enabled).toBe(false);
    expect(readTerms({ enabled: true, minutes: 'x' }).minutes).toBe(30);
  });
});

describe('effectiveRate', () => {
  it('adds the surcharge and rounds to two decimals like the database', () => {
    expect(effectiveRate(100, 30)).toBe(130);
    expect(effectiveRate(87.5, 30)).toBe(113.75);
    expect(effectiveRate(99.99, 30)).toBe(129.99);
    expect(effectiveRate(120, 0)).toBe(120);
  });
});

describe('texts', () => {
  it('formats percentages, windows and countdowns', () => {
    expect(formatPercent(30)).toBe('30%');
    expect(formatPercent('12.5')).toBe('12.5%');
    expect(formatWindow(30)).toBe('30 minutes');
    expect(formatWindow(1)).toBe('1 minute');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(29 * 60_000 + 1)).toBe('29:01');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
    expect(formatCountdown(-5000)).toBe('0:00');
  });

  it('counts the time left and never goes below zero', () => {
    expect(msLeft(at(5), NOW)).toBe(5 * 60_000);
    expect(msLeft(at(-5), NOW)).toBe(0);
    expect(msLeft(null, NOW)).toBe(0);
    expect(msLeft('not a date', NOW)).toBe(0);
  });
});

describe('the choices of a client', () => {
  it('offers the standard window and the limit, with steps between', () => {
    expect(windowOptions(30, 240)).toEqual([30, 45, 60, 90, 120, 180, 240]);
    expect(windowOptions(60, 60)).toEqual([60]);
  });

  it('offers the standard surcharge, steps of ten and the limit', () => {
    expect(percentOptions(30, 100)).toEqual([30, 40, 50, 60, 70, 80, 90, 100]);
    expect(percentOptions(35, 60)).toEqual([35, 40, 50, 60]);
    expect(percentOptions(30, 30)).toEqual([30]);
  });

  it('offers steps of extra minutes up to the limit', () => {
    expect(extraMinuteOptions(240)).toEqual([5, 10, 15, 30, 60, 120, 240]);
    expect(extraMinuteOptions(20)).toEqual([5, 10, 15]);
    expect(extraMinuteOptions(3)).toEqual([]);
  });

  it('sends nothing for an ordinary ticket and the chosen numbers for a critical one', () => {
    expect(criticalColumns('critical', NO_CRITICAL_CHOICE)).toEqual({});
    expect(criticalColumns('high', { on: true, minutes: 60, percent: 40, agreed: true })).toEqual({});
    expect(criticalColumns('critical', { on: true, minutes: null, percent: null, agreed: true })).toEqual({ critical_response: true });
    expect(criticalColumns('critical', { on: true, minutes: 60, percent: 40, agreed: true })).toEqual({
      critical_response: true, critical_minutes: 60, critical_surcharge_percent: 40,
    });
    expect(criticalColumns('critical', { on: true, minutes: null, percent: 0, agreed: true })).toEqual({ critical_response: true, critical_surcharge_percent: 0 });
  });

  it('summarises the choice with the standard terms as the fallback', () => {
    const terms = readTerms({ enabled: true, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 });
    expect(choiceSummary({ on: true, minutes: null, percent: null, agreed: true }, terms)).toBe('Reply within 30 minutes, +30% for the consultant');
    expect(choiceSummary({ on: true, minutes: 60, percent: 45, agreed: true }, terms)).toBe('Reply within 60 minutes, +45% for the consultant');
  });
});

describe('the alerts of a consultant', () => {
  it('keeps only the alerts that can still be answered, the one that ends first on top', () => {
    const list = [
      alert({ ticket_id: 'late', due_at: at(25) }),
      alert({ ticket_id: 'soon', due_at: at(5) }),
      alert({ ticket_id: 'gone', due_at: at(-1) }),
      alert({ ticket_id: 'replied', replied_at: at(-2) }),
      alert({ ticket_id: 'dismissed', dismissed_at: at(-3) }),
      alert({ ticket_id: 'missed', status: 'missed' }),
      alert({ ticket_id: 'answered', status: 'answered' }),
    ];
    expect(openAlerts(list, NOW).map((a) => a.ticket_id)).toEqual(['soon', 'late']);
    expect(openAlerts(null, NOW)).toEqual([]);
    expect(isOpenAlert(alert(), NOW)).toBe(true);
    expect(isOpenAlert(alert({ due_at: at(0) }), NOW)).toBe(false);
  });

  it('gives a reminder or an update a new key, so that the alarm opens again', () => {
    const first = alert({ last_alerted_at: at(-10) });
    const reminder = alert({ last_alerted_at: at(0) });
    expect(alertKey(first)).not.toBe(alertKey(reminder));
    expect(alertKey(first)).toBe(alertKey(alert({ last_alerted_at: at(-10) })));
  });
});

describe('the proposals of a critical ticket', () => {
  it('applies the surcharge only to a consultant who replied in time', () => {
    expect(surchargeApplies(view(), 'c1')).toBe(true);
    expect(surchargeApplies(view(), 'c2')).toBe(false);
    expect(surchargeApplies(view({ critical_response: false }), 'c1')).toBe(false);
    expect(surchargeApplies(null, 'c1')).toBe(false);
    expect(surchargeApplies(view(), null)).toBe(false);
  });
});

describe('changing a request', () => {
  it('counts the new deadline from the later of now and the current deadline', () => {
    expect(extendedDeadline(at(20), 30, NOW)).toBe(at(50));
    expect(extendedDeadline(at(-10), 30, NOW)).toBe(at(30));
    expect(extendedDeadline(at(20), 0, NOW)).toBe(at(20));
    expect(extendedDeadline(null, 0, NOW)).toBeNull();
  });

  it('accepts more time, a higher surcharge, or both', () => {
    expect(extensionProblem(view(), 30, 30, NOW)).toBeNull();
    expect(extensionProblem(view(), 0, 50, NOW)).toBeNull();
    expect(extensionProblem(view(), 15, 60, NOW)).toBeNull();
    expect(extensionProblem(view({ due_at: at(-5), status: 'missed' }), 30, 30, NOW)).toBeNull();
  });

  it('says why a change is refused', () => {
    expect(extensionProblem(view(), 0, 30, NOW)).toBe('Add minutes or raise the surcharge');
    expect(extensionProblem(view(), 10, 20, NOW)).toBe('The surcharge can only be raised');
    expect(extensionProblem(view(), 10, 120, NOW)).toBe('The surcharge can be 100% at most');
    expect(extensionProblem(view(), 300, 30, NOW)).toBe('You can add 240 minutes at most at a time');
    expect(extensionProblem(view({ extensions: 5 }), 10, 30, NOW)).toBe('This request was already extended 5 times');
    expect(extensionProblem(view({ due_at: at(-5) }), 0, 50, NOW)).toBe('The reply window has passed: add minutes as well');
  });

  it('describes the history of a request', () => {
    const base = { at: at(-5), old_due_at: at(10), new_due_at: at(40), old_percent: 30, new_percent: 50 };
    expect(describeEvent({ ...base, kind: 'boosted' })).toBe('Surcharge raised to 50%');
    expect(describeEvent({ ...base, kind: 'extended' })).toMatch(/^Time extended until /);
    expect(describeEvent({ ...base, kind: 'extended_and_boosted' })).toMatch(/^Time extended until .* and surcharge raised to 50%$/);
  });
});

describe('the settings of the administrator', () => {
  const ok = { enabled: true, minutes: 30, surcharge_percent: 30, max_minutes: 240, max_surcharge_percent: 100 };

  it('accepts the standard settings and some changes', () => {
    expect(termsProblem(ok)).toBeNull();
    expect(termsProblem({ ...ok, minutes: 5, surcharge_percent: 0, max_minutes: 720, max_surcharge_percent: 300 })).toBeNull();
  });

  it('refuses numbers the database would refuse', () => {
    expect(termsProblem({ ...ok, minutes: 4 })).toBe('The reply window must be between 5 and 720 minutes');
    expect(termsProblem({ ...ok, minutes: 30.5 })).toBe('Minutes must be whole numbers');
    expect(termsProblem({ ...ok, surcharge_percent: 301, max_surcharge_percent: 301 })).toBe('The surcharge must be between 0 and 300 percent');
    expect(termsProblem({ ...ok, max_minutes: 20 })).toMatch(/^The longest window/);
    expect(termsProblem({ ...ok, max_surcharge_percent: 20 })).toMatch(/^The highest surcharge/);
    expect(termsProblem({ ...ok, minutes: Number.NaN })).toBe('Fill in every number');
  });
});
