/** Single source of truth for the client-side password policy (NIST SP 800-63B: length first). */
export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_RULES: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.length >= MIN_PASSWORD_LENGTH, label: `At least ${MIN_PASSWORD_LENGTH} characters` },
  { test: (p) => /[A-Z]/.test(p), label: 'One uppercase letter' },
  { test: (p) => /[a-z]/.test(p), label: 'One lowercase letter' },
  { test: (p) => /[0-9]/.test(p), label: 'One number' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'One special character' },
  { test: (p) => !/(.)\1{2,}/.test(p), label: 'No repeated characters (e.g. aaa)' },
];

/** Long enough AND at least 4 of the 6 rules satisfied (same bar the sign-up form's "strong" level applied). */
export function isPasswordAcceptable(p: string): boolean {
  return p.length >= MIN_PASSWORD_LENGTH && PASSWORD_RULES.filter((r) => r.test(p)).length >= 4;
}
