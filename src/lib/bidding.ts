/** Pure helpers of the consultant side of bidding (M64). */

export type CountdownTone = 'normal' | 'amber' | 'red' | 'closed' | 'none';

export interface BidCountdown {
  text: string;
  tone: CountdownTone;
  closed: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "2d 5h", "5h 12m", "12m"; never negative. */
export function formatRemaining(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${Math.max(min, 1)}m`;
}

/** The deadline line of a request open for bids. */
export function bidCountdown(deadline: string | null | undefined, now: number, openForBids = true): BidCountdown {
  if (!openForBids) return { text: 'Bidding closed', tone: 'closed', closed: true };
  if (!deadline) return { text: 'No deadline', tone: 'none', closed: false };
  const left = new Date(deadline).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return { text: 'Bidding closed', tone: 'closed', closed: true };
  const tone: CountdownTone = left < 2 * HOUR ? 'red' : left < DAY ? 'amber' : 'normal';
  return { text: `Bids close in ${formatRemaining(left)}`, tone, closed: false };
}

export const toneClass: Record<CountdownTone, string> = {
  normal: 'text-muted-foreground',
  none: 'text-muted-foreground',
  amber: 'text-amber-600',
  red: 'text-destructive font-medium',
  closed: 'text-muted-foreground',
};

export interface BidRow {
  id: string;
  ticket_id: string;
  consultant_id?: string;
  version?: number | null;
  status: string;
  created_at: string;
  rejection_reason?: string | null;
  [key: string]: unknown;
}

export interface LatestBid<T extends BidRow> {
  bid: T;
  history: T[];
}

/** One bid per request: the latest version; the older versions (also the superseded ones) only in the history. */
export function latestBids<T extends BidRow>(rows: T[]): LatestBid<T>[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = `${r.ticket_id}:${r.consultant_id ?? ''}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  const out: LatestBid<T>[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => (Number(b.version ?? 1) - Number(a.version ?? 1)) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    const nonSuperseded = sorted.filter(r => r.rejection_reason !== 'superseded');
    const bid = nonSuperseded[0] ?? sorted[0];
    out.push({ bid, history: sorted.filter(r => r.id !== bid.id) });
  }
  return out.sort((a, b) => new Date(b.bid.created_at).getTime() - new Date(a.bid.created_at).getTime());
}

export type BidCardState = 'none' | 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export function bidCardState(bid: { status: string } | null | undefined): BidCardState {
  if (!bid) return 'none';
  if (bid.status === 'pending' || bid.status === 'accepted' || bid.status === 'rejected' || bid.status === 'withdrawn') return bid.status;
  return 'none';
}

export function rejectionLine(reason: string | null | undefined): string | null {
  if (!reason || reason === 'superseded') return null;
  if (reason === 'another_chosen') return 'The client chose another consultant.';
  return `Declined: ${reason}`;
}

export function ticketAreas(t: { sap_module?: string | null; sap_modules?: string[] | null }): string[] {
  const all = [...(t.sap_modules ?? []), t.sap_module ?? ''].map(s => (s ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  return all.filter(a => { const k = a.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function matchCount(t: { sap_module?: string | null; sap_modules?: string[] | null }, skills: string[]): number {
  const s = new Set(skills.map(x => x.trim().toLowerCase()).filter(Boolean));
  return ticketAreas(t).filter(a => s.has(a.toLowerCase())).length;
}

export type BidSort = 'closing' | 'newest' | 'match';

export interface RequestFilter {
  search: string;
  matchOnly: boolean;
  urgency: string;
  sort: BidSort;
  skills: string[];
}

export interface RequestLike {
  id: string;
  title: string;
  description?: string | null;
  sap_module?: string | null;
  sap_modules?: string[] | null;
  urgency?: string | null;
  created_at: string;
  bid_deadline?: string | null;
}

export function filterAndSortRequests<T extends RequestLike>(rows: T[], f: RequestFilter): T[] {
  const q = f.search.trim().toLowerCase();
  const list = rows.filter(t => {
    if (q && !`${t.title} ${t.description ?? ''} ${ticketAreas(t).join(' ')}`.toLowerCase().includes(q)) return false;
    if (f.matchOnly && matchCount(t, f.skills) === 0) return false;
    if (f.urgency !== 'all' && (t.urgency || 'medium') !== f.urgency) return false;
    return true;
  });
  const newest = (a: T, b: T) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  return list.sort((a, b) => {
    if (f.sort === 'newest') return newest(a, b);
    if (f.sort === 'match') return (matchCount(b, f.skills) - matchCount(a, f.skills)) || newest(a, b);
    const da = a.bid_deadline ? new Date(a.bid_deadline).getTime() : Infinity;
    const db = b.bid_deadline ? new Date(b.bid_deadline).getTime() : Infinity;
    if (da !== db) return da - db;
    return newest(a, b);
  });
}

export function bidsSoFar(n: number | undefined): string {
  if (!n) return 'No bids yet';
  return n === 1 ? '1 bid so far' : `${n} bids so far`;
}

export const QUESTION_MIN = 5;
export const QUESTION_MAX = 500;

export function questionProblem(text: string): string | null {
  const n = text.trim().length;
  if (n < QUESTION_MIN) return `A question needs at least ${QUESTION_MIN} characters.`;
  if (n > QUESTION_MAX) return `A question can have at most ${QUESTION_MAX} characters.`;
  return null;
}
