import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const sb = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: sb.rpc, auth: { getUser: sb.getUser }, channel: sb.channel, removeChannel: sb.removeChannel, functions: { invoke: vi.fn() } },
}));
vi.mock('@/contexts/GuestModeContext', () => ({ useGuestMode: () => ({ isGuest: false }) }));

import { useCriticalMyAlerts } from './useCriticalService';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const chain: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = { on: vi.fn(), subscribe: vi.fn() };
  chain.on.mockReturnValue(chain);
  chain.subscribe.mockReturnValue(chain);
  sb.rpc.mockReset();
  sb.rpc.mockResolvedValue({ data: [], error: null });
  sb.getUser.mockReset();
  sb.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  sb.channel.mockReset();
  sb.channel.mockReturnValue(chain);
  sb.removeChannel.mockReset();
});

afterEach(() => cleanup());

describe('useCriticalMyAlerts', () => {
  it('listens to the realtime channel of the alarm by default', async () => {
    renderHook(() => useCriticalMyAlerts(), { wrapper });
    await waitFor(() => expect(sb.channel).toHaveBeenCalledWith('critical-alerts-live'));
    expect(sb.getUser).toHaveBeenCalledTimes(1);
  });

  it('does not open a second channel when the caller says that the layout already holds it', async () => {
    renderHook(() => useCriticalMyAlerts({ realtime: false }), { wrapper });
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith('critical_my_alerts', {}));
    expect(sb.getUser).not.toHaveBeenCalled();
    expect(sb.channel).not.toHaveBeenCalled();
  });
});
