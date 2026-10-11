import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  settings: { data: { cards: false } as unknown },
  companies: { data: [] as unknown[], isLoading: false, isError: false },
  log: { data: [] as unknown[], isLoading: false },
  mutate: vi.fn(),
}));

vi.mock('@/hooks/useBilling', () => ({
  usePaymentSettings: () => state.settings,
  useBankTransferCompanies: () => state.companies,
  useBankTransferLog: () => state.log,
  useSetCompanyBankTransfer: () => ({ mutate: state.mutate, isPending: false }),
}));

import BankTransferSettingsCard from './BankTransferSettingsCard';

const company = (over: Record<string, unknown> = {}) => ({
  id: 't1', name: 'Acme Ltd', allowed: false, note: null, grantedAt: null, openInvoices: 2, ...over,
});

beforeEach(() => {
  state.settings = { data: { cards: false } };
  state.companies = { data: [company()], isLoading: false, isError: false };
  state.log = { data: [], isLoading: false };
  state.mutate.mockReset();
});

afterEach(() => cleanup());

describe('BankTransferSettingsCard', () => {
  it('says that bank transfer is open for everybody while card payments are off', () => {
    render(<BankTransferSettingsCard />);
    expect(screen.getByText('Card payments are off')).toBeTruthy();
    expect(screen.getByText(/open for everybody/)).toBeTruthy();
  });

  it('says that bank transfer is only for the allowed companies when card payments are on', () => {
    state.settings = { data: { cards: true } };
    render(<BankTransferSettingsCard />);
    expect(screen.getByText('Card payments are on')).toBeTruthy();
    expect(screen.getByText(/open only for the companies and invoices that you allowed/)).toBeTruthy();
  });

  it('lists the companies with their open invoices', () => {
    state.companies = { data: [company(), company({ id: 't2', name: 'Globex', openInvoices: 0 })], isLoading: false, isError: false };
    render(<BankTransferSettingsCard />);
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByText('Globex')).toBeTruthy();
  });

  it('asks first, then allows the company with the note', () => {
    render(<BankTransferSettingsCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'Allow bank transfer for Acme Ltd' }));
    expect(screen.getByText('Allow bank transfer')).toBeTruthy();
    expect(state.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(/For example/), { target: { value: 'agreed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(state.mutate).toHaveBeenCalledWith({ tenantId: 't1', allowed: true, note: 'agreed' }, expect.anything());
  });

  it('stops a company that is allowed', () => {
    state.companies = { data: [company({ allowed: true, grantedAt: '2026-10-11T10:00:00Z' })], isLoading: false, isError: false };
    render(<BankTransferSettingsCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'Allow bank transfer for Acme Ltd' }));
    expect(screen.getByText('Stop bank transfer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(state.mutate).toHaveBeenCalledWith({ tenantId: 't1', allowed: false, note: '' }, expect.anything());
  });

  it('shows only the allowed companies on request', () => {
    state.companies = { data: [company({ allowed: true }), company({ id: 't2', name: 'Globex' })], isLoading: false, isError: false };
    render(<BankTransferSettingsCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show only the allowed companies' }));
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.queryByText('Globex')).toBeNull();
  });
});
