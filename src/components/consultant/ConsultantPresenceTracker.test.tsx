import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { presenceStore } from '@/lib/presenceStore';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  track: vi.fn(),
  removeChannel: vi.fn(),
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  order: [] as string[],
  session: { current: null as null | { user: { id: string } } },
  consultants: { current: {} as Record<string, { id: string } | undefined> },
  state: { current: {} as Record<string, unknown[]> },
  sync: { current: null as null | (() => void) },
  authCallback: { current: null as null | ((event: string, session: unknown) => void) },
  isGuest: { current: false },
}));

vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: mocks.isGuest.current }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => {
        mocks.getSession();
        return Promise.resolve({ data: { session: mocks.session.current } });
      },
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        mocks.authCallback.current = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({ maybeSingle: () => Promise.resolve({ data: mocks.consultants.current[userId] ?? null }) }),
      }),
    }),
    channel: (name: string, options?: unknown) => {
      mocks.channel(name, options);
      const fake = {
        on: (_type: string, _filter: unknown, callback: () => void) => {
          mocks.order.push('on');
          mocks.sync.current = callback;
          return fake;
        },
        subscribe: (callback: (status: string) => void) => {
          mocks.order.push('subscribe');
          callback('SUBSCRIBED');
          return fake;
        },
        track: mocks.track,
        presenceState: () => mocks.state.current,
      };
      return fake;
    },
    removeChannel: mocks.removeChannel,
  },
}));

import ConsultantPresenceTracker from './ConsultantPresenceTracker';

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

beforeEach(() => {
  mocks.channel.mockReset();
  mocks.track.mockReset();
  mocks.removeChannel.mockReset();
  mocks.removeChannel.mockResolvedValue('ok');
  mocks.unsubscribe.mockReset();
  mocks.getSession.mockReset();
  mocks.order.length = 0;
  mocks.session.current = { user: { id: 'u-1' } };
  mocks.consultants.current = { 'u-1': { id: 'c-1' } };
  mocks.state.current = {};
  mocks.sync.current = null;
  mocks.authCallback.current = null;
  mocks.isGuest.current = false;
  presenceStore.set(null);
});
afterEach(() => cleanup());

describe('ConsultantPresenceTracker', () => {
  it('joins with the id of the consultant as the key, listens first and says that the consultant is there', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    expect(mocks.channel).toHaveBeenCalledWith('consultant-presence', { config: { presence: { key: 'c-1' } } });
    expect(mocks.order).toEqual(['on', 'subscribe']);
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('saves who is present when the channel answers', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    act(() => {
      mocks.state.current = { 'c-1': [{ at: 'x' }], 'c-7': [{ at: 'y' }] };
      mocks.sync.current?.();
    });
    expect(Array.from(presenceStore.get() ?? []).sort()).toEqual(['c-1', 'c-7']);
  });

  it('only listens, without a key and without saying anything, for somebody who is signed in but is not a consultant', async () => {
    mocks.consultants.current = {};
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    expect(mocks.channel).toHaveBeenCalledWith('consultant-presence', undefined);
    expect(mocks.track).not.toHaveBeenCalled();
    act(() => {
      mocks.state.current = { 'c-9': [{ at: 'x' }] };
      mocks.sync.current?.();
    });
    expect(Array.from(presenceStore.get() ?? [])).toEqual(['c-9']);
  });

  it('does nothing when nobody is signed in', async () => {
    mocks.session.current = null;
    render(<ConsultantPresenceTracker />);
    await settle();
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(presenceStore.get()).toBeNull();
  });

  it('does nothing in the demo for guests', async () => {
    mocks.isGuest.current = true;
    render(<ConsultantPresenceTracker />);
    await settle();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('leaves the channel, stops listening and forgets who is present when it is removed', async () => {
    const { unmount } = render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    act(() => {
      mocks.state.current = { 'c-1': [{ at: 'x' }] };
      mocks.sync.current?.();
    });
    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(presenceStore.get()).toBeNull();
  });

  it('leaves the channel when the person signs out', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    mocks.authCallback.current?.('SIGNED_OUT', null);
    await waitFor(() => expect(mocks.removeChannel).toHaveBeenCalledTimes(1));
    expect(presenceStore.get()).toBeNull();
  });

  it('does not join a second time when the session of the same person is refreshed', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    mocks.authCallback.current?.('TOKEN_REFRESHED', { user: { id: 'u-1' } });
    await settle();
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
  });

  it('leaves the old channel and joins with the other key when somebody else signs in', async () => {
    mocks.consultants.current = { 'u-1': { id: 'c-1' }, 'u-2': { id: 'c-2' } };
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    mocks.authCallback.current?.('SIGNED_IN', { user: { id: 'u-2' } });
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(2));
    expect(mocks.channel).toHaveBeenLastCalledWith('consultant-presence', { config: { presence: { key: 'c-2' } } });
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });
});
