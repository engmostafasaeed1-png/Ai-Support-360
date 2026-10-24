// Turns the ticket the client owns into the untrusted parts of the BRD prompt (pure, unit-tested).
// The client ticks which parts go in; the title always does. Attachments arrive as text the browser already
// extracted from the client's own files (never the binary), capped by count and length from the admin settings.

import type { TicketPart } from './brdPrompt.ts';

export const INCLUDE_KEYS = ['description', 'sap_area', 'environment', 'urgency', 'notes_tried', 'answers', 'attachments'] as const;
export type IncludeKey = (typeof INCLUDE_KEYS)[number];
export type IncludeFlags = Partial<Record<IncludeKey, boolean>>;

export interface TicketRowForBrd {
  title?: string | null;
  description?: string | null;
  sap_module?: string | null;
  sap_modules?: string[] | null;
  sap_module_other?: string | null;
  area_details?: string | null;
  sap_notes_tried?: string[] | null;
  urgency?: string | null;
  critical_response?: boolean | null;
  ticket_context?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface InfoAnswer { question?: string | null; answer?: string | null }
export interface AttachmentText { name: string; text: string }

const CONTEXT_LABELS: Record<string, string> = {
  industry: 'Industry', customer_segment: 'Customer segment', country: 'Country', project_type: 'Project type',
  vertical_solutions: 'Vertical solutions', localization_solutions: 'Localization solutions',
};

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function safeFileLabel(name: string): string {
  return String(name ?? '').replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 80) || 'file';
}

export function buildTicketParts(opts: {
  ticket: TicketRowForBrd;
  include: IncludeFlags;
  answers?: readonly InfoAnswer[];
  attachments?: readonly AttachmentText[];
  clientAnswers?: ReadonlyArray<{ question: string; answer: string }>;
  maxAttachments: number;
  maxAttachmentChars: number;
}): TicketPart[] {
  const { ticket: t, include } = opts;
  const on = (k: IncludeKey) => include[k] !== false;
  const parts: TicketPart[] = [{ name: 'title', text: s(t.title) }];
  if (on('description') && s(t.description)) parts.push({ name: 'description', text: s(t.description) });
  if (on('sap_area')) {
    const modules = Array.from(new Set([s(t.sap_module), ...(t.sap_modules ?? []).map(s)].filter(Boolean)));
    const lines = [
      modules.length ? `SAP modules: ${modules.join(', ')}` : '',
      s(t.sap_module_other) ? `Other area: ${s(t.sap_module_other)}` : '',
      s(t.area_details) ? `Area details: ${s(t.area_details)}` : '',
    ].filter(Boolean);
    if (lines.length) parts.push({ name: 'sap_area', text: lines.join('\n') });
  }
  if (on('environment') && t.ticket_context && typeof t.ticket_context === 'object') {
    const lines: string[] = [];
    for (const [key, label] of Object.entries(CONTEXT_LABELS)) {
      const v = (t.ticket_context as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.trim()) lines.push(`${label}: ${v.trim()}`);
      else if (Array.isArray(v) && v.length) lines.push(`${label}: ${v.filter((x) => typeof x === 'string').join(', ')}`);
    }
    if (lines.length) parts.push({ name: 'environment', text: lines.join('\n') });
  }
  if (on('urgency') && s(t.urgency)) {
    parts.push({ name: 'urgency', text: `Urgency: ${s(t.urgency)}${t.critical_response ? ' (critical response requested)' : ''}${t.created_at ? `\nRequest created: ${String(t.created_at).slice(0, 10)}` : ''}` });
  }
  if (on('notes_tried') && (t.sap_notes_tried ?? []).some((x) => s(x))) {
    parts.push({ name: 'notes_tried', text: `SAP Notes / steps already tried:\n${(t.sap_notes_tried ?? []).map(s).filter(Boolean).map((x) => `- ${x}`).join('\n')}` });
  }
  if (on('answers')) {
    const qa = (opts.answers ?? []).filter((a) => s(a.answer)).slice(0, 10)
      .map((a) => `Question from a consultant: ${s(a.question)}\nClient's answer: ${s(a.answer)}`);
    if (qa.length) parts.push({ name: 'answers', text: qa.join('\n\n') });
  }
  if (on('attachments')) {
    for (const a of (opts.attachments ?? []).slice(0, Math.max(0, opts.maxAttachments))) {
      const text = s(a.text);
      if (!text) continue;
      parts.push({ name: 'attachment', text: `File: ${safeFileLabel(a.name)}\n${text.slice(0, opts.maxAttachmentChars)}`, max: opts.maxAttachmentChars + 100 });
    }
  }
  const ca = (opts.clientAnswers ?? []).filter((x) => s(x.answer)).slice(0, 8);
  if (ca.length) parts.push({ name: 'client_answers', text: ca.map((x) => `Q: ${s(x.question)}\nA: ${s(x.answer)}`).join('\n\n') });
  return parts;
}
