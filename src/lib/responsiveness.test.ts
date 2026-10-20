import { describe, expect, it } from 'vitest';
import {
  availabilityExclusion, blendedRating, canDispute, computeMetrics, levelFor, noticeForNoResponse, percentileCont,
  publicLevel, readRespSettings, RESP_DEFAULTS, respRunGuarded, respSettingsProblems, starsFor, voidEvent, type RespEvent,
} from '../../supabase/functions/_shared/responsiveness';
import { rankConsultants, type MatchConsultant, type MatchTicket } from '../../supabase/functions/_shared/ticketMatch';
import { noticeCopy } from '../../supabase/functions/_shared/responsivenessCopy';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A request answered after `mins` minutes (null = no response), received `daysAgo` days before NOW. */
const ev = (daysAgo: number, mins: number | null, extra: Partial<RespEvent> = {}): RespEvent => {
  const at = NOW - daysAgo * DAY;
  return {
    kind: 'request', received_at: iso(at), counted: true,
    outcome: mins == null ? 'no_response' : 'responded',
    responded_at: mins == null ? null : iso(at + mins * 60_000),
    ...extra,
  };
};

describe('fairness: only requests that arrive while the consultant is available count', () => {
  // Tuesday 20 Oct 2026, 12:00 UTC = 15:00 in Riyadh.
  const tuesday3pmRiyadh = Date.parse('2026-10-20T12:00:00Z');
  const base = { slots: [], periods: [], timezone: 'Asia/Riyadh' };

  it('inside a weekly slot it counts, outside it does not', () => {
    const slots = [{ day_of_week: 2, specific_date: null, start_time: '09:00:00', end_time: '17:00:00' }];
    expect(availabilityExclusion({ ...base, slots, at: tuesday3pmRiyadh })).toBeNull();
    expect(availabilityExclusion({ ...base, slots, at: tuesday3pmRiyadh + 3 * 3600_000 })).toBe('outside_hours'); // 18:00
    expect(availabilityExclusion({ ...base, slots, at: tuesday3pmRiyadh + DAY })).toBe('outside_hours'); // Wednesday
  });

  it('uses the consultant time zone', () => {
    // 12:00 UTC is 15:00 in Riyadh and 14:00 in Berlin (summer time until 25 Oct).
    const slots = [{ day_of_week: 2, specific_date: null, start_time: '09:00', end_time: '15:00' }];
    expect(availabilityExclusion({ ...base, slots, at: tuesday3pmRiyadh, timezone: 'Europe/Berlin' })).toBeNull();
    expect(availabilityExclusion({ ...base, slots, at: tuesday3pmRiyadh, timezone: 'Asia/Riyadh' })).toBe('outside_hours');
  });

  it('a one-date slot counts on that date', () => {
    const slots = [{ day_of_week: null, specific_date: '2026-10-20', start_time: '14:00', end_time: '16:00' }];
    expect(availabilityExclusion({ ...base, slots, at: tuesday3pmRiyadh })).toBeNull();
  });

  it('a period marked unavailable, busy status and full capacity are not counted', () => {
    const periods = [{ starts_at: '2026-10-19T00:00:00Z', ends_at: '2026-10-25T00:00:00Z' }];
    expect(availabilityExclusion({ ...base, periods, at: tuesday3pmRiyadh })).toBe('unavailable_period');
    expect(availabilityExclusion({ ...base, at: tuesday3pmRiyadh, status: 'busy' })).toBe('busy');
    expect(availabilityExclusion({ ...base, at: tuesday3pmRiyadh, maxActive: 2, activeTickets: 2 })).toBe('capacity');
    expect(availabilityExclusion({ ...base, at: tuesday3pmRiyadh, maxActive: 3, activeTickets: 2 })).toBeNull();
  });

  it('without slots: working week (default Sunday to Thursday) 08:00-20:00', () => {
    const friday = Date.parse('2026-10-23T09:00:00Z'); // Friday 12:00 Riyadh
    expect(availabilityExclusion({ ...base, at: friday })).toBe('outside_hours');
    expect(availabilityExclusion({ ...base, at: friday, workingWeek: 'Monday to Friday' })).toBeNull();
    expect(availabilityExclusion({ ...base, at: Date.parse('2026-10-20T18:30:00Z') })).toBe('outside_hours'); // 21:30
  });

  it('requests outside availability leave both the numerator and the denominator', () => {
    const events = [ev(1, 10), ev(2, null, { counted: false }), ev(3, null, { counted: false })];
    const m = computeMetrics(events, NOW, 30);
    expect(m).toMatchObject({ received: 3, counted: 1, not_counted: 2, responded: 1, no_response: 0, rate: 100 });
  });
});

describe('metrics', () => {
  it('median, average and p90 follow percentile_cont; buckets are exclusive bands', () => {
    const events = [ev(1, 5), ev(1, 30), ev(1, 90), ev(1, 300), ev(1, 2000), ev(1, null)];
    const m = computeMetrics(events, NOW, 30);
    expect(m.median).toBe(90);
    expect(m.avg).toBe(485);
    expect(m.p90).toBe(Math.round(percentileCont([5, 30, 90, 300, 2000], 0.9) as number));
    expect(m.buckets).toEqual({ lt15: 1, lt60: 1, lt240: 1, lt1440: 1, later: 1 });
    expect(m.rate).toBe(83);
  });

  it('a decline in time counts as a response; withdrawn requests are left out', () => {
    const m = computeMetrics([ev(1, 20), ev(1, null, { outcome: 'withdrawn' })], NOW, 30);
    expect(m).toMatchObject({ received: 1, counted: 1, rate: 100 });
  });

  it('rolling windows: 30 days, 90 days and all time', () => {
    const events = [ev(5, 10), ev(31, null), ev(91, null)];
    expect(computeMetrics(events, NOW, 30)).toMatchObject({ counted: 1, no_response: 0 });
    expect(computeMetrics(events, NOW, 90)).toMatchObject({ counted: 2, no_response: 1 });
    expect(computeMetrics(events, NOW, null)).toMatchObject({ counted: 3, no_response: 2 });
  });

  it('Critical and chat are separate splits', () => {
    const events = [ev(1, 5, { is_critical: true }), ev(1, 50, { kind: 'critical' }), ev(1, 100, { kind: 'chat' })];
    expect(computeMetrics(events, NOW, 30, 'main').counted).toBe(1);
    expect(computeMetrics(events, NOW, 30, 'critical').counted).toBe(2);
    expect(computeMetrics(events, NOW, 30, 'chat').median).toBe(100);
  });
});

describe('levels and minimum sample', () => {
  it('below 5 counted requests the level is New, from 5 it is calculated', () => {
    expect(levelFor({ counted: 4, rate: 100, median: 10 })).toBe('new');
    expect(levelFor({ counted: 5, rate: 100, median: 10 })).toBe('excellent');
    expect(publicLevel('excellent', { counted: 4, rate: 100 }, 0)).toBe('new');
  });

  it('Excellent needs median under 1 h and rate at least 90 %', () => {
    expect(levelFor({ counted: 10, rate: 90, median: 59 })).toBe('excellent');
    expect(levelFor({ counted: 10, rate: 89, median: 59 })).toBe('good');
    expect(levelFor({ counted: 10, rate: 95, median: 60 })).toBe('good');
    expect(levelFor({ counted: 10, rate: 70, median: 300 })).toBe('fair');
    expect(levelFor({ counted: 10, rate: 50, median: 30 })).toBe('needs_improvement');
  });

  it('stars from the level', () => {
    expect([starsFor('excellent', 95), starsFor('good', 85), starsFor('fair', 70), starsFor('needs_improvement', 50), starsFor('needs_improvement', 20), starsFor('new', null)])
      .toEqual([5, 4, 3, 2, 1, null]);
  });
});

describe('warnings 1 of 2, 2 of 2, then the indicator', () => {
  it('counted no-responses in 30 days give warning 1, warning 2, then the badge', () => {
    expect(noticeForNoResponse(1)).toBe('warning_1');
    expect(noticeForNoResponse(2)).toBe('warning_2');
    expect(noticeForNoResponse(3)).toBe('badge_visible');
    expect(noticeForNoResponse(4)).toBe('counted');
  });

  it('the badge appears from the 3rd no-response in 30 days, never before', () => {
    const m90 = { counted: 10, rate: 80 };
    expect(publicLevel('good', m90, 2)).toBe('good');
    expect(publicLevel('good', m90, 3)).toBe('needs_improvement');
  });

  it('a rate below the threshold (60 %) also shows it; otherwise it never drops below Fair', () => {
    expect(publicLevel('needs_improvement', { counted: 10, rate: 59 }, 0)).toBe('needs_improvement');
    expect(publicLevel('needs_improvement', { counted: 10, rate: 70 }, 0)).toBe('fair');
  });

  it('the notice is a polite "friendly notice" with its number and the consequence, never a warning', () => {
    const c = noticeCopy({ lang: 'en', kind: 'warning_1', ticketTitle: 'FB50', warningsTotal: 2 });
    expect(c.title).toBe('Friendly notice 1 of 2: a request was not answered in time');
    expect(c.body).toContain('a Responsiveness indicator may appear on your card and your ranking may be affected');
    const ar = noticeCopy({ lang: 'ar', kind: 'warning_2', ticketTitle: 'FB50', warningsTotal: 2 });
    expect(ar.title).toBe('إشعار ودي 2 من 2: طلب لم يُرد عليه في الوقت');
    for (const kind of ['warning_1', 'warning_2', 'badge_visible', 'counted', 'not_counted', 'dispute_rejected']) {
      for (const lang of ['en', 'ar'] as const) {
        const x = noticeCopy({ lang, kind, ticketTitle: 'FB50', warningsTotal: 2 });
        expect(`${x.title} ${x.body}`).not.toMatch(/warning|تحذير/i);
      }
    }
    expect(noticeCopy({ lang: 'en', kind: 'not_counted', ticketTitle: 'FB50' }).body).toContain('outside your availability');
  });
});

describe('blended overall rating (85 % client reviews, 15 % responsiveness)', () => {
  it('blends after the minimum sample while public', () => {
    const r = blendedRating({ clientRating: 4.6, reviewCount: 12, stars: 4, level: 'good', publicOn: true });
    expect(r).toMatchObject({ overall: 4.51, client: 4.6, responsiveness: 4, clientWeight: 85, responsivenessWeight: 15, applied: true });
  });

  it('client stars stay unchanged when private, New, or the weight is 0', () => {
    expect(blendedRating({ clientRating: 4.6, reviewCount: 12, stars: 4, level: 'good', publicOn: false }).overall).toBe(4.6);
    expect(blendedRating({ clientRating: 4.6, reviewCount: 12, stars: null, level: 'new', publicOn: true }).overall).toBe(4.6);
    expect(blendedRating({ clientRating: 4.6, reviewCount: 12, stars: 4, level: 'good', publicOn: true, settings: { review_weight: 0 } }).overall).toBe(4.6);
  });

  it('responsiveness alone never makes a rating', () => {
    expect(blendedRating({ clientRating: 0, reviewCount: 0, stars: 5, level: 'excellent', publicOn: true }).overall).toBeNull();
  });
});

describe('disputes', () => {
  const missed = { kind: 'request' as const, outcome: 'no_response' as const, counted: true, received_at: iso(NOW - 3 * DAY), resolved_at: iso(NOW - 2 * DAY) };

  it('a counted no-response can be disputed once within 7 days', () => {
    expect(canDispute(missed, NOW)).toBe(true);
    expect(canDispute({ ...missed, resolved_at: iso(NOW - 8 * DAY) }, NOW)).toBe(false);
    expect(canDispute({ ...missed, dispute_status: 'pending' }, NOW)).toBe(false);
    expect(canDispute({ ...missed, counted: false }, NOW)).toBe(false);
    expect(canDispute({ ...missed, kind: 'chat' }, NOW)).toBe(false);
  });

  it('a voided no-response leaves the statistics', () => {
    const events = [ev(1, 10), ev(2, 10), ev(3, null)];
    expect(computeMetrics(events, NOW, 30).rate).toBe(67);
    const after = [events[0], events[1], voidEvent(events[2])];
    expect(computeMetrics(after, NOW, 30)).toMatchObject({ counted: 2, no_response: 0, rate: 100, not_counted: 1 });
  });
});

describe('settings and run guard', () => {
  it('owner defaults: 5 sample, 60 %, 2 warnings, 15 % weight, 7 dispute days', () => {
    expect(RESP_DEFAULTS).toMatchObject({ min_sample: 5, rate_threshold: 60, warnings: 2, review_weight: 15, dispute_days: 7 });
    expect(respSettingsProblems(RESP_DEFAULTS)).toEqual([]);
    expect(readRespSettings({ min_sample: 0, warnings: '3', good_median: 30 })).toMatchObject({ min_sample: 5, warnings: 3, good_median: 240 });
  });

  it('repeat calls within 8 minutes are ignored', () => {
    expect(respRunGuarded(NOW - 7 * 60_000, NOW)).toBe(true);
    expect(respRunGuarded(NOW - 9 * 60_000, NOW)).toBe(false);
    expect(respRunGuarded(null, NOW)).toBe(false);
  });
});

describe('ranking weight', () => {
  const base: Omit<MatchConsultant, 'id'> = {
    verification_status: 'verified', active: true, languages: ['en'], availability_status: 'available',
    skills: [{ module: 'SAP FI', years: 8 }], rating: 4.5, total_reviews: 10, response_time_minutes: 30, completion_percent: 80,
  };
  const ticket = { title: 'FB50 posting error', description: 'SAP FI posting fails', sap_module: 'FI', preferred_language: 'en' } as MatchTicket;

  it('left out while private: scores and confidence do not change', () => {
    const out = rankConsultants(ticket, [{ ...base, id: 'a' }]);
    expect(out.ranked[0].breakdown.some((b) => b.key === 'responsiveness')).toBe(false);
  });

  it('when public, Needs improvement ranks below Excellent', () => {
    const out = rankConsultants(ticket, [
      { ...base, id: 'slow', responsiveness_level: 'needs_improvement' },
      { ...base, id: 'fast', responsiveness_level: 'excellent' },
    ]);
    expect(out.ranked.map((r) => r.consultant_id)).toEqual(['fast', 'slow']);
  });
});
