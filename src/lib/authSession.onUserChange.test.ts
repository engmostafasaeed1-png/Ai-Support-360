import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ listener: null as null | ((e: string, s: unknown) => void), unsub: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { onAuthStateChange: (cb: (e: string, s: unknown) => void) => { h.listener = cb; return { data: { subscription: { unsubscribe: h.unsub } } }; } } },
}));

import { onUserChange } from './authSession';

const s = (id: string | null) => (id ? { user: { id } } : null);

describe('onUserChange', () => {
  it('ignores the initial session and token refreshes, fires on a real account change', () => {
    const cb = vi.fn();
    const stop = onUserChange(cb);
    h.listener!('INITIAL_SESSION', s('u1'));
    h.listener!('TOKEN_REFRESHED', s('u1'));
    h.listener!('SIGNED_IN', s('u1'));            // tab focus re-emits SIGNED_IN for the same user
    expect(cb).not.toHaveBeenCalled();
    h.listener!('SIGNED_OUT', s(null));
    expect(cb).toHaveBeenLastCalledWith(null);
    h.listener!('SIGNED_IN', s('u2'));
    expect(cb).toHaveBeenLastCalledWith('u2');
    expect(cb).toHaveBeenCalledTimes(2);
    stop();
    expect(h.unsub).toHaveBeenCalled();
  });
  it('extra events refresh for the same account when asked', () => {
    const cb = vi.fn();
    onUserChange(cb, ['USER_UPDATED']);
    h.listener!('INITIAL_SESSION', s('u1'));
    h.listener!('USER_UPDATED', s('u1'));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
