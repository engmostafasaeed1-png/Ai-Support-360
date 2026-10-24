// BRD safety filters shared by the ticket-brd function (AI output) and the browser editor (before every save).
// Pure functions, unit-tested with vitest.
//
// - scrubSecrets: removes things that look like passwords, tokens, keys and credentials in links, keeping the label
//   ("Password: [removed]") so the reader understands what was taken out;
// - contacts: the platform's contact-bypass rule (M60, mirror of public.mask_contact_details) hides e-mail addresses,
//   phone numbers, links, domains and messenger names; the database masks the saved text again;
// - both run on HTML text: values stop at "<" so markup is never eaten.

import { maskContactDetails, HIDDEN_MARK } from './assignmentInfo.ts';
import type { BrdContent } from './brdModel.ts';

export const REMOVED_MARK = '[removed]';

const V = String.raw`[^\s<>"']+`;

/** Whole-token secrets (no label needed). */
const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, // JWT
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\b(?:sk|pk|rk)[-_](?:live|test|proj)[-_][A-Za-z0-9_-]{12,}/g, // Stripe / OpenAI style
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
];

/** "<label>: value" secrets: the label stays, the value goes. */
const LABELLED: RegExp[] = [
  new RegExp(String.raw`(\b(?:password|passwort|passwd|pass(?:word)?|pwd|pw|kennwort|mot de passe|secret|client[ _-]?secret|api[ _-]?key|access[ _-]?key|secret[ _-]?key|access[ _-]?token|auth[ _-]?token|bearer|token|private[ _-]?key|pin)\b\s*(?:is|=|:|-)\s*)(${V})`, 'gi'),
  new RegExp(String.raw`((?:كلمة\s*(?:ال)?(?:مرور|سر|السر)|الرقم\s*السري|رمز\s*(?:الدخول|التحقق|المرور)|كلمة\s*المرور\s*هي)\s*[:=\-]?\s*)(${V})`, 'g'),
];

/** Credentials inside a connection string or link: scheme://user:secret@host */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/<>]+):([^\s@/<>]+)@/gi;

export function scrubSecrets(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = String(text ?? '');
  for (const re of TOKEN_PATTERNS) out = out.replace(re, () => { removed++; return REMOVED_MARK; });
  for (const re of LABELLED) {
    out = out.replace(re, (_m, label: string, value: string) => {
      if (value === REMOVED_MARK || value === HIDDEN_MARK) return `${label}${value}`;
      removed++;
      return `${label}${REMOVED_MARK}`;
    });
  }
  out = out.replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => { removed++; return `${scheme}${user}:${REMOVED_MARK}@`; });
  return { text: out, removed };
}

/** Contact-bypass mask with a count of what was hidden. */
export function maskContacts(text: string): { text: string; hidden: number } {
  const before = String(text ?? '');
  const out = maskContactDetails(before);
  if (out === before) return { text: out, hidden: 0 };
  const count = (s: string) => s.split(HIDDEN_MARK).length - 1;
  return { text: out, hidden: Math.max(1, count(out) - count(before)) };
}

/** Secrets first, then contact details (a token can look like a phone number once digits are masked). */
export function cleanText(text: string): { text: string; secrets: number; contacts: number } {
  const s = scrubSecrets(text);
  const c = maskContacts(s.text);
  return { text: c.text, secrets: s.removed, contacts: c.hidden };
}

export interface CleanReport { secrets: number; contacts: number }

/** Runs cleanText over every text the client can type or the AI can write. */
export function cleanContent(content: BrdContent): { content: BrdContent; report: CleanReport } {
  const report: CleanReport = { secrets: 0, contacts: 0 };
  const run = (v: string | undefined) => {
    if (!v) return v ?? '';
    const r = cleanText(v);
    report.secrets += r.secrets;
    report.contacts += r.contacts;
    return r.text;
  };
  const next: BrdContent = {
    ...content,
    control: {
      ...content.control,
      title: run(content.control.title),
      company: run(content.control.company),
      requester: run(content.control.requester),
      approvers: run(content.control.approvers),
    },
    sections: content.sections.map((s) => ({ ...s, html: run(s.html), ...(s.html_ar !== undefined ? { html_ar: run(s.html_ar) } : {}) })),
    requirements: content.requirements.map((r) => ({
      ...r,
      description: run(r.description),
      acceptance: run(r.acceptance),
      owner: run(r.owner),
      ...(r.description_ar !== undefined ? { description_ar: run(r.description_ar) } : {}),
      ...(r.acceptance_ar !== undefined ? { acceptance_ar: run(r.acceptance_ar) } : {}),
    })),
    questions: content.questions.map((q) => ({ ...q, question: run(q.question), answer: run(q.answer), options: q.options.map((o) => run(o)) })),
  };
  return { content: next, report };
}
