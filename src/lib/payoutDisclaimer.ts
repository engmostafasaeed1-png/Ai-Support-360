/** The disclaimer a consultant acknowledges each time the payout bank details are saved. Change the version when the text changes. */
export const PAYOUT_DISCLAIMER_VERSION = 'v1';

export const PAYOUT_DISCLAIMER_POINTS: string[] = [
  'The account is in my own name or in the name of my registered company, and the details are correct and complete. I am responsible for any delay, fee or loss that wrong details cause.',
  "The platform pays my fees only to this account, within 15 business days (Sunday to Thursday) after it receives the client's payment, and may hold a payout until the details are verified.",
  'My bank details are private: only I and the platform administrators can see them. They are never shown to clients or to other consultants, and they are used only to pay me and to meet legal and accounting duties.',
  'If I change any detail, the platform checks the details again before the next payout and may ask me for proof of account ownership.',
  "I will keep the details up to date and will not use this account for anyone else's payments.",
];

export type PayoutAckRow = { acknowledged_at?: string | null; acknowledged_version?: string | null; verified_at?: string | null } | null | undefined;

export type PayoutCardState = 'missing' | 'confirm' | 'waiting' | 'verified';

/** missing: no row; confirm: the current disclaimer is not acknowledged; then waiting / verified. */
export function payoutCardState(row: PayoutAckRow): PayoutCardState {
  if (!row) return 'missing';
  if (!row.acknowledged_at || row.acknowledged_version !== PAYOUT_DISCLAIMER_VERSION) return 'confirm';
  return row.verified_at ? 'verified' : 'waiting';
}

/** Saved with the current disclaimer acknowledged. */
export const payoutReady = (row: PayoutAckRow): boolean => {
  const s = payoutCardState(row);
  return s === 'waiting' || s === 'verified';
};
