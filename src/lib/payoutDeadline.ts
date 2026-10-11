// The payout deadline: the platform pays the consultant within 15 business days (Sunday to Thursday) after it received the client's payment.
// The database sets the due date of every payout (payouts.due_by); these helpers only describe it for the screens.

export type DeadlineTone = 'done' | 'ok' | 'soon' | 'overdue';

export interface PayoutDeadline {
  /** days from today to the due date (negative when late); null when the payout is paid or has no date */
  days: number | null;
  tone: DeadlineTone;
  /** the short sentence: "Due in 5 days", "Due today", "Overdue by 2 days", "Paid" */
  label: string;
}

/** Today's date (YYYY-MM-DD) in Cairo, the time zone in which the database counts the days. */
export function cairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const DAY = 86_400_000;

const toUtc = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};

/** Calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Where a payout stands against its deadline. A paid payout is done; a failed one is still owed. */
export function payoutDeadline(payout: { status: string; due_by?: string | null }, today: string = cairoToday()): PayoutDeadline {
  if (payout.status === 'completed') return { days: null, tone: 'done', label: 'Paid' };
  if (!payout.due_by) return { days: null, tone: 'ok', label: 'No due date' };
  const days = daysBetween(today, payout.due_by);
  if (days < 0) return { days, tone: 'overdue', label: `Overdue by ${plural(-days)}` };
  if (days === 0) return { days, tone: 'soon', label: 'Due today' };
  return { days, tone: days <= 3 ? 'soon' : 'ok', label: `Due in ${plural(days)}` };
}

/** How many open payouts are late, and how many are due within the next `within` days. */
export function deadlineSummary(
  payouts: { status: string; due_by?: string | null }[],
  today: string = cairoToday(),
  within = 3,
): { overdue: number; soon: number } {
  let overdue = 0;
  let soon = 0;
  for (const p of payouts) {
    if (p.status !== 'pending' && p.status !== 'processing' && p.status !== 'failed') continue;
    const d = payoutDeadline(p, today);
    if (d.days === null) continue;
    if (d.days < 0) overdue += 1;
    else if (d.days <= within) soon += 1;
  }
  return { overdue, soon };
}
