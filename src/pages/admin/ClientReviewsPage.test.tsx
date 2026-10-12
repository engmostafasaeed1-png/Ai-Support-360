import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: null })));
const rows = vi.hoisted(() => ({
  client_reviews: [
    { id: 'r1', ticket_id: 't1', consultant_id: 'c1', client_id: 'u1', score: 2, communication_score: null, clarity_score: null, cooperation_score: null, would_work_again: false, comment: 'slow', hidden: false, hidden_reason: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 'r2', ticket_id: 't1', consultant_id: 'c1', client_id: 'u1', score: 1, communication_score: null, clarity_score: null, cooperation_score: null, would_work_again: null, comment: null, hidden: true, hidden_reason: 'abusive', created_at: '2026-10-02T00:00:00Z' },
  ],
  tickets: [{ id: 't1', title: 'Fix MM' }],
  consultants: [{ id: 'c1', user_id: 'cu1' }],
  client_profiles: [],
  profile_directory: [{ user_id: 'u1', display_name: 'Acme' }, { user_id: 'cu1', display_name: 'Sara' }],
} as Record<string, any[]>));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from: (t: string) => {
      const res = Promise.resolve({ data: rows[t], error: null });
      const b: any = { select: () => b, in: () => res, order: () => res };
      return b;
    },
  },
}));
import ClientReviewsPage from './ClientReviewsPage';

const ui = () => render(<QueryClientProvider client={new QueryClient()}><ClientReviewsPage /></QueryClientProvider>);

describe('ClientReviewsPage', () => {
  it('hides a review with a reason', async () => {
    ui();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'contact details' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' }).at(-1)!);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_hide_client_review', { _review_id: 'r1', _hidden: true, _reason: 'contact details' }));
  });

  it('shows a hidden review again', async () => {
    rpc.mockClear();
    ui();
    await screen.findByText('Sara');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'All' }));
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show again' }));
    expect(screen.getByText('abusive')).toBeTruthy();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_hide_client_review', { _review_id: 'r2', _hidden: false, _reason: null }));
  });
});
