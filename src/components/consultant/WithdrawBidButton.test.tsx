import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls = vi.hoisted(() => ({ update: [] as any[], eq: [] as any[] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ update: (p: any) => { calls.update.push(p); return { eq: (...a: any[]) => { calls.eq.push(a); return Promise.resolve({ error: null }); } }; } }) },
}));
import WithdrawBidButton from './WithdrawBidButton';

describe('WithdrawBidButton', () => {
  it('asks first, then withdraws the bid', async () => {
    render(<QueryClientProvider client={new QueryClient()}><WithdrawBidButton bidId="p9" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw bid' }));
    expect(await screen.findByText('Withdraw this bid? The client will be told.')).toBeTruthy();
    expect(calls.update).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Withdraw bid' }).at(-1)!);
    await waitFor(() => expect(calls.update).toEqual([{ status: 'withdrawn' }]));
    expect(calls.eq[0]).toEqual(['id', 'p9']);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bid withdrawn.'));
  });
});
