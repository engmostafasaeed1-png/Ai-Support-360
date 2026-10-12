import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: [{ ticket_id: 'b', bids: 3 }], error: null })));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { useTicketBidCounts } from './useBidding';

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe('useTicketBidCounts', () => {
  it('asks once for the whole list with sorted unique ids', async () => {
    const { result } = renderHook(() => useTicketBidCounts(['b', 'a', 'b']), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ticket_bid_counts', { _ticket_ids: ['a', 'b'] });
    expect(result.current.data!.get('b')).toBe(3);
  });
});
