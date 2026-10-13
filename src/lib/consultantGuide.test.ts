import { describe, expect, it } from 'vitest';
import { CONSULTANT_GUIDE, GUIDE_STEP_ORDER, fieldHints, minutesLeft, totalGuideMinutes } from './consultantGuide';

const ALLOWED = ['Matching', 'Trust score', 'Payouts', 'Bids'];

describe('consultant guide', () => {
  it('covers the nine onboarding steps in order', () => {
    expect(GUIDE_STEP_ORDER).toEqual(['import', 'profile', 'skills', 'certifications', 'work', 'education', 'projects', 'availability', 'interview']);
  });

  it.each(GUIDE_STEP_ORDER)('%s has every field', (key) => {
    const s = CONSULTANT_GUIDE[key];
    expect(s.key).toBe(key);
    expect(s.title.length).toBeGreaterThan(2);
    expect(s.minutes).toBeGreaterThan(0);
    expect(s.why.length).toBeGreaterThan(10);
    expect(s.tips.length).toBeGreaterThanOrEqual(3);
    expect(s.tips.length).toBeLessThanOrEqual(4);
    expect(s.mistakes).toHaveLength(2);
    expect(s.clientsSee.length).toBeGreaterThan(10);
    expect(s.affects.length).toBeGreaterThan(0);
    expect(s.affects.every((a) => ALLOWED.includes(a))).toBe(true);
  });

  it('contains no e-mail address or link', () => {
    const all = JSON.stringify({ CONSULTANT_GUIDE, fieldHints });
    expect(all).not.toContain('@');
    expect(all).not.toContain('http');
  });

  it('adds up the minutes', () => {
    expect(totalGuideMinutes()).toBe(minutesLeft(0));
    expect(minutesLeft(8)).toBe(CONSULTANT_GUIDE.interview.minutes);
  });
});
