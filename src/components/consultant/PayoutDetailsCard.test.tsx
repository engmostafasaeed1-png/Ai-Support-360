import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({
  row: null as any,
  selects: [] as string[],
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const b: any = {};
    b.select = (cols: string) => { h.selects.push(`${table}:${cols}`); return b; };
    b.eq = () => b;
    b.maybeSingle = () => Promise.resolve({ data: table === 'consultants' ? { id: 'c1' } : h.row, error: null });
    return b;
  };
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: (t: string) => chain(t),
      rpc: (...a: unknown[]) => h.rpc(...a),
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import PayoutDetailsCard, { REVEAL_MS } from './PayoutDetailsCard';

const saved = {
  account_holder: 'Jane Doe', bank_name: 'Test Bank', iban: 'GB82WEST12345698765432', account_number: null,
  swift_bic: 'WESTGB22', country: 'UK', currency: 'GBP', notes: null, verified_at: null,
  acknowledged_at: '2026-10-01T10:00:00Z', acknowledged_version: 'v1', updated_at: '2026-10-01T10:00:00Z',
};

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PayoutDetailsCard />
  </QueryClientProvider>,
);

beforeEach(() => { h.row = null; h.selects = []; h.rpc.mockReset(); h.rpc.mockResolvedValue({ error: null }); vi.mocked(toast.error).mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('PayoutDetailsCard', () => {
  it('shows the values masked by default, reveals them and hides them again after 30 seconds', async () => {
    h.row = saved;
    renderCard();
    expect(await screen.findByText('GB•• •••• •••• •••• 5432')).toBeTruthy();
    expect(screen.queryByText('GB82WEST12345698765432')).toBeNull();
    expect(screen.getByText(/Private: visible only to you/)).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Show full details/ }));
    expect(screen.getByText('GB82WEST12345698765432')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(REVEAL_MS); });
    expect(screen.queryByText('GB82WEST12345698765432')).toBeNull();
    expect(screen.getByText('GB•• •••• •••• •••• 5432')).toBeTruthy();
  });

  it('never selects every column', async () => {
    h.row = saved;
    renderCard();
    await screen.findByText('Jane Doe');
    expect(h.selects.some((s) => s.endsWith(':*'))).toBe(false);
    expect(h.selects.find((s) => s.startsWith('consultant_payout_details:'))).toContain('acknowledged_version');
  });

  it('requires the checkbox, then sends the RPC payload', async () => {
    renderCard();
    await screen.findByText(/Before you save, please read and confirm/);
    fill(/Account holder/, 'Jane Doe');
    fill(/^Bank \*/, 'Test Bank');
    fill(/^IBAN/, 'GB82WEST12345698765432');
    const saveBtn = screen.getByRole('button', { name: 'Save bank details' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(h.rpc).toHaveBeenCalledWith('save_payout_details', {
      _account_holder: 'Jane Doe', _bank_name: 'Test Bank', _iban: 'GB82WEST12345698765432', _account_number: '',
      _swift_bic: '', _country: '', _currency: 'USD', _notes: '', _acknowledged: true, _ack_version: 'v1',
    });
  });

  it('shows the IBAN error and keeps saving disabled', async () => {
    renderCard();
    await screen.findByText(/Before you save/);
    fill(/Account holder/, 'Jane Doe');
    fill(/^Bank \*/, 'Test Bank');
    fill(/^IBAN/, 'GB82WEST12345698765433');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('The IBAN is not valid: check the letters and digits')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save bank details' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the account-number rule next to the field and keeps saving disabled', async () => {
    renderCard();
    await screen.findByText(/Before you save/);
    fill(/Account holder/, 'Jane Doe');
    fill(/^Bank \*/, 'Test Bank');
    fill(/Account number/, '12');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('The account number must have 4 to 34 letters, digits or dashes')).toBeTruthy();
    expect(screen.getByLabelText(/Account number/).getAttribute('aria-invalid')).toBe('true');
    const saveBtn = screen.getByRole('button', { name: 'Save bank details' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fill(/Account number/, '12_34');
    expect(screen.getByText('The account number must have 4 to 34 letters, digits or dashes')).toBeTruthy();
    fill(/Account number/, '1234-5678');
    expect(screen.queryByText('The account number must have 4 to 34 letters, digits or dashes')).toBeNull();
    expect(saveBtn.disabled).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('asks for the disclaimer next to the checkbox when everything else is valid', async () => {
    renderCard();
    await screen.findByText(/Before you save/);
    fill(/Account holder/, 'Jane Doe');
    fill(/^Bank \*/, 'Test Bank');
    fill(/Account number/, '12345678');
    expect(screen.getByText('Please read the disclaimer and confirm it before saving your bank details')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByText('Please read the disclaimer and confirm it before saving your bank details')).toBeNull();
  });

  it('shows the database message in a toast', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'Too many attempts. Please wait a while and try again.' } });
    renderCard();
    await screen.findByText(/Before you save/);
    fill(/Account holder/, 'Jane Doe');
    fill(/^Bank \*/, 'Test Bank');
    fill(/Account number/, '12345678');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save bank details' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many attempts. Please wait a while and try again.'));
  });

  it('opens editing with the checkbox unticked', async () => {
    h.row = saved;
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Edit details/ }));
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  });
});

describe('public consultant profile', () => {
  it('never reads the bank details table', () => {
    for (const f of ['src/pages/client/ConsultantProfilePage.tsx', 'src/pages/client/ConsultantsPage.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toContain('consultant_payout_details');
      expect(readFileSync(f, 'utf8')).not.toContain('PayoutDetailsCard');
    }
  });
});
