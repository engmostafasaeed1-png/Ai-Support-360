import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock('sonner', () => ({ toast: { warning: mocks.warning, success: mocks.success, error: mocks.error } }));
import { useSetPayoutStatus } from './useBilling';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ error: null }); mocks.invoke.mockResolvedValue({ error: null, data: { sent: true } }); });
afterEach(cleanup);

describe('payout approval email trigger', () => {
  it.each(['processing', 'completed'] as const)('emails after the %s status succeeds', async (status) => {
    const { result } = renderHook(useSetPayoutStatus, { wrapper });
    await result.current.mutateAsync({ id: 'payout-1', status, bankReference: 'BANK-123' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_payout_status', { _payout_id: 'payout-1', _status: status, _bank_reference: 'BANK-123', _note: null });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('payout-approved-notify', { body: { payout_id: 'payout-1' } });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
  });
  it('does not email a rejected financial action', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'Not permitted' } });
    const { result } = renderHook(useSetPayoutStatus, { wrapper });
    await expect(result.current.mutateAsync({ id: 'payout-1', status: 'processing' })).rejects.toThrow('Not permitted');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each(['pending', 'failed'] as const)('does not email %s status', async (status) => {
    const { result } = renderHook(useSetPayoutStatus, { wrapper });
    await result.current.mutateAsync({ id: 'payout-1', status });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('preserves successful approval if email delivery fails', async () => {
    mocks.invoke.mockResolvedValue({ error: new Error('Email unavailable') });
    const { result } = renderHook(useSetPayoutStatus, { wrapper });
    await expect(result.current.mutateAsync({ id: 'payout-1', status: 'processing' })).resolves.toBeUndefined();
    expect(mocks.warning).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});