import { describe, it, expect } from 'vitest';
import { deadlineFromOption, compareBids, comparisonHighlights, declinePayload, counterArgs, counterProblem, bidsTabState, biddingStatus } from './clientBidding';
const now = Date.parse('2026-10-12T16:52:00Z');
const bid = (id: string, extra = {}) => ({ id, ticket_id: 't', consultant_id: id, version: 1, status: 'pending', proposed_rate: 100, estimated_hours: 2, timeline_days: 5, created_at: '2026-10-12T10:00:00Z', ...extra });
describe('client bidding rules', () => {
  it.each([['24', 24], ['48', 48], ['72', 72], ['168', 168]] as const)('calculates %s hours from now', (option, hours) => expect(Date.parse(deadlineFromOption(option, now) || '') - now).toBe(hours * 3600000));
  it('keeps no deadline null', () => expect(deadlineFromOption('none', now)).toBeNull());
  it('lists the latest pending version only and hides superseded bids', () => {
    expect(compareBids([bid('old', { consultant_id: 'c', status: 'withdrawn', rejection_reason: 'superseded' }), bid('new', { consultant_id: 'c', version: 2 }), bid('declined', { status: 'rejected' })]).map(b => b.id)).toEqual(['new']);
    expect(compareBids([bid('old', { rejection_reason: 'superseded' })])).toEqual([]);
  });
  const rows = [bid('cheap', { proposed_rate: 50, estimated_hours: 1, consultant_rating: 2, timeline_days: 7 }), bid('short', { proposed_rate: 80, estimated_hours: 2, shortlisted: true, timeline_days: 2, consultant_rating: 5, created_at: '2026-10-12T12:00:00Z' }), bid('expensive', { proposed_rate: 60, estimated_hours: 10, consultant_rating: 3 })];
  it('sorts shortlisted first, then lowest total', () => expect(compareBids(rows).map(b => b.id)).toEqual(['short', 'cheap', 'expensive']));
  it.each([['rate', ['cheap', 'expensive', 'short']], ['total', ['cheap', 'short', 'expensive']], ['timeline', ['short', 'expensive', 'cheap']], ['rating', ['short', 'expensive', 'cheap']], ['newest', ['short', 'cheap', 'expensive']]] as const)('sorts by %s', (sort, ids) => expect(compareBids(rows, sort).map(b => b.id)).toEqual(ids));
  it('filters shortlist and reverses rate sorting', () => { expect(compareBids(rows, 'default', true).map(b => b.id)).toEqual(['short']); expect(compareBids(rows, 'rate', false, true).map(b => b.id)).toEqual(['short', 'expensive', 'cheap']); });
  it('computes lowest total and fastest concrete values', () => expect(comparisonHighlights(rows)).toEqual({ lowest: 50, fastest: 2 }));
  it('uses selected decline sentence when no text is entered', () => expect(declinePayload('p', 'Price is too high', '')).toEqual({ id: 'p', status: 'rejected', rejection_reason: 'Price is too high' }));
  it('uses optional decline text and caps it at 300 characters', () => { expect(declinePayload('p', 'Other', ' Specific reason ').rejection_reason).toBe('Specific reason'); expect(declinePayload('p', 'Other', 'a'.repeat(301)).rejection_reason).toHaveLength(300); });
  it('builds exact counter RPC arguments', () => expect(counterArgs({ proposalId: 'p', rate: 80, hours: 3, days: 2, message: ' hello ' })).toEqual({ _proposal_id: 'p', _rate: 80, _hours: 3, _days: 2, _message: 'hello' }));
  it('allows only one counter round', () => expect(counterProblem({ proposalId: 'p', rate: 80, hours: 3, days: 2, message: '' }, true)).toBe('Only one counter-offer is allowed per consultant and request.'));
  it('validates rate, hours, days and 1000-character messages', () => { const input = { proposalId: 'p', rate: 80, hours: 3, days: 2, message: '' }; expect(counterProblem(input)).toBeNull(); for (const extra of [{ rate: 0 }, { hours: -1 }, { days: 1.5 }, { message: 'a'.repeat(1001) }]) expect(counterProblem({ ...input, ...extra })).not.toBeNull(); });
  it('makes the tab visible for open, existing or closed bidding, counting only live pending versions', () => { expect(bidsTabState({}, []).visible).toBe(false); expect(bidsTabState({ open_for_bids: true }, []).visible).toBe(true); expect(bidsTabState({ bidding_closed_reason: 'manual' }, []).visible).toBe(true); expect(bidsTabState({}, [bid('p')], 2)).toEqual({ visible: true, pending: 1, unanswered: 2 }); expect(bidsTabState({}, [bid('old', { consultant_id: 'c', rejection_reason: 'superseded', status: 'withdrawn' }), bid('new', { consultant_id: 'c', version: 2 })]).pending).toBe(1); });
  it('produces open status', () => expect(biddingStatus({ open_for_bids: true }, 2, 3, now)).toBe('Bidding is open: 3 bids so far'));
  it.each(['deadline', 'manual'])('produces %s closed status', reason => { const date = '2026-10-12T15:00:00Z'; expect(biddingStatus({ bidding_closed_reason: reason, bidding_closed_at: date }, 2, 3, now)).toBe(`Bidding closed on ${new Date(date).toLocaleString()}: 2 bids are waiting for your decision.`); });
  it('treats a passed deadline as closed before the scheduled job', () => { const date = '2026-10-12T15:00:00Z'; expect(biddingStatus({ open_for_bids: true, bid_deadline: date }, 2, 3, now)).toBe(`Bidding closed on ${new Date(date).toLocaleString()}: 2 bids are waiting for your decision.`); });
  it('produces assigned and empty statuses', () => { expect(biddingStatus({ consultant_id: 'c' }, 0, 1, now)).toBe('A consultant was chosen.'); expect(biddingStatus({}, 0, 0, now)).toBe('No bids yet.'); });
});
