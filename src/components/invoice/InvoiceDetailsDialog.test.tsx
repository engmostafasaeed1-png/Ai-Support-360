import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Clock } from 'lucide-react';

const state = vi.hoisted(() => ({ admin: false, disputes: false, confirm: vi.fn(), report: vi.fn() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => state.admin }));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('@/hooks/useBilling', () => ({
  usePaymentMethods: () => ({ data: { card: false, bank_transfer: true }, isLoading: false }),
  useInvoiceBankDetails: () => ({ data: { bank_name: 'Bank', iban: 'ABC123' } }),
  useStartCardPayment: () => ({ mutate: vi.fn() }),
  useReportPayment: () => ({ mutate: state.report }),
  useConfirmPayment: () => ({ mutate: state.confirm, isPending: false }),
}));
vi.mock('./InvoiceBusinessSection', () => ({ default: () => <p>Business details</p> }));
vi.mock('./PaymentStatusTimeline', () => ({ PaymentStatusTimeline: () => <p>Payment events</p> }));
vi.mock('./InvoiceDisputeSection', async () => {
  const { useEffect } = await import('react');
  return { InvoiceDisputeSection: ({ onDisputesLoaded }: { onDisputesLoaded: (exists: boolean) => void }) => {
    useEffect(() => { onDisputesLoaded(state.disputes); }, []);
    return <p>Dispute details</p>;
  } };
});
vi.mock('@/components/currency/ConvertedAmount', () => ({ ConvertedAmount: ({ amount }: { amount: number }) => <span>{amount}</span> }));
import { InvoiceDetailsDialog } from './InvoiceDetailsDialog';

const payment = { id: 'p1', invoice: 'INV-2026-Q4-000002', status: 'pending', amount: 18.52, currency: 'USD', consultant: 'Sam', date: '2026-10-16', reference: 'REF123' };
function show(overrides = {}) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <InvoiceDetailsDialog payment={{ ...payment, ...overrides }} status={{ label: 'Pending', color: '', icon: Clock }} onClose={vi.fn()} onEditDetails={vi.fn()} onDownload={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { state.admin = false; state.disputes = false; state.confirm.mockReset(); state.report.mockReset(); });
afterEach(cleanup);

describe('invoice payment actions', () => {
  it('opens the existing report form and sends the transfer through its existing handler', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'I have paid - confirm payment' }));
    const reportDialog = screen.getByRole('dialog', { name: 'I have paid' });
    fireEvent.change(within(reportDialog).getByPlaceholderText('Number from your bank receipt'), { target: { value: 'BANK-123' } });
    fireEvent.click(within(reportDialog).getByRole('button', { name: 'I have paid' }));
    expect(state.report).toHaveBeenCalledTimes(1);
    expect(state.report.mock.calls[0][0]).toMatchObject({ paymentId: 'p1', reference: 'BANK-123' });
  });
  it('replaces the client action with a disabled reported pill', async () => {
    show({ client_reported_at: '2026-10-16T12:00:00Z' });
    expect(await screen.findByRole('button', { name: 'Payment reported on Oct 16, 2026 - waiting for confirmation' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'I have paid - confirm payment' })).not.toBeInTheDocument();
  });
  it('lets an administrator confirm a pending invoice exactly once with the existing billing handler', () => {
    state.admin = true;
    show({ client_reported_at: '2026-10-16T12:00:00Z', client_transfer_reference: 'BANK-123', client_transfer_date: '2026-10-15' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm payment received' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm payment received' });
    expect(within(dialog).getByText('Date of the transfer: Oct 15, 2026')).toBeInTheDocument();
    const button = within(dialog).getByRole('button', { name: 'Confirm payment' });
    fireEvent.click(button); fireEvent.click(button);
    expect(state.confirm).toHaveBeenCalledTimes(1);
    expect(state.confirm.mock.calls[0][0]).toEqual({ id: 'p1', bankReference: 'BANK-123', received: 18.52 });
  });
  it('shows only the paid pill and download action in a paid footer', () => {
    state.admin = true;
    const { container } = show({ status: 'completed', paid_at: '2026-10-16T12:00:00Z' });
    const footer = container.ownerDocument.querySelector('[data-invoice-footer]');
    if (!(footer instanceof HTMLElement)) throw new Error('Missing invoice footer');
    expect(within(footer).getByText('Paid on Oct 16, 2026')).toBeInTheDocument();
    expect(within(footer).getAllByRole('button')).toHaveLength(1);
    expect(within(footer).getByRole('button', { name: 'Download Invoice' })).toBeInTheDocument();
  });
  it('defaults secondary sections closed for an unpaid invoice without disputes', () => {
    show();
    for (const name of ['Billed to', 'Payment Timeline', 'Disputes']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
  });
  it('automatically opens the paid timeline and existing disputes, keeping Billed to collapsed', async () => {
    state.disputes = true;
    show({ status: 'paid' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disputes' })).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('button', { name: 'Payment Timeline' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Billed to' })).toHaveAttribute('aria-expanded', 'false');
  });
});