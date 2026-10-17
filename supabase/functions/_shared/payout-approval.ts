export interface ApprovedPayout {
  id: string;
  amount: number | string;
  currency: string;
  status: string;
  due_by: string | null;
  paid_at: string | null;
}

export function payoutApprovalData(payout: ApprovedPayout) {
  if (!['processing', 'completed'].includes(payout.status)) return null;
  const amount = Number(payout.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !payout.currency) throw new Error('Invalid payout amount or currency');
  const date = payout.status === 'completed' ? payout.paid_at?.slice(0, 10) : payout.due_by;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) {
    throw new Error('The payout date is missing');
  }
  return {
    amount: amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    currency: payout.currency,
    date,
    completed: payout.status === 'completed',
  };
}

// Approval and direct completion are the same payout event, not two emails.
export const payoutApprovalKey = (id: string) => `payout-approved-${id}`;