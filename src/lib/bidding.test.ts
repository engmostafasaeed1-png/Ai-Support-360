import { describe, it, expect } from 'vitest';
import { bidCardState, bidCountdown, bidsSoFar, filterAndSortRequests, formatRemaining, latestBids, questionProblem, rejectionLine } from './bidding';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;

describe('bid countdown', () => {
  it('formats days, hours and minutes', () => {
    expect(formatRemaining(2 * 24 * H + 5 * H + 30 * 60_000)).toBe('2d 5h');
    expect(formatRemaining(5 * H + 12 * 60_000)).toBe('5h 12m');
    expect(formatRemaining(12 * 60_000)).toBe('12m');
  });
  it('turns amber under 24 hours and red under 2 hours', () => {
    expect(bidCountdown(at(30 * H), NOW).tone).toBe('normal');
    expect(bidCountdown(at(23 * H), NOW).tone).toBe('amber');
    expect(bidCountdown(at(H), NOW).tone).toBe('red');
    expect(bidCountdown(at(30 * H), NOW).text).toBe('Bids close in 1d 6h');
  });
  it('is closed when the deadline passed or bidding stopped; no deadline otherwise', () => {
    expect(bidCountdown(at(-1), NOW)).toEqual({ text: 'Bidding closed', tone: 'closed', closed: true });
    expect(bidCountdown(at(H), NOW, false).closed).toBe(true);
    expect(bidCountdown(null, NOW).text).toBe('No deadline');
  });
});

describe('card state', () => {
  it('knows no bid, pending, accepted, rejected and withdrawn', () => {
    expect(bidCardState(null)).toBe('none');
    for (const s of ['pending', 'accepted', 'rejected', 'withdrawn']) expect(bidCardState({ status: s })).toBe(s);
  });
  it('explains why a bid was not chosen', () => {
    expect(rejectionLine('another_chosen')).toBe('The client chose another consultant.');
    expect(rejectionLine('too expensive')).toBe('Declined: too expensive');
    expect(rejectionLine('superseded')).toBeNull();
  });
  it('counts the bids', () => {
    expect(bidsSoFar(0)).toBe('No bids yet');
    expect(bidsSoFar(1)).toBe('1 bid so far');
    expect(bidsSoFar(4)).toBe('4 bids so far');
  });
});

describe('latestBids', () => {
  it('keeps only the latest version per request and moves superseded ones to the history', () => {
    const rows = [
      { id: 'a1', ticket_id: 't1', consultant_id: 'c', version: 1, status: 'withdrawn', rejection_reason: 'superseded', created_at: at(-3 * H) },
      { id: 'a2', ticket_id: 't1', consultant_id: 'c', version: 2, status: 'pending', created_at: at(-H) },
      { id: 'b1', ticket_id: 't2', consultant_id: 'c', version: 1, status: 'rejected', created_at: at(-2 * H) },
    ];
    const out = latestBids(rows);
    expect(out.map(o => o.bid.id)).toEqual(['a2', 'b1']);
    expect(out[0].history.map(h => h.id)).toEqual(['a1']);
  });
});

describe('filterAndSortRequests', () => {
  const rows = [
    { id: '1', title: 'Payroll run', sap_module: 'HCM', urgency: 'high', created_at: at(-3 * H), bid_deadline: null },
    { id: '2', title: 'GL issue', sap_module: 'FI', sap_modules: ['CO'], urgency: 'low', created_at: at(-H), bid_deadline: at(10 * H) },
    { id: '3', title: 'Pricing', sap_module: 'SD', urgency: 'critical', created_at: at(-2 * H), bid_deadline: at(2 * H) },
  ];
  const base = { search: '', matchOnly: false, urgency: 'all', sort: 'closing' as const, skills: ['fi', 'co', 'SD'] };
  it('sorts closing soon with no deadline last, newest, and best match', () => {
    expect(filterAndSortRequests(rows, base).map(r => r.id)).toEqual(['3', '2', '1']);
    expect(filterAndSortRequests(rows, { ...base, sort: 'newest' }).map(r => r.id)).toEqual(['2', '3', '1']);
    expect(filterAndSortRequests(rows, { ...base, sort: 'match' }).map(r => r.id)).toEqual(['2', '3', '1']);
  });
  it('filters by module match, urgency and search', () => {
    expect(filterAndSortRequests(rows, { ...base, matchOnly: true }).map(r => r.id)).toEqual(['3', '2']);
    expect(filterAndSortRequests(rows, { ...base, urgency: 'high' }).map(r => r.id)).toEqual(['1']);
    expect(filterAndSortRequests(rows, { ...base, search: 'gl' }).map(r => r.id)).toEqual(['2']);
  });
});

describe('questionProblem', () => {
  it('needs 5 to 500 characters', () => {
    expect(questionProblem('abc')).not.toBeNull();
    expect(questionProblem('Which client?')).toBeNull();
    expect(questionProblem('x'.repeat(501))).not.toBeNull();
  });
});
