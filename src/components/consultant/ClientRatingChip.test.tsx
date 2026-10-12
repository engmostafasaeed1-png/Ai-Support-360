import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

import ClientRatingChip from './ClientRatingChip';
import { useClientRatingSummaries } from '@/hooks/useClientRatings';

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => rpc.mockReset());

describe('ClientRatingChip', () => {
  it('shows stars and the count', () => {
    render(<ClientRatingChip clientId="u1" summary={{ client_id: 'u1', avg_score: 4.5, review_count: 3, communication_avg: null, clarity_avg: null, cooperation_avg: null, would_work_again_pct: null }} />, { wrapper: wrap });
    expect(screen.getAllByTestId('rating-star')).toHaveLength(5);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Client rating')).toBeTruthy();
  });

  it('shows the new client text without ratings', () => {
    render(<ClientRatingChip clientId="u1" summary={null} />, { wrapper: wrap });
    expect(screen.getByText('New client: no ratings yet')).toBeTruthy();
  });

  it('the hook asks the RPC once for a whole list', async () => {
    rpc.mockResolvedValue({ data: [{ client_id: 'b', avg_score: '4.00', review_count: 2 }], error: null });
    const { result } = renderHook(() => useClientRatingSummaries(['b', 'a', 'b']), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('client_rating_summaries', { _client_ids: ['a', 'b'] });
    expect(result.current.data!.get('b')!.avg_score).toBe(4);
  });
});
