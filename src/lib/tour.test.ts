import { describe, expect, it } from 'vitest';
import { TOUR_KEY, TOUR_VERSION, clampStep, nextStep, prevStep, resumeStep, shouldAutoStart, type TourProgress } from './tour';

const row = (patch: Partial<TourProgress> = {}): TourProgress => ({
  tour_key: TOUR_KEY, tour_version: TOUR_VERSION, last_step: 3, completed_at: null, skipped_at: null, ...patch,
});

describe('tour helpers', () => {
  it('has the key and version', () => {
    expect(TOUR_KEY).toBe('consultant-welcome');
    expect(TOUR_VERSION).toBe(1);
  });

  it('moves and clamps steps', () => {
    expect(nextStep(0, 3)).toBe(1);
    expect(nextStep(2, 3)).toBe(2);
    expect(prevStep(0, 3)).toBe(0);
    expect(prevStep(2, 3)).toBe(1);
    expect(clampStep(99, 3)).toBe(2);
    expect(clampStep(-4, 3)).toBe(0);
    expect(clampStep(Number.NaN, 3)).toBe(0);
  });

  it('auto-starts only when allowed', () => {
    expect(shouldAutoStart({ progress: null, welcomeParam: false, onboardingCompleted: true })).toBe(true);
    expect(shouldAutoStart({ progress: null, welcomeParam: false, onboardingCompleted: false })).toBe(false);
    expect(shouldAutoStart({ progress: null, welcomeParam: true, onboardingCompleted: false })).toBe(true);
    expect(shouldAutoStart({ progress: null, welcomeParam: false, onboardingCompleted: true, pathname: '/consultant/earnings' })).toBe(false);
    expect(shouldAutoStart({ progress: row({ completed_at: '2026-10-01' }), welcomeParam: true, onboardingCompleted: true })).toBe(false);
    expect(shouldAutoStart({ progress: row({ skipped_at: '2026-10-01' }), welcomeParam: false, onboardingCompleted: true })).toBe(false);
    expect(shouldAutoStart({ progress: row(), welcomeParam: false, onboardingCompleted: true })).toBe(true);
    expect(shouldAutoStart({ progress: row({ tour_version: 0, completed_at: '2026-10-01' }), welcomeParam: false, onboardingCompleted: true })).toBe(true);
  });

  it('resumes at the saved step of an unfinished tour', () => {
    expect(resumeStep(row(), 10)).toBe(3);
    expect(resumeStep(row({ last_step: 40 }), 10)).toBe(9);
    expect(resumeStep(row({ completed_at: '2026-10-01' }), 10)).toBe(0);
    expect(resumeStep(null, 10)).toBe(0);
  });
});
