import { describe, it, expect } from 'vitest';
import { formatElapsed, makeSteps, progressOf, setStep, stepAnnouncement } from './progressSteps';
import { matchSteps, understoodSummary } from './matchProgress';

const defs = [
  { key: 'save', label: 'Saving your request' },
  { key: 'understand', label: 'Understanding your request' },
  { key: 'rank', label: 'Reading consultant profiles and ranking the best experts', open: true },
];

describe('step progress', () => {
  it('moves through the steps in order and the bar only moves when a step finishes', () => {
    let steps = setStep(makeSteps(defs), 'save', 'active');
    expect(progressOf(steps)).toMatchObject({ percent: 0, position: 1, finished: 0 });
    expect(stepAnnouncement(steps)).toBe('Step 1 of 3: Saving your request');

    steps = setStep(setStep(steps, 'save', 'done'), 'understand', 'active');
    expect(progressOf(steps)).toMatchObject({ percent: 33, position: 2 });
    expect(stepAnnouncement(steps)).toBe('Step 2 of 3: Understanding your request');

    steps = setStep(setStep(steps, 'understand', 'done'), 'rank', 'active');
    expect(progressOf(steps)).toMatchObject({ percent: 67, position: 3 });

    steps = setStep(steps, 'rank', 'done');
    expect(progressOf(steps)).toMatchObject({ percent: 100, allDone: true });
    expect(stepAnnouncement(steps)).toBe('Done');
  });

  it('never reaches 100 % while a step is still running', () => {
    const steps = setStep(setStep(setStep(makeSteps(defs), 'save', 'done'), 'understand', 'done'), 'rank', 'active');
    expect(progressOf(steps).percent).toBeLessThan(100);
  });

  it('names the failed step', () => {
    const steps = setStep(setStep(makeSteps(defs), 'save', 'done'), 'understand', 'error');
    expect(progressOf(steps).failed?.key).toBe('understand');
    expect(stepAnnouncement(steps)).toBe('Step 2 of 3 failed: Understanding your request');
  });

  it('formats the elapsed time', () => {
    expect(formatElapsed(7_400)).toBe('0:07');
    expect(formatElapsed(65_000)).toBe('1:05');
  });
});

describe('match steps', () => {
  it('reads the request first, then ranks, then is done', () => {
    expect(matchSteps('ranking').map((s) => s.state)).toEqual(['done', 'active']);
    expect(matchSteps('error').map((s) => s.state)).toEqual(['done', 'error']);
    expect(matchSteps('done', undefined, 5).map((s) => s.state)).toEqual(['done', 'done']);
    expect(matchSteps('done', undefined, 5)[1].detail).toBe('5 experts found');
  });

  it('says what it understood from the request', () => {
    const line = understoodSummary({ title: 'FB50 posting error', description: 'After the S/4HANA migration in Saudi Arabia', sap_modules: ['FI'] });
    expect(line.startsWith('We understood:')).toBe(true);
    expect(line).toContain('FB50');
    expect(line).toContain('Saudi Arabia');
  });

  it('is honest when nothing specific was found', () => {
    expect(understoodSummary({ title: 'Help', description: 'not working' })).toBe('No SAP area or error code found yet');
  });
});
