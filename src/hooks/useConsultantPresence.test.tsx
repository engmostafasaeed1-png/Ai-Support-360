import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  removeChannel: vi.fn(),
  state: { current: {} as Record<string, unknown[]> },
  sync: { current: null as null | (() => void) },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: (name: string) => {
      mocks.channel(name);
      const fake = {
        on: (_type: string, _filter: unknown, callback: () => void) => {
          mocks.sync.current = callback;
          return fake;
        },
        subscribe: () => fake,
        presenceState: () => mocks.state.current,
      };
      return fake;
    },
    removeChannel: mocks.removeChannel,
  },
}));

import { useConsultantPresence } from './useConsultantPresence';

function Probe({ enabled = true }: { enabled?: boolean }) {
  const present = useConsultantPresence(enabled);
  return <div data-testid="probe">{present === null ? 'unknown' : Array.from(present).sort().join(',') || 'nobody'}</div>;
}

beforeEach(() => {
  mocks.channel.mockReset();
  mocks.removeChannel.mockReset();
  mocks.state.current = {};
  mocks.sync.current = null;
});
afterEach(() => cleanup());

describe('useConsultantPresence', () => {
  it('does not know who is present before the channel has answered', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('unknown');
    expect(mocks.channel).toHaveBeenCalledWith('consultant-presence');
  });

  it('knows who is present once the channel has answered, and follows the changes', () => {
    render(<Probe />);
    act(() => {
      mocks.state.current = { 'c-2': [{ at: 'x' }], 'c-1': [{ at: 'y' }] };
      mocks.sync.current?.();
    });
    expect(screen.getByTestId('probe').textContent).toBe('c-1,c-2');
    act(() => {
      mocks.state.current = {};
      mocks.sync.current?.();
    });
    expect(screen.getByTestId('probe').textContent).toBe('nobody');
  });

  it('leaves the channel when the page is left', () => {
    const { unmount } = render(<Probe />);
    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('does not join the channel when it is not enabled', () => {
    render(<Probe enabled={false} />);
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toBe('unknown');
  });
});
