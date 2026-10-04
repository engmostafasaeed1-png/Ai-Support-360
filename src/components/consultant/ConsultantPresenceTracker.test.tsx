import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  track: vi.fn(),
  removeChannel: vi.fn(),
  unsubscribe: vi.fn(),
  getSession: vi.fn(),
  session: { current: null as null | { user: { id: string } } },
  consultant: { current: null as null | { id: string } },
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
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: mocks.consultant.current }) }),
      }),
    }),
    channel: (name: string, options: unknown) => {
      mocks.channel(name, options);
      const fake = {
        subscribe: (callback: (status: string) => void) => {
          callback('SUBSCRIBED');
          return fake;
        },
        track: mocks.track,
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
  mocks.unsubscribe.mockReset();
  mocks.getSession.mockReset();
  mocks.session.current = { user: { id: 'u-1' } };
  mocks.consultant.current = { id: 'c-1' };
  mocks.authCallback.current = null;
  mocks.isGuest.current = false;
});
afterEach(() => cleanup());

describe('ConsultantPresenceTracker', () => {
  it('joins the presence channel with the id of the consultant as the key and says that the consultant is there', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    expect(mocks.channel).toHaveBeenCalledWith('consultant-presence', { config: { presence: { key: 'c-1' } } });
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it('never joins for somebody who is not a consultant', async () => {
    mocks.consultant.current = null;
    render(<ConsultantPresenceTracker />);
    await settle();
    expect(mocks.getSession).toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('never joins when nobody is signed in', async () => {
    mocks.session.current = null;
    render(<ConsultantPresenceTracker />);
    await settle();
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('never joins in the demo for guests', async () => {
    mocks.isGuest.current = true;
    render(<ConsultantPresenceTracker />);
    await settle();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('leaves the channel and stops listening when it is removed', async () => {
    const { unmount } = render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('leaves the channel when the consultant signs out', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    mocks.authCallback.current?.('SIGNED_OUT', null);
    await waitFor(() => expect(mocks.removeChannel).toHaveBeenCalledTimes(1));
  });

  it('does not join a second time when the session of the same person is refreshed', async () => {
    render(<ConsultantPresenceTracker />);
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledTimes(1));
    mocks.authCallback.current?.('TOKEN_REFRESHED', { user: { id: 'u-1' } });
    await settle();
    expect(mocks.channel).toHaveBeenCalledTimes(1);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
  });
});
