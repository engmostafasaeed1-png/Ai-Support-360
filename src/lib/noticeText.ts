/**
 * Cleans stored notice text for display: fills or drops the greeting name (never "Hello ,"), removes unknown placeholders
 * and stray punctuation (a trailing ";"), and splits the message into short paragraphs and bullet lists.
 * Pure text in, text out: React renders the result, so nothing here is ever treated as HTML.
 */
export type NoticeBlock = { type: 'p'; text: string } | { type: 'ul'; items: string[] };

const GREETING = /^(hello|hi|dear|good (morning|afternoon|evening)|مرحب[ًاٌ]*|مرحباً|أهلاً|اهلا|عزيزي)\b/i;
const URL_LINE = /^(?:[^\n:]{0,60}:\s*)?https?:\/\/\S+$/i;
const BULLET = /^\s*(?:[-•*·]|\d+[.)])\s+/;

export function cleanNoticeText(text: string | null | undefined, opts: { firstName?: string | null } = {}): string {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  const name = String(opts.firstName ?? '').trim().split(/\s+/)[0] ?? '';
  s = s.replace(/\{\{\s*first_name\s*\}\}/gi, name);
  s = s.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '');
  s = s.replace(/[ \t\u00a0]+([,،;:!?؟.])/g, '$1');          // "Hello ," -> "Hello,"   "مرحبًا ،" -> "مرحبًا،"
  s = s.replace(/[ \t\u00a0]{2,}/g, ' ');
  s = s.split('\n').map((l) => l.trim().replace(/[;,،]+$/, '')).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s.replace(/[\s;,،:]+$/, '');
}

const splitLong = (p: string, max = 240): string[] => {
  if (p.length <= max) return [p];
  const sentences = p.split(/(?<=[.!?؟])\s+/);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > max) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
};

/** Short paragraphs and bullet lists. `dropLinks`: lines that are only a web address go (the card has its own button). */
export function noticeBlocks(text: string | null | undefined, opts: { firstName?: string | null; dropLinks?: boolean } = {}): NoticeBlock[] {
  const clean = cleanNoticeText(text, opts);
  if (!clean) return [];
  const blocks: NoticeBlock[] = [];
  for (const para of clean.split(/\n\s*\n/)) {
    let lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (opts.dropLinks) lines = lines.filter((l) => !URL_LINE.test(l));
    let prose: string[] = [];
    let bullets: string[] = [];
    const flushProse = () => { if (prose.length) splitLong(prose.join(' ')).forEach((t) => blocks.push({ type: 'p', text: t })); prose = []; };
    const flushBullets = () => { if (bullets.length) blocks.push({ type: 'ul', items: bullets }); bullets = []; };
    for (const l of lines) {
      if (BULLET.test(l)) { flushProse(); bullets.push(l.replace(BULLET, '').replace(/[;,،]+$/, '')); }
      else { flushBullets(); prose.push(l); }
    }
    flushProse(); flushBullets();
  }
  return blocks;
}

export const isGreetingOnly = (s: string) => s.length <= 40 && GREETING.test(s.trim());

/** One plain line for a compact card: no greeting, no web addresses, bullets joined. */
export function noticePreview(text: string | null | undefined, opts: { max?: number } = {}): string {
  const blocks = noticeBlocks(text, { dropLinks: true });
  const parts = blocks.flatMap((b) => (b.type === 'p' ? [b.text] : b.items)).filter((p) => !isGreetingOnly(p));
  const line = parts.join(' ').replace(/\s+/g, ' ').trim();
  const max = opts.max ?? 220;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Test notices carry the [TEST] prefix in the title (and is_test in the database once the prepared SQL is applied). */
export const isTestNotice = (n: { title?: string | null; is_test?: boolean | null }) =>
  n.is_test === true || /^\s*\[TEST\]/i.test(String(n.title ?? ''));
export const stripTestPrefix = (title: string | null | undefined) => String(title ?? '').replace(/^\s*\[TEST\]\s*/i, '');
