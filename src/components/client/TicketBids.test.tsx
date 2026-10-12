import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ accept: vi.fn(), shortlist: vi.fn() }));
const bid = { id: 'p', ticket_id: 't', consultant_id: 'c', version: 2, status: 'pending', proposed_rate: 100, estimated_hours: 3, timeline_days: 2, consultant_rating: 4, consultant_reviews: 1, consultant_name: 'Consultant Name', attachments: [], cover_letter: 'My approach', created_at: '2026-10-12T10:00:00Z' };
vi.mock('@/hooks/useClientBids', () => ({ useTicketBids: () => ({ data: { bids: [{ bid, history: [] }], counters: [] } }), useTicketQuestions: () => ({ data: [] }), useBiddingClock: () => Date.parse('2026-10-12T16:52:00Z'), useShortlist: () => ({ mutate: mocks.shortlist }), useCancelCounter: () => ({}), useCloseBidding: () => ({}), useSetDeadline: () => ({}), useCounterOffer: () => ({}), useDeclineBid: () => ({}), useAnswerQuestion: () => ({}), useHideQuestion: () => ({}) }));
vi.mock('@/hooks/useProposals', () => ({ useRespondToProposal: () => ({ mutate: mocks.accept }) }));
vi.mock('@/hooks/useCriticalService', () => ({ useCriticalView: () => ({ data: null }) }));
import TicketBids from './TicketBids';
describe('client bid actions', () => {
  it('confirms acceptance before calling the existing acceptance mutation', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TicketBids ticketId="t" ticket={{ open_for_bids: true }} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Bid details' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Accept bid' }));
    expect(mocks.accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept bid' }).at(-1) as HTMLElement);
    expect(mocks.accept.mock.calls[0][0]).toEqual({ proposalId: 'p', status: 'accepted' });
  });
  it('shortlists the live proposal', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><TicketBids ticketId="t" ticket={{ open_for_bids: true }} /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Bid details' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Shortlist' }));
    expect(mocks.shortlist.mock.calls[0][0]).toEqual({ id: 'p', shortlisted: true });
  });
});
