import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import { useAdminEmailCount } from './useAdminEmailCount';
afterEach(cleanup);
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
describe('administrator email count', () => {
  it('reads accepted emails through the admin-only counter', async () => {
    rpc.mockResolvedValue({ data: 12, error: null });
    const { result } = renderHook(useAdminEmailCount, { wrapper });
    await waitFor(() => expect(result.current.data).toBe(12));
    expect(rpc).toHaveBeenCalledWith('admin_notification_email_count');
  });
  it('does not disguise a failed count as zero', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const { result } = renderHook(useAdminEmailCount, { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});