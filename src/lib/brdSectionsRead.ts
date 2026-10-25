// "Has the consultant opened every BRD section?" — guidance for the Approve BRD button.
//
// Owner rule (Oct 25): Approve BRD stays dimmed until the consultant has opened every section of the exact version
// they are asked to approve. A section counts as opened once its end has been on screen in the BRD reader. This is
// screen guidance only (kept in this browser per ticket + version); the database still decides the approval itself
// (brd_decide_approval with the "I have read it" tick). Request changes / Decline are never held back by it.

import type { BlockedReason } from './blockedReasons';

/** Sections that must be opened: every visible section except the automatic change log. */
export function requiredSectionKeys(sections: ReadonlyArray<{ key: string; hidden?: boolean }>): string[] {
  return sections.filter((s) => !s.hidden && s.key !== 'change_log').map((s) => s.key);
}

export interface ReadProgress {
  /** null while the reader has not shown this version yet (the section list is unknown) */
  total: number | null;
  done: number;
  /** first section (in document order) that is still unopened */
  nextKey: string | null;
  complete: boolean;
}

export function readProgress(required: readonly string[] | null, opened: ReadonlySet<string> | readonly string[]): ReadProgress {
  if (!required) return { total: null, done: 0, nextKey: null, complete: false };
  const seen = opened instanceof Set ? opened : new Set(opened as readonly string[]);
  const done = required.filter((k) => seen.has(k)).length;
  const nextKey = required.find((k) => !seen.has(k)) ?? null;
  return { total: required.length, done, nextKey, complete: nextKey === null };
}

/** The Approve BRD block, or null once every section has been opened. */
export function approveReadReason(p: ReadProgress, onNext?: () => void): BlockedReason | null {
  if (p.complete) return null;
  if (p.total === null) return { key: 'brd_sections_not_opened', ...(onNext ? { onNext } : {}) };
  return { key: 'brd_sections_unread', params: { done: p.done, total: p.total }, ...(onNext ? { onNext } : {}) };
}

// ------------------------------------------------------------------ browser store (localStorage + live updates)

interface Entry { required: string[]; opened: string[] }
const PREFIX = 'brd-read:';
const EVENT = 'brd-read-change';
const GOTO = 'brd-reader-goto';
const keyOf = (ticketId: string, version: number) => `${PREFIX}${ticketId}:v${version}`;

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function loadEntry(ticketId: string, version: number): Entry | null {
  const raw = storage()?.getItem(keyOf(ticketId, version));
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Partial<Entry>;
    return { required: Array.isArray(e.required) ? e.required.map(String) : [], opened: Array.isArray(e.opened) ? e.opened.map(String) : [] };
  } catch { return null; }
}

function save(ticketId: string, version: number, e: Entry) {
  try { storage()?.setItem(keyOf(ticketId, version), JSON.stringify(e)); } catch { /* storage full or blocked: progress stays in memory only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { ticketId, version } }));
}

/** The reader tells which sections this version has (keeps sections already opened). */
export function registerSections(ticketId: string, version: number, required: readonly string[]) {
  const cur = loadEntry(ticketId, version);
  const same = cur && cur.required.length === required.length && cur.required.every((k, i) => k === required[i]);
  if (same) return;
  save(ticketId, version, { required: [...required], opened: (cur?.opened ?? []).filter((k) => required.includes(k)) });
}

export function markSectionOpened(ticketId: string, version: number, key: string) {
  const cur = loadEntry(ticketId, version) ?? { required: [], opened: [] };
  if (cur.opened.includes(key)) return;
  save(ticketId, version, { ...cur, opened: [...cur.opened, key] });
}

export function progressFor(ticketId: string, version: number): ReadProgress {
  const e = loadEntry(ticketId, version);
  return readProgress(e && e.required.length ? e.required : null, e?.opened ?? []);
}

export function onReadChange(cb: (d: { ticketId: string; version: number }) => void): () => void {
  const h = (ev: Event) => cb((ev as CustomEvent).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Ask the reader to show a version and scroll to a section (the "Go to the next section" step). */
export function requestGoto(ticketId: string, version: number, key: string | null) {
  window.dispatchEvent(new CustomEvent(GOTO, { detail: { ticketId, version, key } }));
}

export function onGoto(cb: (d: { ticketId: string; version: number; key: string | null }) => void): () => void {
  const h = (ev: Event) => cb((ev as CustomEvent).detail);
  window.addEventListener(GOTO, h);
  return () => window.removeEventListener(GOTO, h);
}

export const sectionAnchorId = (key: string) => `brd-s-${key}`;
