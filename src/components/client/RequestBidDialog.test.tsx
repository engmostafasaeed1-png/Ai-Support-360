import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    if (table === 'tickets') return { update: mocks.update };
    return { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }) };
  },
} }));
vi.mock('@/hooks/useClientBids', () => ({ useTicketBids: () => ({ data: { bids: [] } }) }));
import RequestBidDialog from './RequestBidDialog';
describe('public bidding deadline', () => {
  it('defaults to 72 hours and writes the selected deadline with open_for_bids', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T16:52:00Z'));
    mocks.update.mockReturnValue({ eq: mocks.eq }); mocks.eq.mockResolvedValue({ error: null });
    render(<QueryClientProvider client={new QueryClient()}><RequestBidDialog ticketId="t" ticketTitle="Test" isOpenForBids={false} open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.click(screen.getByText('Public bids'));
    fireEvent.click(screen.getByRole('button', { name: 'Open for Public Bids' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ open_for_bids: true, bid_deadline: '2026-10-15T16:52:00.000Z' });
    expect(mocks.eq).toHaveBeenCalledWith('id', 't'); vi.restoreAllMocks();
  });
});
