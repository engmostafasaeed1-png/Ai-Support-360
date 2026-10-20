/**
 * Feature L addition: decision preview, "Request more information" and decline reasons of assignment requests.
 * Pure rules shared by the portal (popup, Requests page, client card), the e-mail template, the reminder function and tests.
 * docs/sql/assignment-info-requests.sql enforces the same limits, pause/resume and masking inside SECURITY DEFINER RPCs;
 * this file only mirrors them for display and early validation.
 */

export const INFO_TOPICS = ['scope', 'system', 'error', 'timeline_budget', 'access'] as const;
export type InfoTopic = typeof INFO_TOPICS[number];

export const DECLINE_REASONS = ['not_my_module', 'no_capacity', 'rate_budget', 'timing', 'info_missing', 'other'] as const;
export type DeclineReason = typeof DECLINE_REASONS[number];

/** Most information requests per assignment request (one open at a time). */
export const INFO_MAX_REQUESTS = 3;
export const INFO_MAX_TOPICS = 3;
export const INFO_MAX_TEXT = 500;
export const ANSWER_MAX_TEXT = 1000;
/** After the client answers, the consultant has at least this much time left. */
export const RESUME_MIN_MINUTES = 120;

const MIN = 60_000;

export type InfoStatus = 'open' | 'answered' | 'timed_out' | 'closed';

export interface InfoRow {
  id: string;
  request_id: string;
  status: InfoStatus | string;
  topics: string[] | null;
  question: string | null;
  asked_at: string;
  client_due_at: string | null;
  answer: string | null;
  answered_at: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
}

// ---------------------------------------------------------------- contact filter (mirror of contact_details_in_text)

const CONTACT_PATTERNS: RegExp[] = [
  /[a-z0-9._%+-]+\s?(?:@|\[at\]|\(at\))\s?[a-z0-9-]+(?:\.|\s?\[dot\]\s?)[a-z]{2,}/i,
  /(?:https?:\/\/|www\.)\S+/i,
  /\b[a-z0-9-]+\.(?:com|net|org|io|me|co|app|dev|ai|info|biz|sa|ae|eg)(?:\/|\b)/i,
  /\b(?:whats\s?app|telegram|skype|viber|wechat|signal app|t\.me)\b/i,
  /(?:\+|\b00)\d[\d\s().-]{7,}\d/,
  /\b\d{9,}\b/,
  /\b\d{3}[\s.-]\d{3,4}[\s.-]\d{4}\b/,
  /\b\d{2,4}[\s.-]\d{7,8}\b/,
];

/** Same rule as the database check used for bids, questions and chat: e-mail, links, domains, messengers, phone numbers. */
export function contactDetailsInText(text: string | null | undefined): boolean {
  if (!text) return false;
  return CONTACT_PATTERNS.some((re) => re.test(text));
}

export const HIDDEN_MARK = '[hidden]';

/** Replaces contact details with "[hidden]" (mirror of mask_contact_details; the database masks before sending). */
export function maskContactDetails(text: string | null | undefined): string {
  let out = typeof text === 'string' ? text : '';
  for (const re of CONTACT_PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), HIDDEN_MARK);
  return out;
}

// ---------------------------------------------------------------- request more information

export type InfoProblem = 'empty' | 'unknown_topic' | 'too_many_topics' | 'too_long' | 'contact';

/** Checks the consultant's form before sending (the database repeats every check). */
export function validateInfoRequest(topics: readonly string[], text: string): InfoProblem[] {
  const out: InfoProblem[] = [];
  const t = text.trim();
  const unique = [...new Set(topics)];
  if (unique.length === 0 && t.length === 0) out.push('empty');
  if (unique.some((x) => !(INFO_TOPICS as readonly string[]).includes(x))) out.push('unknown_topic');
  if (unique.length > INFO_MAX_TOPICS) out.push('too_many_topics');
  if (t.length > INFO_MAX_TEXT) out.push('too_long');
  if (contactDetailsInText(t)) out.push('contact');
  return out;
}

export type AskBlock = 'not_pending' | 'open' | 'limit';

/** Whether another information request may be sent: pending request, none open, fewer than 3 so far. */
export function infoRequestBlock(requestStatus: string, rows: ReadonlyArray<Pick<InfoRow, 'status'>>): AskBlock | null {
  if (requestStatus !== 'pending') return 'not_pending';
  if (rows.some((r) => r.status === 'open' || r.status === 'timed_out')) return 'open';
  if (rows.length >= INFO_MAX_REQUESTS) return 'limit';
  return null;
}

/** Time left on the reply clock at the moment it was paused (never negative). */
export function remainingAtPause(dueAt: number, pausedAt: number): number {
  return Math.max(0, dueAt - pausedAt);
}

/** New reply deadline when the client answers: the time that was left, but at least 2 hours. */
export function resumeDeadline(remainingMs: number, now: number): number {
  return now + Math.max(Math.max(0, remainingMs), RESUME_MIN_MINUTES * MIN);
}

/** A request where the consultant asked for information before the deadline counts as answered for statistics. */
export function infoCountsAsResponse(askedAt: number, dueAt: number | null): boolean {
  return dueAt == null || askedAt <= dueAt;
}

export type ClientInfoView =
  | { kind: 'awaiting'; dueAt: number | null }
  | { kind: 'overdue' }
  | { kind: 'answered' }
  | { kind: 'closed' };

/** What the client sees for one information request: answer box (with time left), "Waiting for your answer" after the time, or done. */
export function clientInfoView(row: Pick<InfoRow, 'status' | 'client_due_at'>, now: number): ClientInfoView {
  if (row.status === 'answered') return { kind: 'answered' };
  if (row.status === 'closed') return { kind: 'closed' };
  const due = row.client_due_at ? Date.parse(row.client_due_at) : NaN;
  if (row.status === 'timed_out' || (Number.isFinite(due) && due <= now)) return { kind: 'overdue' };
  return { kind: 'awaiting', dueAt: Number.isFinite(due) ? due : null };
}

/** Distinct, known decline reasons (max 6), in the canonical order. */
export function normalizeDeclineReasons(reasons: readonly string[]): DeclineReason[] {
  const set = new Set(reasons);
  return DECLINE_REASONS.filter((r) => set.has(r));
}

// ---------------------------------------------------------------- decision preview

export interface PreviewAttachment { name: string; type: string; size: number | null }

export interface DecisionPreview {
  request_id: string;
  title: string;
  description: string;
  sap_module: string | null;
  sap_modules: string[];
  sap_module_other: string | null;
  area_details: string | null;
  urgency: string;
  critical: boolean;
  industry: string | null;
  country: string | null;
  planned_hours: number | null;
  planned_cost: number | null;
  cost_currency: string | null;
  budget_max_rate: number | null;
  proposed_rate: number | null;
  rate_currency: string | null;
  response_due_at: string | null;
  bid_deadline: string | null;
  attachments: PreviewAttachment[];
  info_paused: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A short, readable file type: "PDF", "XLSX", "PNG"; never a path or link. */
export function fileTypeLabel(name: string, mime?: string | null): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : '';
  if (/^[a-z0-9]{1,5}$/i.test(ext)) return ext.toUpperCase();
  const sub = (mime ?? '').split('/')[1] ?? '';
  return /^[a-z0-9.+-]{1,20}$/i.test(sub) ? sub.toUpperCase() : 'FILE';
}

/**
 * Whitelists the preview returned by assignment_request_preview: only the fields above survive, texts are masked again
 * and attachments keep name + type + size only. File links, storage paths, credentials, remote access, client
 * identity and contact data are dropped even if a future database change returned them.
 */
export function sanitizePreview(raw: unknown): DecisionPreview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.request_id);
  if (!id) return null;
  const files = Array.isArray(r.attachments) ? r.attachments : [];
  return {
    request_id: id,
    title: maskContactDetails(str(r.title) ?? ''),
    description: maskContactDetails(typeof r.description === 'string' ? r.description : ''),
    sap_module: str(r.sap_module),
    sap_modules: Array.isArray(r.sap_modules) ? r.sap_modules.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 12) : [],
    sap_module_other: str(r.sap_module_other) ? maskContactDetails(str(r.sap_module_other)) : null,
    area_details: str(r.area_details) ? maskContactDetails(str(r.area_details)) : null,
    urgency: str(r.urgency) ?? 'medium',
    critical: r.critical === true,
    industry: str(r.industry),
    country: str(r.country),
    planned_hours: num(r.planned_hours),
    planned_cost: num(r.planned_cost),
    cost_currency: str(r.cost_currency),
    budget_max_rate: num(r.budget_max_rate),
    proposed_rate: num(r.proposed_rate),
    rate_currency: str(r.rate_currency),
    response_due_at: str(r.response_due_at),
    bid_deadline: str(r.bid_deadline),
    attachments: files.slice(0, 50).flatMap((f) => {
      if (!f || typeof f !== 'object') return [];
      const name = maskContactDetails(str((f as Record<string, unknown>).name) ?? '');
      if (!name) return [];
      return [{ name, type: fileTypeLabel(name, str((f as Record<string, unknown>).type)), size: num((f as Record<string, unknown>).size) }];
    }),
    info_paused: r.info_paused === true,
  };
}
