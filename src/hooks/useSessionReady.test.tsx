import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({ listener: null as null | ((e: string, s: unknown) => void) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        h.listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

const { useSessionReady } = await vi.importActual<typeof import('./useSessionReady')>('./useSessionReady');
import { hasActiveSession } from '@/lib/sessionState';

describe('useSessionReady', () => {
  it('is not ready first, then follows the sign-in', async () => {
    const { result } = renderHook(() => useSessionReady());
    expect(result.current).toEqual({ ready: false, signedIn: false });
    await act(async () => {});
    expect(result.current).toEqual({ ready: true, signedIn: false });
    act(() => h.listener!('SIGNED_IN', { user: { id: 'u' } }));
    expect(result.current).toEqual({ ready: true, signedIn: true });
    expect(hasActiveSession()).toBe(true);
    act(() => h.listener!('SIGNED_OUT', null));
    expect(result.current.signedIn).toBe(false);
  });
});
