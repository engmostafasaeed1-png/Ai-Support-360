import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TimesheetEntriesTable from './TimesheetEntriesTable';
import { groupEntries } from '@/lib/timesheetView';
import type { SubmissionRow, WorkLogRow } from '@/lib/timesheet';

const log = (over: Partial<WorkLogRow> = {}): WorkLogRow => ({
  id: 'e1', ticket_id: 't1', consultant_id: 'c1', work_date: '2026-10-09', hours: 1, description: 'Analysis of the lot logic', category: 'support', billable: true,
  hourly_rate: 300, total_cost: 300, submission_id: null, created_at: '2026-10-09T08:00:00Z', consultant_name: 'Mostafa Saeed', ...over,
});
const sub = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 's1', ticket_id: 't1', submitted_by: 'u1', status: 'signed', total_hours: 1, billable_hours: 1, total_cost: 300, cost_currency: 'USD', hourly_rate: 300,
  vat_percent: null, vat_amount: null, grand_total: null, submitted_at: '2026-10-09T10:00:00Z', submit_count: 1, signed_at: '2026-10-11T10:00:00Z', signed_by_name: 'Client',
  created_at: '2026-10-09T10:00:00Z', ...over,
});

const notSent = log({ id: 'e1', hours: 0.25, billable: false, hourly_rate: null, total_cost: 0, description: 'Formula test' });
const inTimesheet = log({ id: 'e2', submission_id: 's1' });
const waitingForRate = log({ id: 'e3', hours: 2, hourly_rate: null, total_cost: null, description: 'Waits for a rate' });

function setup(over: Record<string, unknown> = {}, logs: WorkLogRow[] = [notSent, inTimesheet]) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const submissions = [sub()];
  render(
    <TimesheetEntriesTable
      groups={groupEntries(logs, submissions)}
      currency="USD"
      submissions={submissions}
      names={{ u1: 'Mostafa Saeed' }}
      isReadOnly={false}
      canEdit={entry => entry.id === 'e1' || entry.id === 'e3'}
      onEdit={onEdit}
      onDelete={onDelete}
      totals={{ hours: 1.25, billableHours: 1, amount: 300 }}
      {...over}
    />,
  );
  return { onEdit, onDelete };
}

afterEach(() => cleanup());

describe('TimesheetEntriesTable', () => {
  it('shows a header for the entries that are not submitted and one for every timesheet', () => {
    setup();
    expect(screen.getByText('Not submitted yet')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText(/without VAT/)).toBeTruthy();
    expect(screen.getAllByText('Mostafa Saeed').length).toBeGreaterThan(0);
  });

  it('says that the entries were not sent to the client when the viewer is the client', () => {
    setup({ isReadOnly: true });
    expect(screen.getByText('Not sent to you yet')).toBeTruthy();
    expect(screen.queryByText('Not submitted yet')).toBeNull();
  });

  it('shows the day, the description, the kind of work, the duration and whether it is billable', () => {
    setup();
    const rows = screen.getAllByTestId('timesheet-entry');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Oct');
    expect(rows[0].textContent).toContain('Formula test');
    expect(rows[0].textContent).toContain('Support');
    expect(rows[0].textContent).toContain('15 min');
    expect(rows[0].textContent).toContain('Not billable');
    expect(rows[1].textContent).toContain('1 h');
    expect(rows[1].textContent).toContain('Billable');
  });

  it('shows the amount of a billable entry and the rate that was used', () => {
    setup();
    const row = screen.getAllByTestId('timesheet-entry')[1];
    expect(row.textContent).toContain('300.00 USD');
    expect(row.textContent).toContain('300.00 USD per hour');
  });

  it('says that the rate is pending for a billable entry without an approved rate', () => {
    setup({}, [waitingForRate]);
    expect(screen.getByText('Rate pending approval')).toBeTruthy();
  });

  it('writes a missing description in words', () => {
    setup({}, [log({ id: 'e9', description: null })]);
    expect(screen.getByText('No description')).toBeTruthy();
  });

  it('shows a lock for an entry of a timesheet and buttons only for the entries that may be changed', () => {
    const { onEdit, onDelete } = setup();
    expect(screen.getAllByLabelText(/^Locked:/)).toHaveLength(1);
    const change = screen.getAllByLabelText('Change this entry');
    const remove = screen.getAllByLabelText('Delete this entry');
    expect(change).toHaveLength(1);
    expect(remove).toHaveLength(1);
    fireEvent.click(change[0]);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe('e1');
    fireEvent.click(remove[0]);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].id).toBe('e1');
  });

  it('shows the totals at the end', () => {
    setup();
    const total = screen.getByText('Total').closest('[role="row"]') as HTMLElement;
    expect(total.textContent).toContain('1.25 h');
    expect(total.textContent).toContain('300.00 USD');
  });
});
