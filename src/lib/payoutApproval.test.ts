import { describe, expect, it } from 'vitest';
import { payoutApprovalData, payoutApprovalKey } from '../../supabase/functions/_shared/payout-approval';

const payout = { id: 'payout-1', amount: '1234.50', currency: 'SAR', status: 'processing', due_by: '2026-10-29', paid_at: null };

describe('payout approval data', () => {
  it('uses the approved payout amount and currency without deducting fees', () => {
    expect(payoutApprovalData(payout)).toMatchObject({ amount: '1,234.50', currency: 'SAR' });
  });
  it('uses the stored expected payout date during preparation', () => {
    expect(payoutApprovalData(payout)).toMatchObject({ date: '2026-10-29', completed: false });
  });
  it('uses the real transfer date after direct completion', () => {
    expect(payoutApprovalData({ ...payout, status: 'completed', paid_at: '2026-10-17T01:00:00Z' })).toMatchObject({ date: '2026-10-17', completed: true });
  });
  it.each(['pending', 'failed'])('does not email %s payouts', (status) => {
    expect(payoutApprovalData({ ...payout, status })).toBeNull();
  });
  it('never invents a payout date when one is missing', () => {
    expect(() => payoutApprovalData({ ...payout, due_by: null })).toThrow('The payout date is missing');
  });
  it('rejects invalid amounts', () => {
    expect(() => payoutApprovalData({ ...payout, amount: 'NaN' })).toThrow('Invalid payout amount or currency');
  });
  it('deduplicates approval and completion for the same payout', () => {
    expect(payoutApprovalKey(payout.id)).toBe('payout-approved-payout-1');
    expect(payoutApprovalKey('payout-2')).not.toBe(payoutApprovalKey(payout.id));
  });
});