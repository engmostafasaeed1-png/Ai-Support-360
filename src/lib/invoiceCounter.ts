/** The counter of the invoice numbers (INV-<year>-<6 digits>) as the database function admin_get_invoice_counter returns it. */

export interface InvoiceCounterChange {
  changed_at: string;
  changed_by_name: string;
  old_next: number;
  new_next: number;
  reason: string;
}

export interface InvoiceCounterInfo {
  year: number;
  next_number: number;
  next_invoice_number: string;
  highest_used: number;
  lowest_allowed_next: number;
  invoices_total: number;
  history: InvoiceCounterChange[];
}

export const MAX_COUNTER_NUMBER = 999999;
export const REASON_MIN = 5;
export const REASON_MAX = 300;

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function formatInvoiceNumber(year: number, n: number): string {
  return `INV-${year}-${String(n).padStart(6, '0')}`;
}

/** The year written in a number is the year in which the number was handed out. */
export function yearOf(iso: string, fallback: number): number {
  const y = new Date(iso).getUTCFullYear();
  return Number.isFinite(y) ? y : fallback;
}

/** Turns the answer of the database function into a safe object (nothing in it can be missing). */
export function toInvoiceCounterInfo(raw: unknown): InvoiceCounterInfo {
  const r = asRecord(raw);
  const history = Array.isArray(r.history) ? r.history : [];
  return {
    year: num(r.year),
    next_number: num(r.next_number),
    next_invoice_number: typeof r.next_invoice_number === 'string' ? r.next_invoice_number : '',
    highest_used: num(r.highest_used),
    lowest_allowed_next: Math.max(1, num(r.lowest_allowed_next)),
    invoices_total: num(r.invoices_total),
    history: history.map((h): InvoiceCounterChange => {
      const x = asRecord(h);
      return {
        changed_at: typeof x.changed_at === 'string' ? x.changed_at : '',
        changed_by_name: typeof x.changed_by_name === 'string' ? x.changed_by_name : 'An administrator',
        old_next: num(x.old_next),
        new_next: num(x.new_next),
        reason: typeof x.reason === 'string' ? x.reason : '',
      };
    }),
  };
}

/** What was typed in the "next number" box: a whole number of up to 7 digits, or null. */
export function parseCounterInput(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  return Number(s);
}

/** The message under the box, or null when the number can be saved. The database repeats every check. */
export function validateNextNumber(
  raw: string,
  info: Pick<InvoiceCounterInfo, 'year' | 'next_number' | 'highest_used' | 'lowest_allowed_next'>,
): string | null {
  const n = parseCounterInput(raw);
  if (n === null) return 'Enter a whole number, for example 16.';
  if (n < 1 || n > MAX_COUNTER_NUMBER) return `Enter a number from 1 to ${MAX_COUNTER_NUMBER}.`;
  if (n === info.next_number) return 'The counter is already at this number.';
  if (n < info.lowest_allowed_next) {
    return `The number must be at least ${info.lowest_allowed_next}: ${formatInvoiceNumber(info.year, info.highest_used)} is already used.`;
  }
  return null;
}

export function validateReason(raw: string): string | null {
  const len = raw.trim().length;
  if (len < REASON_MIN) return `Write the reason (at least ${REASON_MIN} characters).`;
  if (len > REASON_MAX) return `The reason can have at most ${REASON_MAX} characters.`;
  return null;
}

/** Names the numbers that no invoice carries when the counter is ahead of the highest number in use, else null. */
export function describeGap(info: Pick<InvoiceCounterInfo, 'year' | 'next_number' | 'highest_used'>): string | null {
  const from = info.highest_used + 1;
  const to = info.next_number - 1;
  if (to < from) return null;
  return from === to
    ? `No invoice has the number ${formatInvoiceNumber(info.year, from)}.`
    : `No invoice has the numbers ${formatInvoiceNumber(info.year, from)} to ${formatInvoiceNumber(info.year, to)}.`;
}
