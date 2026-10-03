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

// ---------------------------------------------------------------- articles written by hand

export const MIN_TITLE = 5;
export const MIN_TEXT = 20;
export const MAX_NOTE_NUMBERS = 8;

/** "SAP Note 2270407, 2345678; KBA 3012345" becomes ["2270407", "2345678", "3012345"]: numbers of 5 to 8 digits, no duplicates. */
export function parseNoteNumbers(input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(/\b\d{5,8}\b/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= MAX_NOTE_NUMBERS) break;
  }
  return out;
}

export interface ArticleFields extends ReviewFields {
  areas: readonly string[];
  confirmed: boolean;
}

/** The first thing wrong with an article before it is sent, or null when it can be sent. */
export function validateArticle(f: ArticleFields): string | null {
  if (f.title.trim().length < MIN_TITLE) return `The title needs at least ${MIN_TITLE} characters.`;
  if (f.title.trim().length > MAX_TITLE) return `The title is longer than ${MAX_TITLE} characters.`;
  if (f.problem.trim().length < MIN_TEXT) return `Describe the problem in at least ${MIN_TEXT} characters.`;
  if (f.problem.trim().length > MAX_PROBLEM) return `The problem description is longer than ${MAX_PROBLEM} characters.`;
  if (f.solution.trim().length < MIN_TEXT) return `Describe the solution in at least ${MIN_TEXT} characters.`;
  if (f.solution.trim().length > MAX_SOLUTION - 200) return `The solution is longer than ${MAX_SOLUTION - 200} characters.`;
  if (f.areas.length === 0) return 'Choose at least one area.';
  if (f.areas.length > 12) return 'Choose at most 12 areas.';
  if (!f.confirmed) return 'Please confirm the statement at the end.';
  return null;
}

export const ARTICLE_STATUS_LABEL: Record<string, string> = {
  draft: 'Waiting for review',
  published: 'Published',
  archived: 'Archived',
};
