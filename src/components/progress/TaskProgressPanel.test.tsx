import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import TaskProgressPanel from './TaskProgressPanel';
import { makeSteps, setStep } from '@/lib/progressSteps';

const defs = [
  { key: 'save', label: 'Saving your request' },
  { key: 'understand', label: 'Understanding your request' },
  { key: 'rank', label: 'Ranking the best experts', open: true },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskProgressPanel', () => {
  it('shows the steps in order and moves the bar and the announcement with each finished step', () => {
    let steps = setStep(makeSteps(defs), 'save', 'active');
    const { rerender } = render(<TaskProgressPanel title="Submitting your request" steps={steps} startedAt={Date.now()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('p')?.textContent)).toEqual([
      'Saving your request', 'Understanding your request', 'Ranking the best experts',
    ]);
    expect(screen.getByText('Step 1 of 3: Saving your request', { selector: '[aria-live]' })).toBeTruthy();

    steps = setStep(setStep(steps, 'save', 'done'), 'understand', 'active');
    rerender(<TaskProgressPanel title="Submitting your request" steps={steps} startedAt={Date.now()} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33');
    expect(screen.getAllByRole('listitem')[1].getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('Step 2 of 3: Understanding your request', { selector: '[aria-live]' })).toBeTruthy();

    steps = setStep(setStep(steps, 'understand', 'done'), 'rank', 'active');
    rerender(<TaskProgressPanel title="Submitting your request" steps={steps} startedAt={Date.now()} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('67');
    // the open server step pulses instead of showing an invented percentage
    expect(screen.getByTestId('task-open-segment')).toBeTruthy();

    steps = setStep(steps, 'rank', 'done');
    rerender(<TaskProgressPanel title="Submitting your request" steps={steps} startedAt={Date.now()} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByTestId('task-progress').getAttribute('data-status')).toBe('done');
  });

  it('shows the elapsed time and a note after 10 seconds', () => {
    vi.useFakeTimers();
    const start = Date.now();
    render(<TaskProgressPanel title="Finding the best experts" steps={setStep(makeSteps(defs), 'save', 'active')} startedAt={start} />);
    expect(screen.queryByTestId('task-slow-note')).toBeNull();
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(screen.getByTestId('task-elapsed').textContent).toContain('0:11');
    expect(screen.getByTestId('task-slow-note').textContent).toBe('Still working, this can take up to a minute.');
  });

  it('shows the error with Retry and a second choice', () => {
    const onRetry = vi.fn();
    const back = vi.fn();
    const steps = setStep(setStep(makeSteps(defs), 'save', 'done'), 'understand', 'error');
    render(<TaskProgressPanel title="Submitting your request" steps={steps} startedAt={Date.now()} error="We could not save it." onRetry={onRetry} errorAction={{ label: 'Back to the form', onClick: back }} />);
    expect(screen.getByRole('alert').textContent).toContain('We could not save it.');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the form' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('offers the safe way out only while running, and skeleton cards for the experts', () => {
    const cancel = vi.fn();
    const running = setStep(makeSteps(defs), 'save', 'active');
    const { rerender } = render(<TaskProgressPanel title="Finding" steps={running} startedAt={Date.now()} cancel={{ label: 'Cancel', onClick: cancel }} skeletonCount={3} />);
    expect(screen.getByTestId('task-skeletons').children).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    const done = defs.reduce((s, d) => setStep(s, d.key, 'done'), running);
    rerender(<TaskProgressPanel title="Finding" steps={done} startedAt={Date.now()} cancel={{ label: 'Cancel', onClick: cancel }} skeletonCount={3} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByTestId('task-skeletons')).toBeNull();
  });
});
