import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import TimesheetRateCard from './TimesheetRateCard';
import type { RateRow } from '@/lib/timesheet';

const rate = (over: Partial<RateRow> = {}): RateRow => ({
  id: 'r1', ticket_id: 't1', consultant_id: 'c1', hourly_rate: 50, currency: 'USD', status: 'approved', source: 'consultant',
  decided_at: '2026-10-03T10:00:00Z', decision_note: null, created_at: '2026-10-03T09:00:00Z', ...over,
});

const onChanged = vi.fn();
const base = {
  ticketId: 't1', currency: 'USD', rates: [] as RateRow[], consultantIds: ['c1'], names: { c1: 'Mostaf Test' },
  myConsultantId: null as string | null, suggestedRate: null as number | null, canApprove: false, onChanged,
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: 'x', error: null });
  onChanged.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('TimesheetRateCard as the consultant', () => {
  it('offers the rate of the profile and sends the rate to the client', async () => {
    render(<TimesheetRateCard {...base} myConsultantId="c1" suggestedRate={45} />);
    const input = screen.getByLabelText(/Your hourly rate/) as HTMLInputElement;
    expect(input.value).toBe('45');
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to the client for approval/ }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][0]).toBe('propose_ticket_rate');
    expect(mocks.rpc.mock.calls[0][1]._ticket_id).toBe('t1');
    expect(mocks.rpc.mock.calls[0][1]._hourly_rate).toBe(55);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('does not send an empty or zero rate', () => {
    render(<TimesheetRateCard {...base} myConsultantId="c1" />);
    fireEvent.change(screen.getByLabelText(/Your hourly rate/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to the client for approval/ }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('shows the approved rate and the proposal that waits', () => {
    const rates = [rate(), rate({ id: 'r2', status: 'proposed', hourly_rate: 60, created_at: '2026-10-04T09:00:00Z', decided_at: null })];
    render(<TimesheetRateCard {...base} rates={rates} myConsultantId="c1" />);
    expect(screen.getByText('50.00 USD per hour')).toBeTruthy();
    expect(screen.getByText('60.00 USD per hour')).toBeTruthy();
    expect(screen.getByText(/Waiting for the client to approve/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change the proposal' })).toBeTruthy();
  });

  it('shows why the client declined and asks for another rate', () => {
    render(<TimesheetRateCard {...base} rates={[rate({ status: 'rejected', decision_note: 'Too high for this ticket', decided_at: null })]} myConsultantId="c1" />);
    expect(screen.getByText(/Too high for this ticket/)).toBeTruthy();
    expect(screen.getByLabelText(/Your hourly rate/)).toBeTruthy();
  });
});

describe('TimesheetRateCard as the client', () => {
  it('approves a proposed rate', async () => {
    render(<TimesheetRateCard {...base} canApprove rates={[rate({ status: 'proposed', hourly_rate: 55, decided_at: null })]} />);
    expect(screen.getByText('55.00 USD per hour')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Approve this rate/ }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][0]).toBe('respond_to_ticket_rate');
    expect(mocks.rpc.mock.calls[0][1]._rate_id).toBe('r1');
    expect(mocks.rpc.mock.calls[0][1]._approve).toBe(true);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('needs a reason to decline a rate and sends it', async () => {
    render(<TimesheetRateCard {...base} canApprove rates={[rate({ status: 'proposed', hourly_rate: 55, decided_at: null })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }));
    const decline = screen.getByRole('button', { name: 'Decline the rate' }) as HTMLButtonElement;
    expect(decline.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Tell the consultant why the rate is declined/), { target: { value: 'Too high' } });
    expect(decline.disabled).toBe(false);
    fireEvent.click(decline);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][1]._approve).toBe(false);
    expect(mocks.rpc.mock.calls[0][1]._note).toBe('Too high');
  });

  it('shows the approved rate with who approved it', () => {
    render(<TimesheetRateCard {...base} canApprove rates={[rate()]} />);
    expect(screen.getByText('50.00 USD per hour')).toBeTruthy();
    expect(screen.getByText(/approved by you/)).toBeTruthy();
  });

  it('says that no rate was proposed yet', () => {
    render(<TimesheetRateCard {...base} canApprove />);
    expect(screen.getByText(/No hourly rate was proposed yet/)).toBeTruthy();
  });

  it('shows a colleague or an administrator the proposal without buttons', () => {
    render(<TimesheetRateCard {...base} canApprove={false} rates={[rate({ status: 'proposed', hourly_rate: 55, decided_at: null })]} />);
    expect(screen.getByText('55.00 USD per hour')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve this rate/ })).toBeNull();
    expect(screen.getByText(/The client has to approve it/)).toBeTruthy();
  });

  it('says when no consultant works on the ticket', () => {
    render(<TimesheetRateCard {...base} consultantIds={[]} canApprove />);
    expect(screen.getByText(/No consultant is working on this ticket yet/)).toBeTruthy();
  });
});
