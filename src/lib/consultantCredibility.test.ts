import { describe, expect, it } from 'vitest';
import { credibility, credibilityTone, starFills } from './consultantCredibility';

describe('credibility score', () => {
  it('gives only the 5 profile points to an empty profile', () => {
    const r = credibility({});
    expect(r.total).toBe(5);
    expect(r.label).toBe('Building Profile');
    expect(r.hasInterview).toBe(false);
    expect(r.segments.map((s) => s.value)).toEqual([0, 0, 0, 0, 5]);
  });

  it('adds certifications, experience, reviews and the interview', () => {
    const r = credibility({ certifications: [1, 2], skills: [{ years: 6 }, { years: 4 }], rating: 4.2, aiScore: 80 });
    // 20 + 10 + 21 + 16 + 5
    expect(r.total).toBe(72);
    expect(r.label).toBe('Credible');
    expect(r.interviewContrib).toBe(16);
  });

  it('caps every part and the total', () => {
    const r = credibility({ certifications: new Array(9).fill(0), skills: [{ years: 90 }], rating: 5, aiScore: 100 });
    expect(r.segments.map((s) => s.value)).toEqual([25, 25, 25, 20, 5]);
    expect(r.total).toBe(100);
    expect(r.label).toBe('Highly Credible');
  });

  it('ignores bad numbers', () => {
    const r = credibility({ rating: Number.NaN, aiScore: -5, skills: [{ years: null }, {}] });
    expect(r.total).toBe(5);
    expect(r.hasInterview).toBe(false);
  });

  it('names the tone of the ring', () => {
    expect(credibilityTone(95)).toBe('high');
    expect(credibilityTone(60)).toBe('good');
    expect(credibilityTone(45)).toBe('fair');
    expect(credibilityTone(5)).toBe('low');
  });
});

describe('star fills', () => {
  it('fills each of the five stars', () => {
    expect(starFills(4.6)).toEqual([1, 1, 1, 1, 0.6]);
    expect(starFills(0)).toEqual([0, 0, 0, 0, 0]);
    expect(starFills(5)).toEqual([1, 1, 1, 1, 1]);
    expect(starFills(2.5)).toEqual([1, 1, 0.5, 0, 0]);
  });

  it('copes with missing, negative and too large ratings', () => {
    expect(starFills(null)).toEqual([0, 0, 0, 0, 0]);
    expect(starFills(undefined)).toEqual([0, 0, 0, 0, 0]);
    expect(starFills(-3)).toEqual([0, 0, 0, 0, 0]);
    expect(starFills(9)).toEqual([1, 1, 1, 1, 1]);
  });
});

