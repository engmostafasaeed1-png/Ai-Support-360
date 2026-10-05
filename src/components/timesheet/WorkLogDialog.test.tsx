import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), eq: vi.fn(), selectAfterUpdate: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: mocks.insert,
      update: (payload: unknown) => {
        mocks.update(payload);
        return {
          eq: (column: string, value: string) => {
            mocks.eq(column, value);
            return { select: mocks.selectAfterUpdate };
          },
        };
      },
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import WorkLogDialog from './WorkLogDialog';
import type { WorkLogRow } from '@/lib/timesheet';

const onOpenChange = vi.fn();
const onSaved = vi.fn();
const props = (over: Record<string, unknown> = {}) => ({
  ticketId: 't1', consultantId: 'c1', open: true, onOpenChange, entry: null as WorkLogRow | null, rateLabel: '50.00 USD per hour', onSaved, ...over,
});
const entry: WorkLogRow = {
  id: 'l1', ticket_id: 't1', consultant_id: 'c1', work_date: '2026-10-02', hours: 2.25, description: 'Analysed the posting error', category: 'analysis',
  billable: true, hourly_rate: 50, total_cost: 112.5, submission_id: null,
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const describeWork = (text = 'Analysed the posting error in FB60') => type('What was done', text);

beforeEach(() => {
  mocks.insert.mockReset();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.selectAfterUpdate.mockReset();
  mocks.selectAfterUpdate.mockResolvedValue({ data: [{ id: 'l1' }], error: null });
  onOpenChange.mockReset();
  onSaved.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('WorkLogDialog', () => {
  it('does not save an entry without a description', () => {
    render(<WorkLogDialog {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add the entry' }));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/Describe what was done/);
  });

  it('does not save a duration under 15 minutes', () => {
    render(<WorkLogDialog {...props()} />);
    describeWork();
    type('Hours', '0');
    type('Minutes', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Add the entry' }));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/at least 15 minutes/);
  });

  it('adds an entry with the duration in hours and no rate', async () => {
    render(<WorkLogDialog {...props()} />);
    describeWork('Analysed the posting error');
    type('Hours', '1');
    type('Minutes', '30');
    fireEvent.click(screen.getByRole('button', { name: 'Add the entry' }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    const payload = mocks.insert.mock.calls[0][0];
    expect(payload.ticket_id).toBe('t1');
    expect(payload.consultant_id).toBe('c1');
    expect(payload.hours).toBe(1.5);
    expect(payload.description).toBe('Analysed the posting error');
    expect(payload.category).toBe('support');
    expect(payload.billable).toBe(true);
    expect(payload.work_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload).not.toHaveProperty('hourly_rate');
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves hours that are not billable as not billable', async () => {
    render(<WorkLogDialog {...props()} />);
    describeWork();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Add the entry' }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    expect(mocks.insert.mock.calls[0][0].billable).toBe(false);
  });

  it('shows the error of the database', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'Describe what was done (at least 3 characters)' } });
    render(<WorkLogDialog {...props()} />);
    describeWork();
    fireEvent.click(screen.getByRole('button', { name: 'Add the entry' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not save for somebody who is not a consultant', () => {
    render(<WorkLogDialog {...props({ consultantId: null })} />);
    describeWork();
    fireEvent.click(screen.getByRole('button', { name: 'Add the entry' }));
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('Only consultants can log work.');
  });

  it('changes an entry that is not sent yet', async () => {
    render(<WorkLogDialog {...props({ entry })} />);
    expect((screen.getByLabelText('Hours') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('Minutes') as HTMLSelectElement).value).toBe('15');
    expect((screen.getByLabelText('What was done') as HTMLTextAreaElement).value).toBe('Analysed the posting error');
    describeWork('Analysed the posting error and fixed the account determination');
    fireEvent.click(screen.getByRole('button', { name: 'Save the entry' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const payload = mocks.update.mock.calls[0][0];
    expect(payload.hours).toBe(2.25);
    expect(payload.description).toBe('Analysed the posting error and fixed the account determination');
    expect(payload).not.toHaveProperty('hourly_rate');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'l1');
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('tells when the change did not happen', async () => {
    mocks.selectAfterUpdate.mockResolvedValue({ data: [], error: null });
    render(<WorkLogDialog {...props({ entry })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save the entry' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says which rate is used, or that the rate is not approved yet', () => {
    const { unmount } = render(<WorkLogDialog {...props()} />);
    expect(screen.getByText(/Hourly rate for billable hours: 50.00 USD per hour/)).toBeTruthy();
    unmount();
    render(<WorkLogDialog {...props({ rateLabel: null })} />);
    expect(screen.getByText(/Your hourly rate is not approved yet/)).toBeTruthy();
  });
});
