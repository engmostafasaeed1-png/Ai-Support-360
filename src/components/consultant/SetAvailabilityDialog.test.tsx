import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const inserted = vi.fn();
const slots = [{ id: 's1', day_of_week: 1, specific_date: null, start_time: '09:00:00', end_time: '12:00:00' }];

vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: true }) }));
vi.mock('@/hooks/useProfileAutosaveReady', () => ({ useProfileAutosaveReady: () => ({ data: false }) }));
vi.mock('./saving/ProfileImportance', () => ({ useProfileSavePrompt: () => undefined }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table: string) => {
      if (table === 'consultants') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'c1' }, error: null }) }) }) };
      return {
        select: () => {
          const chain = { eq: () => chain, order: () => chain, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: slots, error: null }).then(r) };
          return chain;
        },
        insert: (row: unknown) => {
          inserted(row);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-row' }, error: null }) }) };
        },
      };
    },
  },
}));

import SetAvailabilityDialog from './SetAvailabilityDialog';

describe('SetAvailabilityDialog', () => {
  it('lets the consultant save new slots after closing and reopening without changes', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><SetAvailabilityDialog trigger={<button>Open availability</button>} /></QueryClientProvider>);

    fireEvent.click(screen.getByText('Open availability'));
    await screen.findByText(/09:00 – 12:00/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByText(/09:00 – 12:00/)).toBeNull());

    fireEvent.click(screen.getByText('Open availability'));
    await screen.findByText(/09:00 – 12:00/);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Add time slot/ }));

    const save = await screen.findByRole('button', { name: /save/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() => expect(inserted).toHaveBeenCalledWith(expect.objectContaining({ consultant_id: 'c1', start_time: '13:00', end_time: '15:00' })));
  });
});
