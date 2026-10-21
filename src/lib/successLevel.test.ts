import { describe, expect, it } from 'vitest';
import {
  compareSuccessLevel, compareSuccessRate, meetsSuccessLevel, meetsSuccessRate, parseSuccessSettings, successCompactText, successLabel,
  successLevelOf, successLines, successPct, successPillText, successProgress, successProgressText, successSettingsProblems, successView,
  SUCCESS_DEFAULTS, type SuccessCounts,
} from './successLevel';

const counts = (total: number, solved: number, total12 = total, solved12 = solved): SuccessCounts => ({
  requests_total: total, solved, not_solved: total - solved, requests_12m: total12, solved_12m: solved12,
});

describe('Success level boundaries (owner thresholds 60 / 80 / 85 / 100)', () => {
  it.each([
    [59, 'none'], [60, 'bronze'], [79, 'bronze'], [80, 'silver'], [84, 'silver'], [85, 'gold'], [99, 'gold'], [100, 'platinum'],
  ] as const)('%i of 100 solved is %s', (solved, level) => {
    expect(successLevelOf(100, solved)).toBe(level);
  });
  it('uses whole-number maths: 999 of 1000 stays Gold and reads 99 %', () => {
    expect(successLevelOf(1000, 999)).toBe('gold');
    expect(successPct(1000, 999)).toBe(99);
    expect(successView(true, counts(1000, 999)).pct).toBe(99);
  });
  it('Platinum only when every request was solved', () => {
    expect(successLevelOf(5, 5)).toBe('platinum');
    expect(successLevelOf(200, 199)).toBe('gold');
  });
});

describe('minimum sample (default 5)', () => {
  it('shows New and the plain counts below the minimum, never a level or a percentage', () => {
    const v = successView(true, counts(4, 4));
    expect(v.state).toBe('new');
    expect(v.level).toBeNull();
    expect(v.pct).toBeNull();
    expect(successPillText(v)).toBe('4 requests · 4 solved · New');
    expect(successCompactText(v)).toBe('New');
  });
  it('follows the admin setting', () => {
    const s = parseSuccessSettings({ ...SUCCESS_DEFAULTS, min_requests: 8 });
    expect(successView(true, counts(7, 7), s).state).toBe('new');
    expect(successView(true, counts(8, 8), s).level).toBe('platinum');
  });
  it('below Bronze: counts only, no level and no percentage', () => {
    const v = successView(true, counts(12, 6));
    expect(v.state).toBe('none');
    expect(v.pct).toBeNull();
    expect(successPillText(v)).toBe('12 requests · 6 solved');
    expect(successCompactText(v)).toBe('6/12');
  });
  it('shows nothing at all while switched off or unknown', () => {
    expect(successView(false, counts(42, 38)).state).toBe('hidden');
    expect(successView(true, null).state).toBe('hidden');
    expect(successPillText(successView(true, undefined))).toBeNull();
    expect(successLines(successView(false, counts(42, 38)))).toEqual([]);
  });
});

describe('settings', () => {
  it('falls back to the defaults when the order is broken', () => {
    expect(parseSuccessSettings({ bronze: 90, silver: 80, gold: 85, platinum: 100, min_requests: 3 })).toEqual({ ...SUCCESS_DEFAULTS, min_requests: 3 });
    expect(parseSuccessSettings(null)).toEqual(SUCCESS_DEFAULTS);
    expect(successSettingsProblems({ ...SUCCESS_DEFAULTS, gold: 79 })).toContain('order');
    expect(successSettingsProblems(SUCCESS_DEFAULTS)).toEqual([]);
  });
});

describe('texts (English and Arabic)', () => {
  const gold = successView(true, counts(42, 38, 20, 18));
  it('pill: "42 requests · 38 solved · 90 % (Gold)"', () => {
    expect(successPillText(gold)).toBe('42 requests · 38 solved · 90 % (Gold)');
    expect(successPillText(gold, 'ar')).toBe('الطلبات: 42 · المحلولة: 38 · 90 ٪ (ذهبي)');
    expect(successCompactText(gold)).toBe('90 %');
    expect(successCompactText(gold, 'ar')).toBe('90 ٪');
  });
  it('tooltip line with the last 12 months and the minimum-sample note', () => {
    expect(successLines(gold)).toEqual([
      'Success level: Gold - 38 of 42 requests solved (90 %) - last 12 months 90 %',
      'A Success level shows after 5 finished requests.',
    ]);
    expect(successLines(gold, 'ar')[0]).toBe('مستوى النجاح: ذهبي - تم حل 38 من 42 طلبًا (90 ٪) - آخر 12 شهرًا 90 ٪');
  });
  it('last 12 months below the minimum shows counts, not a percentage', () => {
    const v = successView(true, counts(42, 38, 3, 3));
    expect(successLines(v)[0]).toBe('Success level: Gold - 38 of 42 requests solved (90 %) - last 12 months 3 of 3 solved');
  });
  it('never calls the level just "Gold"', () => {
    expect(successLabel('gold')).toBe('Success: Gold');
    expect(successLabel('platinum', 'ar')).toBe('النجاح: بلاتيني');
  });
  it('New with no finished requests', () => {
    expect(successLines(successView(true, counts(0, 0)))[0]).toBe('Success: New - no finished requests yet');
    expect(successPillText(successView(true, counts(0, 0)))).toBe('New');
  });
});

describe('progress to the next level (honest)', () => {
  it('counts solved requests in a row: 38/42 needs 2 for... Gold already; Platinum impossible once a request failed', () => {
    expect(successProgress(42, 38)).toEqual({ kind: 'unreachable', level: 'platinum' });
    expect(successProgressText(successProgress(42, 38))).toBe('Success: Platinum needs every request solved');
  });
  it('smallest k with (s + k) / (n + k) at the threshold', () => {
    // 15/20 = 75 % Bronze → Silver 80 % needs (16+..): (15+k)/(20+k) >= 0.8 → k = 5
    expect(successProgress(20, 15)).toEqual({ kind: 'next', level: 'silver', solved: 5 });
    expect(successProgressText(successProgress(20, 15))).toBe('5 more solved requests in a row to reach Success: Silver');
    // 8/10 = 80 % Silver → Gold 85 %: (8+k)/(10+k) >= 0.85 → k = 4 (12/14 = 85.7 %)
    expect(successProgress(10, 8)).toEqual({ kind: 'next', level: 'gold', solved: 4 });
    expect(successLevelOf(14, 12)).toBe('gold');
    expect(successLevelOf(13, 11)).toBe('silver');
    // 5/10 = 50 % → Bronze 60 %: k = 3 (8/13 = 61.5 %)
    expect(successProgress(10, 5)).toEqual({ kind: 'next', level: 'bronze', solved: 3 });
  });
  it('below the minimum: how many finished requests remain', () => {
    expect(successProgressText(successProgress(3, 3))).toBe('2 more finished requests until a Success level shows');
    expect(successProgressText(successProgress(4, 1))).toBe('1 more finished request until a Success level shows');
  });
  it('Platinum is the top', () => {
    expect(successProgressText(successProgress(6, 6))).toBe('Highest Success level reached');
  });
});

describe('directory sort and filter helpers', () => {
  const v = (t: number, s: number) => successView(true, counts(t, s));
  const plat = v(10, 10), gold = v(20, 18), gold2 = v(40, 36), silver = v(10, 8), none = v(10, 3), fresh = v(2, 2);
  it('sorts by level, then rate, then more requests; New and hidden last', () => {
    const list = [fresh, silver, null, gold, plat, none, gold2];
    const sorted = [...list].sort(compareSuccessLevel);
    expect(sorted.slice(0, 4)).toEqual([plat, gold2, gold, silver]);
    expect(sorted[sorted.length - 1]).toBeNull();
  });
  it('sorts by rate (only where a level is shown)', () => {
    const sorted = [silver, gold, none, plat].sort(compareSuccessRate);
    expect(sorted).toEqual([plat, gold, silver, none]);
  });
  it('filters by minimum level and minimum rate', () => {
    expect(meetsSuccessLevel(gold, 'silver')).toBe(true);
    expect(meetsSuccessLevel(silver, 'gold')).toBe(false);
    expect(meetsSuccessLevel(fresh, 'bronze')).toBe(false);
    expect(meetsSuccessLevel(none, '')).toBe(true);
    expect(meetsSuccessRate(gold, 90)).toBe(true);
    expect(meetsSuccessRate(silver, 90)).toBe(false);
    expect(meetsSuccessRate(none, 0)).toBe(true);
  });
});
