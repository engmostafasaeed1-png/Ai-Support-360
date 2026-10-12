import { describe, expect, it } from 'vitest';
import { isValidIban, maskAccount, maskIban, normalizeIban } from './iban';

describe('iban', () => {
  it('normalizes', () => {
    expect(normalizeIban(' gb82 west 1234 ')).toBe('GB82WEST1234');
  });
  it('validates with mod 97', () => {
    expect(isValidIban('GB82WEST12345698765432')).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('de89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('GB82WEST12345698765433')).toBe(false);
    expect(isValidIban('hello')).toBe(false);
  });
  it('masks', () => {
    expect(maskIban('GB82WEST12345698765432')).toBe('GB•• •••• •••• •••• 5432');
    expect(maskIban('GB82WEST12345698765432')).not.toContain('WEST');
    expect(maskAccount('1234567890')).toBe('••••••7890');
    expect(maskAccount('')).toBe('');
  });
});
