/** Remove spaces and upper-case. */
export const normalizeIban = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, '').toUpperCase();

/** ISO 13616: country letters + 2 check digits + 11-30 alphanumerics, mod 97 must be 1. */
export function isValidIban(s: string | null | undefined): boolean {
  const v = normalizeIban(s);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const r = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    rem = /[0-9]/.test(ch) ? (rem * 10 + Number(ch)) % 97 : (rem * 100 + (ch.charCodeAt(0) - 55)) % 97;
  }
  return rem === 1;
}

/** "GB•• •••• •••• •••• 5432": country letters, hidden groups, the last 4 characters. */
export function maskIban(s: string | null | undefined): string {
  const v = normalizeIban(s);
  if (!v) return '';
  if (v.length <= 6) return '•'.repeat(Math.max(0, v.length - 4)) + v.slice(-4);
  const groups = Math.max(1, Math.floor((v.length - 8) / 4));
  return [v.slice(0, 2) + '••', ...Array(groups).fill('••••'), v.slice(-4)].join(' ');
}

/** Only the last 4 characters shown. */
export function maskAccount(s: string | null | undefined): string {
  const v = (s ?? '').replace(/\s+/g, '');
  if (!v) return '';
  return '•'.repeat(Math.max(4, v.length - 4)) + v.slice(-4);
}
