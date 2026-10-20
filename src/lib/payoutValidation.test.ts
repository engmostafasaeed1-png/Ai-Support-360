import { describe, expect, it } from 'vitest';
import { isValidAccountNumber, payoutFieldErrors, PAYOUT_MESSAGES } from './payoutValidation';

const base = { account_holder: 'Jane Doe', bank_name: 'Test Bank', iban: '', account_number: '12345678', swift_bic: '', country: '', currency: 'USD' };

describe('payout field rules (same as the server)', () => {
  it('account number: 4 to 34 letters, digits or dashes, spaces ignored', () => {
    expect(isValidAccountNumber('1234')).toBe(true);
    expect(isValidAccountNumber('AB-12 34')).toBe(true);
    expect(isValidAccountNumber('A'.repeat(34))).toBe(true);
    expect(isValidAccountNumber('123')).toBe(false);
    expect(isValidAccountNumber('A'.repeat(35))).toBe(false);
    expect(isValidAccountNumber('12_34')).toBe(false);
  });

  it('reports each broken rule on its field', () => {
    expect(payoutFieldErrors(base)).toEqual({});
    expect(payoutFieldErrors({ ...base, account_number: '12' }).account_number).toBe(PAYOUT_MESSAGES.account);
    expect(payoutFieldErrors({ ...base, iban: 'GB82WEST12345698765433' }).iban).toBe(PAYOUT_MESSAGES.iban);
    expect(payoutFieldErrors({ ...base, swift_bic: 'WEST' }).swift_bic).toBe(PAYOUT_MESSAGES.swift);
    expect(payoutFieldErrors({ ...base, account_holder: 'J' }).account_holder).toBe(PAYOUT_MESSAGES.names);
    expect(payoutFieldErrors({ ...base, account_number: '' })).toMatchObject({ iban: PAYOUT_MESSAGES.ibanOrAccount, account_number: PAYOUT_MESSAGES.ibanOrAccount });
    expect(payoutFieldErrors({ ...base, currency: 'US' }).currency).toBe(PAYOUT_MESSAGES.currency);
    expect(payoutFieldErrors({ ...base, country: 'X' }).country).toBe(PAYOUT_MESSAGES.country);
  });
});
