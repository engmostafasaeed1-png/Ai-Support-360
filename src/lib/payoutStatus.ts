/** Admin view of a consultant's bank details, from admin_payout_details_status() (no numbers). */
export type PayoutStatusRow = { consultant_id: string; state: string; acknowledged: boolean; updated_at: string | null };
export type PayoutStatusState = 'missing' | 'waiting' | 'verified';

export const PAYOUT_STATUS_LABELS: Record<PayoutStatusState, string> = {
  missing: 'Bank details: Missing',
  waiting: 'Bank details: Waiting',
  verified: 'Bank details: Verified',
};

export function payoutStatusMap(rows: PayoutStatusRow[] | null | undefined): Map<string, PayoutStatusState> {
  const m = new Map<string, PayoutStatusState>();
  for (const r of rows ?? []) {
    const s: PayoutStatusState = r.state === 'verified' ? 'verified' : r.state === 'waiting' ? 'waiting' : 'missing';
    m.set(r.consultant_id, s);
  }
  return m;
}

/** A consultant without a row in the map counts as missing. */
export const payoutStateFor = (m: Map<string, PayoutStatusState>, id: string): PayoutStatusState => m.get(id) ?? 'missing';
