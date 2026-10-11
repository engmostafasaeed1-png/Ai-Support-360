import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TimesheetProgress from './TimesheetProgress';
import type { ProgressStep } from '@/lib/timesheetView';

const steps: ProgressStep[] = [
  { key: 'rate', label: 'Rate', state: 'done', detail: '300.00 USD per hour' },
  { key: 'hours', label: 'Hours', state: 'done', detail: '1 h logged' },
  { key: 'submitted', label: 'Submitted', state: 'current', detail: 'Ready to submit' },
  { key: 'approved', label: 'Approved', state: 'todo', detail: 'After the client answers' },
  { key: 'paid', label: 'Paid', state: 'attention', detail: 'Payment failed' },
];

afterEach(() => cleanup());

describe('TimesheetProgress', () => {
  it('shows the five steps with their labels and details', () => {
    render(<TimesheetProgress steps={steps} />);
    const list = screen.getByRole('list', { name: 'Timesheet progress' });
    expect(list.querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText('Ready to submit')).toBeTruthy();
    expect(screen.getByText('300.00 USD per hour')).toBeTruthy();
  });

  it('marks the current step and says the state of every step in words for a screen reader', () => {
    render(<TimesheetProgress steps={steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(items[0].getAttribute('aria-current')).toBeNull();
    expect(items[0].textContent).toContain('Done');
    expect(items[2].textContent).toContain('Current step');
    expect(items[3].textContent).toContain('Not yet');
    expect(items[4].textContent).toContain('Needs attention');
  });

  it('gives every step its state', () => {
    render(<TimesheetProgress steps={steps} />);
    expect(screen.getAllByRole('listitem').map(li => li.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'todo', 'attention']);
  });
});
