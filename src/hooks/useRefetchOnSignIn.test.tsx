import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const listeners: ((event: string) => void)[] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

import { useRefetchOnSignIn } from './useRefetchOnSignIn';

describe('useRefetchOnSignIn', () => {
  it('invalidates the availability queries once on SIGNED_IN only', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useRefetchOnSignIn(), { wrapper });
    expect(listeners).toHaveLength(1);
    listeners[0]('TOKEN_REFRESHED');
    expect(spy).not.toHaveBeenCalled();
    listeners[0]('SIGNED_IN');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-consultant-availability'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['my-availability-slots'] });
  });
});
