// Word-level diff for BRD versions and AI suggestions ("added / removed text per section"). Pure, unit-tested.
// Longest-common-subsequence over word tokens; very large inputs fall back to a line diff, then to replace-all,
// so the browser never freezes on a huge section.

import { SECTION_TITLES, htmlToText, type BrdContent, type SectionKey } from './brdModel.ts';

export type DiffOp = { type: 'eq' | 'add' | 'del'; text: string };

const MAX_CELLS = 1_500_000;

function tokenize(s: string): string[] {
  return String(s ?? '').match(/\s+|[^\s]+/g) ?? [];
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Trim the common prefix and suffix first (most edits are local).
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head: DiffOp[] = start ? [{ type: 'eq', text: a.slice(0, start).join('') }] : [];
  const tail: DiffOp[] = endA < n ? [{ type: 'eq', text: a.slice(endA).join('') }] : [];
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  if (!A.length && !B.length) return [...head, ...tail];
  if (!A.length) return [...head, { type: 'add', text: B.join('') }, ...tail];
  if (!B.length) return [...head, { type: 'del', text: A.join('') }, ...tail];
  if (A.length * B.length > MAX_CELLS) return [...head, { type: 'del', text: A.join('') }, { type: 'add', text: B.join('') }, ...tail];
  const rows = A.length + 1;
  const cols = B.length + 1;
  const dp = new Uint32Array(rows * cols);
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      // Words weigh more than whitespace, so the diff keeps real words in common instead of spaces.
      dp[i * cols + j] = A[i] === B[j] ? dp[(i + 1) * cols + j + 1] + (/\S/.test(A[i]) ? 2 : 1) : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { ops.push({ type: 'eq', text: A[i] }); i++; j++; }
    else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) { ops.push({ type: 'del', text: A[i] }); i++; }
    else { ops.push({ type: 'add', text: B[j] }); j++; }
  }
  while (i < A.length) ops.push({ type: 'del', text: A[i++] });
  while (j < B.length) ops.push({ type: 'add', text: B[j++] });
  return [...head, ...ops, ...tail];
}

/** Adjacent operations of the same kind merged; a lone whitespace "eq" between two changes is folded into them. */
export function mergeOps(ops: readonly DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    if (!op.text) continue;
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else out.push({ ...op });
  }
  return out;
}

export function diffText(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length * b.length > MAX_CELLS * 4) {
    // Line diff for very long texts.
    const la = String(before ?? '').split(/(?<=\n)/);
    const lb = String(after ?? '').split(/(?<=\n)/);
    return mergeOps(lcsOps(la, lb));
  }
  return mergeOps(lcsOps(a, b));
}

export function diffStats(ops: readonly DiffOp[]): { added: number; removed: number } {
  const words = (s: string) => (s.match(/[^\s]+/g) ?? []).length;
  return ops.reduce((acc, op) => {
    if (op.type === 'add') acc.added += words(op.text);
    if (op.type === 'del') acc.removed += words(op.text);
    return acc;
  }, { added: 0, removed: 0 });
}

export const isUnchanged = (ops: readonly DiffOp[]) => ops.every((o) => o.type === 'eq');

export interface SectionDiff {
  key: SectionKey | 'control' | 'requirements';
  title: string;
  ops: DiffOp[];
  opsAr?: DiffOp[];
  changed: boolean;
  /** Shown / hidden changed between the two versions. */
  visibility?: { before: boolean; after: boolean };
  moved?: boolean;
}

function controlText(c: BrdContent['control']): string {
  return [`Title: ${c.title}`, `Company: ${c.company}`, `Requester: ${c.requester}`, `Date: ${c.date}`, `Status: ${c.status}`, `Approvers: ${c.approvers}`].join('\n');
}

function requirementsText(r: BrdContent['requirements']): string {
  return r.map((q) => `${q.id} [${q.priority}/${q.status}] ${q.description}${q.description_ar ? ` / ${q.description_ar}` : ''} — ${q.owner} — ${q.acceptance}${q.acceptance_ar ? ` / ${q.acceptance_ar}` : ''}`).join('\n');
}

/** Per-section comparison of two versions (document control, every section, the requirements table). */
export function diffContents(before: BrdContent, after: BrdContent, lang: 'en' | 'ar' = 'en'): SectionDiff[] {
  const out: SectionDiff[] = [];
  const ctl = diffText(controlText(before.control), controlText(after.control));
  out.push({ key: 'control', title: lang === 'ar' ? 'بيانات الوثيقة' : 'Document control', ops: ctl, changed: !isUnchanged(ctl) });
  const orderA = before.sections.map((s) => s.key);
  const orderB = after.sections.map((s) => s.key);
  for (const sb of after.sections) {
    if (sb.key === 'change_log') continue;
    const sa = before.sections.find((s) => s.key === sb.key);
    const ops = diffText(htmlToText(sa?.html ?? ''), htmlToText(sb.html));
    const opsAr = sb.html_ar !== undefined || sa?.html_ar !== undefined ? diffText(htmlToText(sa?.html_ar ?? ''), htmlToText(sb.html_ar ?? '')) : undefined;
    const visBefore = !(sa?.hidden ?? true);
    const visAfter = !sb.hidden;
    const moved = orderA.indexOf(sb.key) !== orderB.indexOf(sb.key);
    out.push({
      key: sb.key,
      title: SECTION_TITLES[sb.key][lang],
      ops,
      ...(opsAr ? { opsAr } : {}),
      changed: !isUnchanged(ops) || (opsAr ? !isUnchanged(opsAr) : false) || visBefore !== visAfter,
      ...(visBefore !== visAfter ? { visibility: { before: visBefore, after: visAfter } } : {}),
      ...(moved ? { moved } : {}),
    });
  }
  const req = diffText(requirementsText(before.requirements), requirementsText(after.requirements));
  out.push({ key: 'requirements', title: lang === 'ar' ? 'جدول المتطلبات' : 'Requirements table', ops: req, changed: !isUnchanged(req) });
  return out;
}
