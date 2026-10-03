// Helpers for the administrator's "Knowledge review" screen.

export const FLAG_LABEL: Record<string, string> = {
  email: 'e-mail address',
  link: 'link',
  ip: 'IP address',
  host: 'host name',
  phone: 'phone number',
  number: 'long number',
  id: 'identifier',
  custom_object: 'custom object name',
  name: 'company, person or system name',
};

export const ORIGIN_LABEL: Record<string, string> = {
  session: 'From a finished session',
  ticket: 'From a finished ticket',
  manual: 'Written by hand',
};

export const MAX_TITLE = 200;
export const MAX_PROBLEM = 2000;
export const MAX_SOLUTION = 6000;
export const MAX_TAGS = 8;

/** What the automatic privacy check removed, in words ("e-mail address, long number"). Empty when it removed nothing. */
export function describeFlags(flags: readonly string[] | null | undefined): string {
  return (flags ?? []).map(f => FLAG_LABEL[f] ?? f).join(', ');
}

/** "SAP, Posting Period, fi" becomes ["sap", "posting-period", "fi"]: lowercase, letters, digits and hyphens, 2 to 24 characters, no duplicates. */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (tag.length >= 2 && tag.length <= 24 && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export interface ReviewFields {
  title: string;
  problem: string;
  solution: string;
}

/** The first thing wrong with the text, or null when it can be saved. */
export function validateReview(f: ReviewFields): string | null {
  if (!f.title.trim()) return 'The title is empty.';
  if (f.title.trim().length > MAX_TITLE) return `The title is longer than ${MAX_TITLE} characters.`;
  if (!f.problem.trim()) return 'The problem description is empty.';
  if (f.problem.trim().length > MAX_PROBLEM) return `The problem description is longer than ${MAX_PROBLEM} characters.`;
  if (!f.solution.trim()) return 'The solution is empty.';
  if (f.solution.trim().length > MAX_SOLUTION) return `The solution is longer than ${MAX_SOLUTION} characters.`;
  return null;
}
