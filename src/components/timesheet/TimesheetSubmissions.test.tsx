import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
const terms = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/usePricingTerms', () => ({ usePricingTerms: () => ({ data: terms.value }) }));

import TimesheetSubmissions from './TimesheetSubmissions';
import type { CommentRow, InvoiceRow, SubmissionRow } from '@/lib/timesheet';

const sub = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 's1', ticket_id: 't1', submitted_by: 'u-cons', status: 'submitted', total_hours: 4.5, billable_hours: 3.5, total_cost: 175, cost_currency: 'USD',
  hourly_rate: 50, vat_percent: null, vat_amount: null, grand_total: null, submitted_at: '2026-10-04T09:00:00Z', submit_count: 1,
  signed_at: null, signed_by_name: null, created_at: '2026-10-04T09:00:00Z', ...over,
});
const comment = (over: Partial<CommentRow> = {}): CommentRow => ({
  id: 'c1', submission_id: 's1', author_id: 'u-cons', author_role: 'consultant', kind: 'comment', body: 'First timesheet', created_at: '2026-10-04T09:00:00Z', ...over,
});
const onChanged = vi.fn();
const onResubmit = vi.fn();
const props = (over: Record<string, unknown> = {}) => ({
  submissions: [sub()], comments: [] as CommentRow[], invoices: [] as InvoiceRow[], entryCounts: { s1: 3 },
  names: { 'u-cons': 'Mostaf Test', 'u-client': 'Test Company' }, vatPercent: 14, canApprove: true, isConsultantView: false,
  viewerUserId: 'u-client', onChanged, onResubmit, ...over,
});

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  terms.value = null;
  onChanged.mockReset();
  onResubmit.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('TimesheetSubmissions as the client', () => {
  it('shows the status and the numbers of a timesheet that waits', () => {
    render(<TimesheetSubmissions {...props()} />);
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('Mostaf Test')).toBeTruthy();
    expect(screen.getByText('4.5 h (3.5 h billable)')).toBeTruthy();
    expect(screen.getByText('50.00 USD per hour')).toBeTruthy();
    expect(screen.getByText('175.00 USD')).toBeTruthy();
    expect(screen.getByText('199.50 USD')).toBeTruthy();
  });

  it('shows the fee, the added fees and the total that the client pays when the percentages are set', () => {
    terms.value = { serviceFeePercent: 10, processingFeePercent: 5, vatPercent: 15, plansEnabled: false, cardsEnabled: false };
    render(<TimesheetSubmissions {...props({ submissions: [sub({ total_cost: 300 })] })} />);
    expect(screen.getByText('Consultant fee')).toBeTruthy();
    expect(screen.getByText('300.00 USD')).toBeTruthy();
    expect(screen.getByText('96.75 USD')).toBeTruthy();
    expect(screen.getByText('396.75 USD')).toBeTruthy();
  });

  it('approves the timesheet with a note', async () => {
    render(<TimesheetSubmissions {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByPlaceholderText(/A note for the consultant/), { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve the timesheet' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][0]).toBe('respond_to_timesheet');
    expect(mocks.rpc.mock.calls[0][1]._submission_id).toBe('s1');
    expect(mocks.rpc.mock.calls[0][1]._approve).toBe(true);
    expect(mocks.rpc.mock.calls[0][1]._note).toBe('Looks good');
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('needs a comment to ask for changes and sends it', async () => {
    render(<TimesheetSubmissions {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    const send = screen.getByRole('button', { name: 'Send to the consultant' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Tell the consultant what to change/), { target: { value: 'no' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Tell the consultant what to change/), { target: { value: 'Please split the hours per day' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][1]._approve).toBe(false);
    expect(mocks.rpc.mock.calls[0][1]._note).toBe('Please split the hours per day');
  });

  it('warns about hours over the approved plan before the answer', () => {
    render(<TimesheetSubmissions {...props({ planOverBy: 2 })} />);
    expect(screen.getByText(/over the approved plan/)).toBeTruthy();
  });

  it('shows who approved an approved timesheet, the saved VAT and the invoice, and no answer buttons', () => {
    const approved = sub({ status: 'signed', vat_percent: 14, vat_amount: 24.5, grand_total: 199.5, signed_by_name: 'Test Company', signed_at: '2026-10-05T10:00:00Z' });
    const invoice: InvoiceRow = { id: 'p1', timesheet_id: 's1', invoice_number: 'INV-2026-000001', status: 'pending', amount: 199.5, currency: 'USD', due_date: '2026-10-19T10:00:00Z', paid_at: null };
    render(<TimesheetSubmissions {...props({ submissions: [approved], invoices: [invoice] })} />);
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText(/Approved by Test Company/)).toBeTruthy();
    expect(screen.getByTestId('timesheet-invoice').textContent).toContain('INV-2026-000001');
    expect(screen.getByTestId('timesheet-invoice').textContent).toContain('Waiting for payment');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull();
  });

  it('writes the word "by" and the name of the approver as separate pieces of text, so that the Arabic translator can translate the word', () => {
    const approved = sub({ status: 'signed', signed_by_name: 'Test Company', signed_at: '2026-10-05T10:00:00Z' });
    render(<TimesheetSubmissions {...props({ submissions: [approved] })} />);
    const line = screen.getByText(/Approved by Test Company/);
    const pieces = Array.from(line.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent);
    expect(pieces).toContain(' by ');
    expect(pieces).toContain('Test Company');
  });

  it('shows the comments of both sides in order', () => {
    const comments = [comment(), comment({ id: 'c2', author_id: 'u-client', author_role: 'client', kind: 'change_request', body: 'Please split the hours per day', created_at: '2026-10-04T10:00:00Z' })];
    render(<TimesheetSubmissions {...props({ comments })} />);
    const thread = screen.getByTestId('timesheet-comments');
    expect(thread.textContent).toContain('First timesheet');
    expect(thread.textContent).toContain('Please split the hours per day');
    expect(thread.textContent).toContain('You');
    expect(thread.textContent).toContain('asked for changes');
  });

  it('sends a comment and empties the box', async () => {
    render(<TimesheetSubmissions {...props()} />);
    const box = screen.getByLabelText('Comment on this timesheet') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Can you add the transaction code?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send comment/ }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0][0]).toBe('add_timesheet_comment');
    expect(mocks.rpc.mock.calls[0][1]._body).toBe('Can you add the transaction code?');
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('shows an empty list in words for the client', () => {
    render(<TimesheetSubmissions {...props({ submissions: [] })} />);
    expect(screen.getByText(/The consultant submits the hours here for your approval/)).toBeTruthy();
  });
});

describe('TimesheetSubmissions as the consultant', () => {
  const consultant = { canApprove: false, isConsultantView: true, viewerUserId: 'u-cons' };

  it('shows the request for changes and submits again', () => {
    const requested = sub({ status: 'changes_requested', submit_count: 1 });
    const comments = [comment({ id: 'c2', author_id: 'u-client', author_role: 'client', kind: 'change_request', body: 'Please split the hours per day' })];
    render(<TimesheetSubmissions {...props({ ...consultant, submissions: [requested], comments })} />);
    expect(screen.getByText('Changes requested')).toBeTruthy();
    expect(screen.getByTestId('changes-banner').textContent).toContain('Please split the hours per day');
    fireEvent.click(screen.getByRole('button', { name: /Submit again/ }));
    expect(onResubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the fee as theirs and what the client pays', () => {
    terms.value = { serviceFeePercent: 10, processingFeePercent: 5, vatPercent: 15, plansEnabled: false, cardsEnabled: false };
    render(<TimesheetSubmissions {...props({ ...consultant, submissions: [sub({ total_cost: 300 })] })} />);
    expect(screen.getByText('Your fee')).toBeTruthy();
    expect(screen.getByText(/The client pays/)).toBeTruthy();
    expect(screen.getByText('396.75 USD')).toBeTruthy();
  });

  it('has no answer buttons and says that the client has to answer', () => {
    render(<TimesheetSubmissions {...props({ ...consultant })} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText(/Waiting for the client/)).toBeTruthy();
  });

  it('shows the round of a timesheet that was submitted again', () => {
    render(<TimesheetSubmissions {...props({ ...consultant, submissions: [sub({ submit_count: 2 })] })} />);
    expect(screen.getByText('Round 2')).toBeTruthy();
  });

  it('shows an empty list in words for the consultant', () => {
    render(<TimesheetSubmissions {...props({ ...consultant, submissions: [] })} />);
    expect(screen.getByText(/Submit for approval/)).toBeTruthy();
  });
});

describe('TimesheetSubmissions as an onlooker', () => {
  it('shows no buttons and no comment box to somebody who is neither the client nor the consultant', () => {
    render(<TimesheetSubmissions {...props({ canApprove: false, isConsultantView: false, viewerUserId: 'u-other' })} />);
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByLabelText('Comment on this timesheet')).toBeNull();
  });
});
