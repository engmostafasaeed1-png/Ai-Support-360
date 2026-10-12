import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: 'new-id', error: null })));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
import CounterOfferBanner from './CounterOfferBanner';

const counter = { id: 'k1', proposal_id: 'p1', ticket_id: 't1', proposed_rate: 90, estimated_hours: 10, timeline_days: 5, message: 'Can you do this?', status: 'pending' as const, created_at: '', responded_at: null, new_proposal_id: null };
const ui = (c = counter) => render(<QueryClientProvider client={new QueryClient()}><CounterOfferBanner counter={c} bid={{ proposed_rate: 100, estimated_hours: 12, timeline_days: 7 }} newVersion={3} /></QueryClientProvider>);

describe('CounterOfferBanner', () => {
  it('accepts with the right arguments', async () => {
    ui();
    expect(screen.getByText('Can you do this?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept counter-offer' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('respond_to_counter', { _counter_id: 'k1', _accept: true }));
  });
  it('declines with the right arguments', async () => {
    rpc.mockClear();
    ui();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('respond_to_counter', { _counter_id: 'k1', _accept: false }));
  });
  it('shows the answered states', () => {
    ui({ ...counter, status: 'accepted' as any });
    expect(screen.getByText("You accepted the client's counter-offer (new bid v3)")).toBeTruthy();
  });
});
