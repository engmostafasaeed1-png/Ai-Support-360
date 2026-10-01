const EMAIL_RE = /^[^\s@<>()\[\]\\,;:"]+@[^\s@<>()\[\]\\,;:"]+\.[^\s@<>()\[\]\\,;:"]{2,}$/;

/** Splits "a@x.com, b@y.org" (comma, semicolon or space separated) into clean, unique, lower-case addresses. */
export function parseEmailList(text: string, max = 5): { emails: string[]; error: string | null } {
  const emails: string[] = [];
  for (const item of text.split(/[\s,;]+/)) {
    const email = item.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return { emails: [], error: `"${item.trim().slice(0, 60)}" is not a valid e-mail address` };
    }
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > max) return { emails: [], error: `You can add at most ${max} addresses` };
  return { emails, error: null };
}
