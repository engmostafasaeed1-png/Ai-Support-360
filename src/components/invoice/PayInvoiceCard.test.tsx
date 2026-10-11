import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  methods: { data: undefined as unknown, isLoading: false },
  bank: { data: undefined as unknown, isLoading: false, isError: false },
  bankEnabled: [] as boolean[],
}));

vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useBilling', () => ({
  usePaymentMethods: () => state.methods,
  useInvoiceBankDetails: (_id: string | undefined, enabled?: boolean) => {
    state.bankEnabled.push(!!enabled);
    return state.bank;
  },
  useReportPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useStartCardPayment: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { PayInvoiceCard } from './PayInvoiceCard';

const payment = { id: 'p1', status: 'pending', amount: 100, currency: 'USD', reference: 'REF-1', consultant: 'Sam Consultant' };
const account = { beneficiary: 'Qurtuba Tech for Software', bank_name: 'Test Bank', iban: 'EG00 0000 0000 0000' };

beforeEach(() => {
  state.methods = { data: undefined, isLoading: false };
  state.bank = { data: undefined, isLoading: false, isError: false };
  state.bankEnabled = [];
});

afterEach(() => cleanup());

describe('PayInvoiceCard', () => {
  it('shows nothing for an invoice that is not open', () => {
    state.methods = { data: { card: true, bank_transfer: false, bank_transfer_reason: null }, isLoading: false };
    const { container } = render(<PayInvoiceCard payment={{ ...payment, status: 'completed' }} />);
    expect(container.textContent).toBe('');
  });

  it('offers the card only, and no bank details, when bank transfer is not allowed', () => {
    state.methods = { data: { card: true, bank_transfer: false, bank_transfer_reason: null }, isLoading: false };
    state.bank = { data: account, isLoading: false, isError: false };
    render(<PayInvoiceCard payment={payment} />);
    expect(screen.getByRole('button', { name: /by card/ })).toBeTruthy();
    expect(screen.queryByText('EG00 0000 0000 0000')).toBeNull();
    expect(screen.queryByRole('button', { name: 'I have paid' })).toBeNull();
    expect(screen.getByText(/Bank transfer is not available for this invoice/)).toBeTruthy();
    expect(state.bankEnabled.every((e) => e === false)).toBe(true);
  });

  it('offers bank transfer with the details and the report form while card payment is off', () => {
    state.methods = { data: { card: false, bank_transfer: true, bank_transfer_reason: 'cards_off' }, isLoading: false };
    state.bank = { data: account, isLoading: false, isError: false };
    render(<PayInvoiceCard payment={payment} />);
    expect(screen.queryByRole('button', { name: /by card/ })).toBeNull();
    expect(screen.getByText('EG00 0000 0000 0000')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I have paid' })).toBeTruthy();
    expect(screen.getByText(/Card payment \(Visa, Mastercard\) is not available yet/)).toBeTruthy();
  });

  it('offers both ways when the administrator allowed bank transfer for the company', () => {
    state.methods = { data: { card: true, bank_transfer: true, bank_transfer_reason: 'company' }, isLoading: false };
    state.bank = { data: account, isLoading: false, isError: false };
    render(<PayInvoiceCard payment={payment} />);
    expect(screen.getByRole('button', { name: /by card/ })).toBeTruthy();
    expect(screen.getByText('EG00 0000 0000 0000')).toBeTruthy();
    expect(screen.getByText('Or pay by bank transfer')).toBeTruthy();
    expect(screen.getByText(/allowed bank transfer for your company/)).toBeTruthy();
  });

  it('says that the platform pays the consultant, and says nothing of it for an invoice without a consultant', () => {
    state.methods = { data: { card: true, bank_transfer: false, bank_transfer_reason: null }, isLoading: false };
    const { rerender } = render(<PayInvoiceCard payment={payment} />);
    expect(screen.getByText(/pays the consultant within 15 business days/)).toBeTruthy();
    rerender(<PayInvoiceCard payment={{ ...payment, consultant: 'Unassigned' }} />);
    expect(screen.queryByText(/pays the consultant within 15 business days/)).toBeNull();
  });

  it('does not show the bank details when the ways to pay could not be loaded', () => {
    state.methods = { data: undefined, isLoading: false };
    state.bank = { data: account, isLoading: false, isError: false };
    render(<PayInvoiceCard payment={payment} />);
    expect(screen.getByText(/could not load the ways to pay/)).toBeTruthy();
    expect(screen.queryByText('EG00 0000 0000 0000')).toBeNull();
  });
});
