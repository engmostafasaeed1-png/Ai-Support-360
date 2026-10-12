import { latestBids, type BidRow } from './bidding';

export type DeadlineOption = '24' | '48' | '72' | '168' | 'none';
export const deadlineOptions: { value: DeadlineOption; label: string }[] = [
  { value: '24', label: '24 hours' }, { value: '48', label: '48 hours' },
  { value: '72', label: '72 hours' }, { value: '168', label: '7 days' }, { value: 'none', label: 'No deadline' },
];
export function deadlineFromOption(option: DeadlineOption, now = Date.now()): string | null {
  return option === 'none' ? null : new Date(now + Number(option) * 3_600_000).toISOString();
}
export interface ComparisonBid extends BidRow {
  proposed_rate: number; estimated_hours: number; timeline_days: number;
  consultant_rating?: number; shortlisted?: boolean;
}
export type ComparisonSort = 'default' | 'rate' | 'total' | 'timeline' | 'rating' | 'newest';
export const estimatedTotal = (bid: ComparisonBid) => Number(bid.proposed_rate) * Number(bid.estimated_hours || 0);
export function compareBids<T extends ComparisonBid>(rows: T[], sort: ComparisonSort = 'default', shortlistOnly = false, descending = false): T[] {
  const bids = latestBids(rows).map(r => r.bid).filter(b => b.status === 'pending' && b.rejection_reason !== 'superseded' && (!shortlistOnly || b.shortlisted));
  const compare = (a: T, b: T) => {
    switch (sort) {
      case 'rate': return Number(a.proposed_rate) - Number(b.proposed_rate);
      case 'timeline': return Number(a.timeline_days) - Number(b.timeline_days);
      case 'rating': return Number(b.consultant_rating || 0) - Number(a.consultant_rating || 0);
      case 'newest': return Date.parse(b.created_at) - Date.parse(a.created_at);
      case 'total': return estimatedTotal(a) - estimatedTotal(b);
      default: return Number(!!b.shortlisted) - Number(!!a.shortlisted) || estimatedTotal(a) - estimatedTotal(b);
    }
  };
  return bids.sort((a, b) => (descending ? -1 : 1) * compare(a, b) || a.id.localeCompare(b.id));
}
export function comparisonHighlights(bids: ComparisonBid[]) {
  return { lowest: Math.min(...bids.map(estimatedTotal)), fastest: Math.min(...bids.map(b => Number(b.timeline_days))) };
}
export const declineReasons = ['Price is too high', 'Not enough experience', 'Timeline does not fit', 'Chose another consultant', 'Other'] as const;
export function declinePayload(id: string, reason: string, text: string) {
  const rejection_reason = (text.trim() || reason).slice(0, 300);
  return { id, status: 'rejected' as const, rejection_reason };
}
export interface CounterInput { proposalId: string; rate: number; hours: number; days: number; message: string }
export function counterProblem(input: CounterInput, hasCounter = false): string | null {
  if (hasCounter) return 'Only one counter-offer is allowed per consultant and request.';
  if (![input.rate, input.hours, input.days].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(input.days)) return 'Enter a positive rate, hours and whole timeline days.';
  if (input.message.trim().length > 1000) return 'A message can have at most 1000 characters.';
  return null;
}
export function counterArgs(input: CounterInput) {
  return { _proposal_id: input.proposalId, _rate: input.rate, _hours: input.hours, _days: input.days, _message: input.message.trim() || null };
}
export interface BiddingTicket { open_for_bids?: boolean; bid_deadline?: string | null; bidding_closed_at?: string | null; bidding_closed_reason?: string | null; consultant_id?: string | null }
export function biddingIsOpen(ticket: BiddingTicket, now = Date.now()) {
  return !!ticket.open_for_bids && (!ticket.bid_deadline || Date.parse(ticket.bid_deadline) > now) && !ticket.consultant_id && ticket.bidding_closed_reason !== 'assigned';
}
export function bidsTabState(ticket: BiddingTicket, rows: BidRow[], unanswered = 0) {
  const live = latestBids(rows).map(r => r.bid).filter(b => b.rejection_reason !== 'superseded');
  return { visible: !!ticket.open_for_bids || live.length > 0 || !!ticket.bidding_closed_at || !!ticket.bidding_closed_reason, pending: live.filter(b => b.status === 'pending').length, unanswered };
}
export function biddingStatus(ticket: BiddingTicket, pending: number, total: number, now = Date.now()): string {
  if (ticket.consultant_id || ticket.bidding_closed_reason === 'assigned') return 'A consultant was chosen.';
  if (biddingIsOpen(ticket, now)) return `Bidding is open: ${total} bids so far`;
  const closedAt = ticket.bidding_closed_at || (ticket.bid_deadline && Date.parse(ticket.bid_deadline) <= now ? ticket.bid_deadline : null);
  if (closedAt) return `Bidding closed on ${new Date(closedAt).toLocaleString()}: ${pending} bids are waiting for your decision.`;
  return 'No bids yet.';
}
export const contactHelp = 'Do not write e-mail addresses, phone numbers or links: contact details are shared inside the portal.';