import { isValidIban } from '@/lib/iban';

/**
 * The bank-details rules of the save_payout_details database function, checked in the browser first.
 * The messages are the exact texts the server raises, so a refused save is recognised as a normal input answer.
 */
export const PAYOUT_MESSAGES = {
  ack: 'Please read the disclaimer and confirm it before saving your bank details',
  names: 'The account holder and the bank name need 2 to 120 characters',
  ibanOrAccount: 'Enter an IBAN or an account number',
  iban: 'The IBAN is not valid: check the letters and digits',
  account: 'The account number must have 4 to 34 letters, digits or dashes',
  swift: 'The SWIFT / BIC must have 8 or 11 letters and digits',
  currency: 'The currency must be a 3-letter code such as USD',
  country: 'The country needs 2 to 60 characters',
  notes: 'Please do not write e-mail addresses, phone numbers, web links or messenger names in the notes',
  rate: 'Too many attempts. Please wait a while and try again.',
} as const;

/** Server messages that are a normal answer to the person's input, never an app error. */
export const PAYOUT_VALIDATION_MESSAGE = new RegExp(
  Object.values(PAYOUT_MESSAGES).map((m) => m.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'),
  'i',
);

export type PayoutFormValues = {
  account_holder: string; bank_name: string; iban: string; account_number: string;
  swift_bic: string; country: string; currency: string;
};
export type PayoutField = 'account_holder' | 'bank_name' | 'iban' | 'account_number' | 'swift_bic' | 'country' | 'currency';

const nameBad = (s: string) => { const n = s.trim().length; return n < 2 || n > 120; };

/** True when the account number (spaces removed) has 4 to 34 letters, digits or dashes. */
export const isValidAccountNumber = (s: string) => /^[A-Za-z0-9-]{4,34}$/.test(s.replace(/\s/g, ''));

/** One message per field that breaks a rule. Empty optional fields are fine; a missing IBAN and account number is reported on both. */
export function payoutFieldErrors(f: PayoutFormValues): Partial<Record<PayoutField, string>> {
  const e: Partial<Record<PayoutField, string>> = {};
  if (nameBad(f.account_holder)) e.account_holder = PAYOUT_MESSAGES.names;
  if (nameBad(f.bank_name)) e.bank_name = PAYOUT_MESSAGES.names;
  const iban = f.iban.replace(/\s/g, '');
  const acc = f.account_number.replace(/\s/g, '');
  if (!iban && !acc) { e.iban = PAYOUT_MESSAGES.ibanOrAccount; e.account_number = PAYOUT_MESSAGES.ibanOrAccount; }
  if (iban && !isValidIban(iban)) e.iban = PAYOUT_MESSAGES.iban;
  if (acc && !isValidAccountNumber(acc)) e.account_number = PAYOUT_MESSAGES.account;
  const sw = f.swift_bic.trim();
  if (sw && !/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(sw)) e.swift_bic = PAYOUT_MESSAGES.swift;
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) e.currency = PAYOUT_MESSAGES.currency;
  const co = f.country.trim();
  if (co && (co.length < 2 || co.length > 60)) e.country = PAYOUT_MESSAGES.country;
  return e;
}
