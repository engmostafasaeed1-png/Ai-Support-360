import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  methods: { data: undefined as unknown, isLoading: false },
  grants: { data: {} as Record<string, unknown> },
  accounts: { data: {} as Record<string, unknown> },
  settings: { data: { bank: {} } as unknown },
  setTransfer: vi.fn(),
  setAccount: vi.fn(),
}));

vi.mock('@/hooks/useBilling', () => ({
  usePaymentMethods: () => state.methods,
  useInvoiceBankGrants: () => state.grants,
  useInvoiceBankAccounts: () => state.accounts,
  usePaymentSettings: () => state.settings,
  useSetInvoiceBankTransfer: () => ({ mutate: state.setTransfer, isPending: false }),
  useSetInvoiceBankAccount: () => ({ mutate: state.setAccount, isPending: false }),
}));

import InvoiceBankControls from './InvoiceBankControls';

const invoice = { id: 'p1', status: 'pending', invoice_number: 'INV-2026-000015', amount: 396.75, currency: 'USD', client_name: 'Acme Ltd' };

beforeEach(() => {
  state.methods = { data: { card: true, bank_transfer: false, bank_transfer_reason: null }, isLoading: false };
  state.grants = { data: {} };
  state.accounts = { data: {} };
  state.settings = { data: { bank: { beneficiary: 'Platform Co', iban: 'EG99 1111' } } };
  state.setTransfer.mockReset();
  state.setAccount.mockReset();
});

afterEach(() => cleanup());

describe('InvoiceBankControls', () => {
  it('says why the client can or can not pay this invoice by bank transfer', () => {
    render(<InvoiceBankControls invoice={invoice} onClose={() => {}} />);
    expect(screen.getByText(/the client can pay by card only/)).toBeTruthy();
    cleanup();
    state.methods = { data: { card: false, bank_transfer: true, bank_transfer_reason: 'cards_off' }, isLoading: false };
    render(<InvoiceBankControls invoice={invoice} onClose={() => {}} />);
    expect(screen.getByText(/open for everybody/)).toBeTruthy();
  });

  it('can not change an invoice that is not open', () => {
    render(<InvoiceBankControls invoice={{ ...invoice, status: 'completed' }} onClose={() => {}} />);
    expect(screen.getByText(/not open any more/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save the account of this invoice' })).toBeNull();
  });

  it('allows bank transfer for the invoice', () => {
    render(<InvoiceBankControls invoice={invoice} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Allow bank transfer for this invoice' }));
    expect(state.setTransfer).toHaveBeenCalledWith({ paymentId: 'p1', allowed: true, note: '' });
  });

  it('saves an own account only with the account holder and an IBAN or an account number', () => {
    render(<InvoiceBankControls invoice={invoice} onClose={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save the account of this invoice' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: ' Qurtuba Tech ' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: 'EG11 2222' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(state.setAccount).toHaveBeenCalledWith({ paymentId: 'p1', details: { beneficiary: 'Qurtuba Tech', iban: 'EG11 2222' }, note: '' });
  });

  it('fills the form from the platform account on request', () => {
    render(<InvoiceBankControls invoice={invoice} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start from the platform account' }));
    expect((screen.getByLabelText('Account holder') as HTMLInputElement).value).toBe('Platform Co');
    expect((screen.getByLabelText('IBAN') as HTMLInputElement).value).toBe('EG99 1111');
  });

  it('lets an invoice with its own account use the platform account again', () => {
    state.accounts = { data: { p1: { details: { beneficiary: 'Own Co', iban: 'EG55 3333' }, note: null, set_at: '2026-10-11T10:00:00Z' } } };
    render(<InvoiceBankControls invoice={invoice} onClose={() => {}} />);
    expect((screen.getByLabelText('Account holder') as HTMLInputElement).value).toBe('Own Co');
    fireEvent.click(screen.getByRole('button', { name: 'Use the platform account again' }));
    expect(state.setAccount).toHaveBeenCalledWith({ paymentId: 'p1', details: null, note: '' });
  });
});
