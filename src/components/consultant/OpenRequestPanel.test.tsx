import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({ rpcError: null as any }));
const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: 'q', error: state.rpcError })));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useClientRatings', () => ({ useClientRatingSummaries: () => ({ data: new Map(), isLoading: false }) }));
vi.mock('@/integrations/supabase/client', () => {
  const rows: Record<string, any[]> = {
    ticket_questions_public: [{ id: 'q1', ticket_id: 't1', question: 'Which system?', answer: 'S/4HANA 2023', created_at: '2026-10-01T00:00:00Z', answered_at: '2026-10-02T00:00:00Z' }],
    ticket_questions: [{ id: 'q2', ticket_id: 't1', question: 'Is there a test system?', answer: null, created_at: '2026-10-03T00:00:00Z', answered_at: null }],
    consultants: [{ id: 'c1', currency: 'USD' }],
  };
  const from = (t: string) => {
    const b: any = {};
    b.select = () => b; b.eq = () => b;
    b.order = () => Promise.resolve({ data: rows[t], error: null });
    b.maybeSingle = () => Promise.resolve({ data: rows[t][0], error: null });
    return b;
  };
  return { supabase: { from, rpc, auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) } } };
});
import OpenRequestPanel from './OpenRequestPanel';

const req = (deadline: string | null) => ({ id: 't1', title: 'GL issue', description: 'Balances do not match', sap_module: 'FI', open_for_bids: true, bid_deadline: deadline });
const ui = (deadline: string | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <OpenRequestPanel request={req(deadline)} open onOpenChange={() => {}} bidCount={2} actions={<button>Place a bid</button>} />
  </QueryClientProvider>,
);
const future = new Date(Date.now() + 3 * 864e5).toISOString();

describe('OpenRequestPanel', () => {
  it('shows answered questions without names and the own waiting question', async () => {
    ui(future);
    expect(await screen.findByText('Which system?')).toBeTruthy();
    expect(screen.getByText('S/4HANA 2023')).toBeTruthy();
    expect(await screen.findByText('Is there a test system?')).toBeTruthy();
    expect(screen.getByText("Waiting for the client's answer")).toBeTruthy();
    expect(screen.getByText('2 bids so far')).toBeTruthy();
  });

  it('hides the form and the buttons when bidding is closed', async () => {
    ui(new Date(Date.now() - 1000).toISOString());
    expect(await screen.findByText('Bidding is closed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send question' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Place a bid' })).toBeNull();
  });

  it('checks the length and sends the question', async () => {
    ui(future);
    const box = await screen.findByLabelText('Ask the client a question');
    fireEvent.change(box, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '  Which plant is affected?  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('ask_ticket_question', { _ticket_id: 't1', _question: 'Which plant is affected?' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Your question was sent to the client.'));
  });

  it('shows the database error', async () => {
    state.rpcError = { message: 'You can ask up to 5 questions on one request' };
    ui(future);
    fireEvent.change(await screen.findByLabelText('Ask the client a question'), { target: { value: 'One more question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You can ask up to 5 questions on one request'));
  });
});
