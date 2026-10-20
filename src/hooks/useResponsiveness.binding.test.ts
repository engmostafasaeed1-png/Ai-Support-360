import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const { calls, client } = vi.hoisted(() => {
  const calls: Array<{ fn: string; self: unknown }> = [];
  const client = {
    rpc(this: unknown, fn: string) {
      calls.push({ fn, self: this });
      if (this !== client) throw new TypeError('detached');
      if (fn === 'responsiveness_public_config') return Promise.resolve({ data: { public: true, review_weight: 15 }, error: null });
      return Promise.resolve({ data: [{ consultant_id: 'c1', level: 'new', median_minutes: null, response_rate: null, stars: null }], error: null });
    },
  };
  return { calls, client };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: client }));
vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: true }) }));

import { usePublicResponsiveness } from './useResponsiveness';

describe('usePublicResponsiveness', () => {
  it('calls the backend as a method so the "show to clients" switch reaches consultant cards', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => usePublicResponsiveness(), { wrapper });
    await waitFor(() => expect(result.current.publicOn).toBe(true));
    expect(result.current.byId.get('c1')?.level).toBe('new');
    expect(calls.every((c) => c.self === client)).toBe(true);
  });
});
