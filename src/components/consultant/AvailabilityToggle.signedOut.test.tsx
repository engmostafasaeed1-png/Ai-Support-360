import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(() => { throw new Error('must not query without a user'); }),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis(), unsubscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

import AvailabilityToggle from './AvailabilityToggle';

describe('AvailabilityToggle without a session', () => {
  it('answers null (no consultant row) instead of failing', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AvailabilityToggle /></QueryClientProvider>);
    await waitFor(() => expect(qc.getQueryState(['my-consultant-availability'])?.status).toBe('success'));
    expect(qc.getQueryData(['my-consultant-availability'])).toBeNull();
  });
});
