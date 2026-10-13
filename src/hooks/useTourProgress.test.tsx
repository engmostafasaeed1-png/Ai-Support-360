import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({ row: null as any, error: null as any, rpc: vi.fn(), selects: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const b: any = {};
      b.select = (c: string) => { h.selects.push(c); return b; };
      b.eq = () => b;
      b.maybeSingle = () => Promise.resolve({ data: h.row, error: h.error });
      return b;
    },
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}));

import { useTourProgress } from './useTourProgress';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => { h.row = null; h.error = null; h.rpc.mockReset(); h.rpc.mockResolvedValue({ error: null }); h.selects = []; });

describe('useTourProgress', () => {
  it('reads the row with explicit columns', async () => {
    h.row = { tour_key: 'consultant-welcome', tour_version: 1, last_step: 2, completed_at: null, skipped_at: null };
    const { result } = renderHook(() => useTourProgress('consultant-welcome'), { wrapper });
    await waitFor(() => expect(result.current.progress?.last_step).toBe(2));
    expect(h.selects[0]).toBe('tour_key, tour_version, last_step, completed_at, skipped_at');
  });

  it('returns null on a read error', async () => {
    h.error = { message: 'nope' };
    const { result } = renderHook(() => useTourProgress('consultant-welcome'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.progress).toBeNull();
  });

  it('saves and resets through the RPCs, and survives errors', async () => {
    const { result } = renderHook(() => useTourProgress('consultant-welcome'), { wrapper });
    await act(async () => { await result.current.save(4, 'in_progress'); });
    expect(h.rpc).toHaveBeenCalledWith('save_tour_progress', { _key: 'consultant-welcome', _version: 1, _last_step: 4, _status: 'in_progress' });
    await act(async () => { await result.current.reset(); });
    expect(h.rpc).toHaveBeenCalledWith('reset_tour_progress', { _key: 'consultant-welcome' });
    h.rpc.mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.save(1, 'skipped'); });
  });
});
