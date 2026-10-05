import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import SubmitTimesheetDialog from './SubmitTimesheetDialog';
import type { WorkLogRow } from '@/lib/timesheet';

const entry = (over: Partial<WorkLogRow> = {}): WorkLogRow => ({
  id: 'l1', ticket_id: 't1', consultant_id: 'c1', work_date: '2026-10-02', hours: 2, description: 'Analysed the posting error', category: 'analysis',
  billable: true, hourly_rate: 50, total_cost: 100, submission_id: null, ...over,
});
const onOpenChange = vi.fn();
const onSubmitted = vi.fn();
const props = (over: Record<string, unknown> = {}) => ({
  open: true, onOpenChange, ticketId: 't1', entries: [entry(), entry({ id: 'l2', hours: 1, billable: false, total_cost: 0 })], vatPercent: 14,
  currency: 'USD', blockReason: null as string | null, resubmit: false, onSubmitted, ...over,
});

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: 'new-id', error: null });
  onOpenChange.mockReset();
  onSubmitted.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('SubmitTimesheetDialog', () => {
  it('shows what goes into the timesheet: entries, hours, amount, VAT and total', () => {
    render(<SubmitTimesheetDialog {...props()} />);
    const text = screen.getByTestId('submit-totals').textContent ?? '';
    expect(text).toContain('3 h (2 h billable)');
    expect(text).toContain('100.00 USD');
    expect(text).toContain('14.00 USD');
    expect(text).toContain('114.00 USD');
  });

  it('can not be sent while something blocks it and says why', () => {
    render(<SubmitTimesheetDialog {...props({ blockReason: 'Your hourly rate for this ticket has not been approved yet.' })} />);
    expect(screen.getByRole('alert').textContent).toContain('has not been approved yet');
    expect((screen.getByRole('button', { name: 'Submit for approval' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits with the message', async () => {
    render(<SubmitTimesheetDialog {...props()} />);
    fireEvent.change(screen.getByLabelText(/Message to the client/), { target: { value: 'The work of the first week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][0]).toBe('submit_timesheet');
    expect(mocks.rpc.mock.calls[0][1]._ticket_id).toBe('t1');
    expect(mocks.rpc.mock.calls[0][1]._message).toBe('The work of the first week');
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('submits without a message', async () => {
    render(<SubmitTimesheetDialog {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][1]._message).toBeUndefined();
  });

  it('shows the error of the database and stays open', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'A timesheet is already waiting for the answer of the client' } });
    render(<SubmitTimesheetDialog {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('uses other words when the timesheet is submitted again', () => {
    render(<SubmitTimesheetDialog {...props({ resubmit: true })} />);
    expect(screen.getByRole('button', { name: 'Submit again' })).toBeTruthy();
    expect(screen.getByLabelText(/What did you change/)).toBeTruthy();
  });
});
