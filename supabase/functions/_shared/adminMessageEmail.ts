/**
 * Admin messages (docs/sql/admin-message-email.sql): ONE shared message model and layout for the e-mail, the in-app
 * card (src/components/messages/MessageCard.tsx) and the admin compose preview. Pure TypeScript, no Deno or browser
 * APIs. Content is only what the person already sees in-app (stored title, text and message details); links are only
 * pages on our own site; every text is a React child (escaped). No tracking pixels or remote fonts.
 */

// ------------------------------------------------------------------ categories and copy

export const MESSAGE_CATEGORIES = ['notice', 'decision', 'action', 'reminder', 'update', 'welcome'] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];
export type Lang = 'en' | 'ar';

/** E-mail colours (in-app uses design tokens, see MessageCard). Light colours that also read well in dark clients. */
export const CATEGORY_EMAIL_COLOURS: Record<MessageCategory, { fg: string; bg: string }> = {
  notice: { fg: '#1D4ED8', bg: '#DBEAFE' },
  decision: { fg: '#1B2559', bg: '#E0E7FF' },
  action: { fg: '#92400E', bg: '#FEF3C7' },
  reminder: { fg: '#0F766E', bg: '#CCFBF1' },
  update: { fg: '#334155', bg: '#E2E8F0' },
  welcome: { fg: '#166534', bg: '#DCFCE7' },
};

export const MESSAGE_COPY = {
  en: {
    categories: { notice: 'Notice', decision: 'Decision', action: 'Request for action', reminder: 'Reminder', update: 'Update', welcome: 'Welcome' } as Record<MessageCategory, string>,
    contextKinds: { ticket: 'Ticket', agreement: 'Support agreement', invoice: 'Invoice', other: 'Related item' } as Record<string, string>,
    status: 'Status',
    todo: 'What you need to do',
    deadline: 'Deadline',
    open: 'Open',
    showMore: 'Show more',
    showLess: 'Show less',
    heading: 'A message from the AI Support 360 team',
    digest: (n: number) => `You have ${n} new messages from the team`,
    cta: 'Reply in the portal',
    allMessages: 'View all notifications',
    sentBy: 'Sent by the AI Support 360 team (admin)',
    replyNote: 'To answer, open the portal with the button above. Replies to this e-mail are not read.',
    help: 'Need help?',
    prefs: 'Notification settings',
    why: 'You receive this because an AI Support 360 administrator sent you this message in the portal.',
    test: 'Test message: only you received this.',
  },
  ar: {
    categories: { notice: 'إشعار', decision: 'قرار', action: 'مطلوب إجراء', reminder: 'تذكير', update: 'تحديث', welcome: 'ترحيب' } as Record<MessageCategory, string>,
    contextKinds: { ticket: 'تذكرة', agreement: 'اتفاقية دعم', invoice: 'فاتورة', other: 'عنصر مرتبط' } as Record<string, string>,
    status: 'الحالة',
    todo: 'المطلوب منك',
    deadline: 'الموعد النهائي',
    open: 'فتح',
    showMore: 'عرض المزيد',
    showLess: 'عرض أقل',
    heading: 'رسالة من فريق AI Support 360',
    digest: (n: number) => `لديك ${n} رسائل جديدة من الفريق`,
    cta: 'الرد عبر البوابة',
    allMessages: 'عرض كل الإشعارات',
    sentBy: 'أرسلها فريق AI Support 360 (المسؤول)',
    replyNote: 'للرد، افتح البوابة من الزر أعلاه. لا تتم قراءة الردود على هذا البريد.',
    help: 'تحتاج إلى مساعدة؟',
    prefs: 'إعدادات الإشعارات',
    why: 'تصلك هذه الرسالة لأن أحد مسؤولي AI Support 360 أرسلها إليك في البوابة.',
    test: 'رسالة تجريبية: وصلتك أنت فقط.',
  },
};
/** @deprecated kept for older imports; use MESSAGE_COPY. */
export const ADMIN_MESSAGE_COPY = MESSAGE_COPY;

/** Category of notices without stored details (mirrors ame_category in the SQL). */
export function categoryForType(type: string | null | undefined): MessageCategory {
  const t = String(type ?? '').trim();
  if (['approval', 'success', 'payment', 'invoice', 'rate', 'responsiveness'].includes(t)) return 'decision';
  if (['match_request', 'critical_request'].includes(t)) return 'action';
  if (t === 'reminder' || t.endsWith('_reminder') || t.startsWith('admin_reminder_')) return 'reminder';
  if (['welcome', 'account_welcome'].includes(t)) return 'welcome';
  if (['ticket', 'brd', 'session', 'sla', 'agreement', 'ticket_tracking'].includes(t)) return 'update';
  return 'notice';
}
export const isCategory = (v: unknown): v is MessageCategory => (MESSAGE_CATEGORIES as readonly string[]).includes(String(v));

// ------------------------------------------------------------------ links and text

export const DEFAULT_PATH = '/notifications';
export const PREFS_PATH = '/notifications/pause';
export const OWN_HOSTS = ['www.aisupport360.com', 'aisupport360.com'];
const PATH_RE = /^\/(?!\/)[A-Za-z0-9/_?=&.#%-]{0,199}$/;

/** A page on our site only ("/x/y"); anything else (full URLs, "//host", javascript:, spaces) becomes the inbox. */
export function safePortalPath(link: unknown): string {
  return typeof link === 'string' && PATH_RE.test(link.trim()) && !link.includes('..') ? link.trim() : DEFAULT_PATH;
}

/** Link inside a message body: our own pages only (relative or https on our host), else null (shown as plain text). */
export function safeHref(url: string, base: string): string | null {
  const u = url.trim();
  if (u.startsWith('/')) return PATH_RE.test(u) && !u.includes('..') ? `${base}${u}` : null;
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^\s]*)?$/i.exec(u);
  if (!m || !OWN_HOSTS.includes(m[1].toLowerCase())) return null;
  const path = m[2] ?? '/';
  return PATH_RE.test(path) && !path.includes('..') ? `${base}${path}` : null;
}

/** Plain text, no control characters (line breaks kept), at most `max` characters. */
export function clip(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim() : '';
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
/** Subject-safe single line. */
export const oneLine = (text: unknown, max: number) => clip(typeof text === 'string' ? text.replace(/[\r\n\t]+/g, ' ') : '', max);

export interface Inline { text: string; bold?: boolean; href?: string }
export type Block = { t: 'p'; lines: Inline[][] } | { t: 'ul' | 'ol'; items: Inline[][] };

/** Rich-text-lite: **bold**, [text](link) and bare links to our own site. Everything else is plain text. */
export function parseInline(line: string, base: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*\n]{1,200})\*\*|\[([^\]\n]{1,100})\]\(([^)\s]{1,250})\)|(https:\/\/[^\s)]{1,250})/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) { const href = safeHref(m[3], base); out.push(href ? { text: m[2], href } : { text: `${m[2]} (${m[3]})` }); }
    else { const href = safeHref(m[4], base); out.push(href ? { text: m[4], href } : { text: m[4] }); }
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out.filter((p) => p.text.length > 0);
}

const BULLET = /^\s*(?:[-*•–]|\u2022)\s+(.*)$/;
const NUMBER = /^\s*\d{1,2}[.)]\s+(.*)$/;
const LONG = 450;

/** Splits a long single paragraph at sentence ends into readable chunks (no walls of text). */
function splitLong(text: string): string[] {
  if (text.length <= LONG || text.includes('\n')) return [text];
  const sentences = text.split(/(?<=[.!?؟])\s+/);
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + ' ' + s).length > 300) { chunks.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Message body → short paragraphs and lists (keeps line breaks, detects "- " / "1." lists). */
export function formatBody(text: unknown, base: string, maxBlocks = 30): Block[] {
  const lines = clip(text, 4000).split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (!para.length) return;
    for (const chunk of splitLong(para.join('\n'))) blocks.push({ t: 'p', lines: chunk.split('\n').map((l) => parseInline(l, base)) });
    para = [];
  };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const b = BULLET.exec(line); const n = b ? null : NUMBER.exec(line);
    if (b || n) {
      flushPara();
      const kind = b ? 'ul' : 'ol';
      if (!list || list.t !== kind) { flushList(); list = { t: kind, items: [] }; }
      list.items.push(parseInline((b ?? n)![1], base));
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  return blocks.slice(0, maxBlocks);
}

export const plainText = (blocks: Block[]) => blocks.map((b) => b.t === 'p'
  ? b.lines.map((l) => l.map((p) => p.text).join('')).join('\n')
  : b.items.map((it, i) => `${b.t === 'ol' ? `${i + 1}.` : '•'} ${it.map((p) => p.text).join('')}`).join('\n')).join('\n\n');

// ------------------------------------------------------------------ message view (shared by e-mail, card, preview)

export interface MessageContext { kind: string; label: string; ref?: string; status?: string }
export interface MessageMeta { v?: number; category?: string; summary?: string; context?: MessageContext | null; action_label?: string; deadline?: string; test?: boolean }
export interface MessageInput { title?: string | null; body?: string | null; link?: string | null; type?: string | null; meta?: MessageMeta | null; created_at?: string | null }
export interface MessageView {
  category: MessageCategory; title: string; summary: string; blocks: Block[]; context: MessageContext | null;
  action: { label: string; deadline: string | null } | null; url: string; createdAt: string | null; structured: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildMessageView(n: MessageInput, base: string): MessageView {
  const b = base.replace(/\/+$/, '');
  const meta = (n.meta && typeof n.meta === 'object' ? n.meta : null) as MessageMeta | null;
  const ctx = meta?.context && typeof meta.context === 'object' && meta.context.label
    ? { kind: oneLine(meta.context.kind, 20) || 'other', label: oneLine(meta.context.label, 120), ref: oneLine(meta.context.ref, 40) || undefined, status: oneLine(meta.context.status, 40) || undefined }
    : null;
  const label = oneLine(meta?.action_label, 120);
  const deadline = typeof meta?.deadline === 'string' && DATE_RE.test(meta.deadline) ? meta.deadline : null;
  return {
    category: isCategory(meta?.category) ? meta!.category as MessageCategory : categoryForType(n.type),
    title: oneLine(n.title, 120) || '—',
    summary: oneLine(meta?.summary, 200),
    blocks: formatBody(n.body, b),
    context: ctx,
    action: label || deadline ? { label, deadline } : null,
    url: `${b}${safePortalPath(n.link)}`,
    createdAt: n.created_at ?? null,
    structured: !!meta?.v,
  };
}

/** "30 Oct 2026, 12:40 UTC" in the reader's language (fixed time zone so the e-mail and the card agree). */
export function formatSentAt(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}
export function formatDeadline(date: string | null | undefined, lang: Lang): string {
  if (!date || !DATE_RE.test(date)) return '';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ------------------------------------------------------------------ e-mail data from the worker claim

export interface ClaimItem { id: string; title?: string | null; body?: string | null; link?: string | null; type?: string | null; kind?: string; meta?: MessageMeta | null; created_at?: string | null }
export interface ClaimMail { mail_key: string; recipient: string; email: string; lang?: string; digest: boolean; important?: boolean; test?: boolean; items: ClaimItem[] }
export interface AdminMessageData {
  lang: Lang; digest: boolean; items: MessageView[]; url: string; inboxUrl: string; prefsUrl: string; helpHref: string; test?: boolean;
}

export const MESSAGE_LOGO = 'https://www.aisupport360.com/__l5e/assets-v1/94a9cd20-ec56-41c9-897e-534889a80659/brand-navy.png';

export function buildAdminMessageData(mail: ClaimMail, siteUrl: string, helpEmail = 'info@aisupport360.com'): AdminMessageData {
  const base = siteUrl.replace(/\/+$/, '');
  const items = (mail.items ?? []).slice(0, 20).map((i) => buildMessageView(i, base));
  const help = /^[a-z0-9._+-]+@aisupport360\.com$/i.test(helpEmail) ? helpEmail : 'info@aisupport360.com';
  return {
    lang: mail.lang === 'ar' ? 'ar' : 'en',
    digest: !!mail.digest && items.length > 1,
    items,
    url: items.length === 1 ? items[0].url : `${base}${DEFAULT_PATH}`,
    inboxUrl: `${base}${DEFAULT_PATH}`,
    prefsUrl: `${base}${PREFS_PATH}`,
    helpHref: `mailto:${help}`,
    test: !!mail.test,
  };
}

export function adminMessageSubject(d: Pick<AdminMessageData, 'lang' | 'digest' | 'items'>): string {
  const n = d.items?.length ?? 0;
  if (d.digest && n > 1) return d.lang === 'ar' ? `${n} رسائل جديدة من فريق AI Support 360` : `${n} new messages from the AI Support 360 team`;
  const it = d.items?.[0];
  const c = MESSAGE_COPY[d.lang === 'ar' ? 'ar' : 'en'];
  const t = oneLine(it?.title, 90);
  const cat = it ? c.categories[it.category] : '';
  return `${cat ? `${cat}: ` : ''}${t || c.heading} — AI Support 360`;
}

/** What the worker reports back for one e-mail (ame_finish). */
export function finishFor(result: { sent: boolean; reason?: string }): { status: 'sent' | 'skipped'; reason?: string } {
  if (result.sent) return { status: 'sent' };
  return { status: 'skipped', reason: result.reason === 'notifications_disabled' ? 'email_notifications_off' : result.reason ?? 'skipped' };
}

// ------------------------------------------------------------------ e-mail layout (createElement injected)

// deno-lint-ignore no-explicit-any
type H = (type: string, props: Record<string, unknown> | null, ...children: any[]) => unknown;

const F = 'Arial,Helvetica,sans-serif';
const st = {
  body: { margin: 0, padding: '24px 12px', backgroundColor: '#ffffff', fontFamily: F, color: '#0f172a' },
  wrap: { maxWidth: '600px', width: '100%', margin: '0 auto', border: '1px solid #e2e8f0', borderRadius: '16px', backgroundColor: '#ffffff', overflow: 'hidden' },
  head: { padding: '20px 24px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#ffffff' },
  main: { padding: '24px' },
  chip: (c: MessageCategory) => ({ display: 'inline-block', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.02em', color: CATEGORY_EMAIL_COLOURS[c].fg, backgroundColor: CATEGORY_EMAIL_COLOURS[c].bg }),
  h1: { fontSize: '22px', lineHeight: '1.3', color: '#1B2559', margin: '14px 0 6px' },
  summary: { fontSize: '16px', lineHeight: '1.5', color: '#475569', margin: '0 0 18px' },
  p: { fontSize: '15px', lineHeight: '1.65', color: '#334155', margin: '0 0 12px' },
  list: { fontSize: '15px', lineHeight: '1.6', color: '#334155', margin: '0 0 12px', paddingInlineStart: '22px' },
  a: { color: '#2563EB', textDecoration: 'underline' },
  ctx: { margin: '18px 0', padding: '14px 16px', borderRadius: '12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' },
  ctxKind: { fontSize: '12px', color: '#64748b', margin: '0 0 4px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  ctxLabel: { fontSize: '15px', fontWeight: 'bold', color: '#1B2559', margin: '0' },
  ctxMeta: { fontSize: '13px', color: '#475569', margin: '6px 0 0' },
  todo: { margin: '18px 0', padding: '14px 16px', borderRadius: '12px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' },
  todoH: { fontSize: '13px', fontWeight: 'bold', color: '#92400E', margin: '0 0 6px' },
  todoP: { fontSize: '15px', color: '#451A03', margin: '0', lineHeight: '1.5' },
  btn: { display: 'inline-block', backgroundColor: '#1B2559', color: '#ffffff', padding: '14px 28px', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', textDecoration: 'none' },
  btnWrap: { margin: '22px 0 10px' },
  second: { fontSize: '14px', color: '#2563EB', margin: '0 0 18px' },
  sent: { fontSize: '12px', color: '#64748b', margin: '18px 0 0', borderTop: '1px solid #e2e8f0', paddingTop: '14px' },
  foot: { padding: '16px 24px 22px', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0' },
  small: { fontSize: '12px', lineHeight: '1.55', color: '#64748b', margin: '0 0 6px' },
  test: { fontSize: '12px', fontWeight: 'bold', color: '#92400E', backgroundColor: '#FEF3C7', padding: '6px 10px', borderRadius: '8px', margin: '0 0 12px', display: 'inline-block' },
  card: { margin: '0 0 12px', padding: '14px 16px', borderRadius: '12px', border: '1px solid #e2e8f0' },
};

function inlines(h: H, parts: Inline[]) {
  return parts.map((p, i) => p.href
    ? h('a', { key: i, href: p.href, style: st.a }, p.bold ? h('strong', null, p.text) : p.text)
    : p.bold ? h('strong', { key: i }, p.text) : p.text);
}
export function renderBlocks(h: H, blocks: Block[]) {
  return blocks.map((b, i) => b.t === 'p'
    ? h('p', { key: i, style: st.p }, ...b.lines.flatMap((l, j) => (j ? [h('br', { key: `b${j}` }), ...inlines(h, l)] : inlines(h, l))))
    : h(b.t, { key: i, style: st.list }, ...b.items.map((it, j) => h('li', { key: j, style: { margin: '0 0 4px' } }, ...inlines(h, it)))));
}

function contextCard(h: H, v: MessageView, c: (typeof MESSAGE_COPY)['en']) {
  if (!v.context) return null;
  const k = c.contextKinds[v.context.kind] ?? c.contextKinds.other;
  const meta = [v.context.ref, v.context.status ? `${c.status}: ${v.context.status}` : ''].filter(Boolean).join(' · ');
  return h('div', { style: st.ctx },
    h('p', { style: st.ctxKind }, k),
    h('p', { style: st.ctxLabel }, v.context.label),
    meta ? h('p', { style: st.ctxMeta }, meta) : null);
}
function todoBox(h: H, v: MessageView, c: (typeof MESSAGE_COPY)['en'], lang: Lang) {
  if (!v.action) return null;
  return h('div', { style: st.todo },
    h('p', { style: st.todoH }, c.todo),
    v.action.label ? h('p', { style: st.todoP }, v.action.label) : null,
    v.action.deadline ? h('p', { style: { ...st.todoP, marginTop: '6px', fontWeight: 'bold' } }, `${c.deadline}: ${formatDeadline(v.action.deadline, lang)}`) : null);
}

export function renderAdminMessage(h: H, d: AdminMessageData) {
  const lang: Lang = d.lang === 'ar' ? 'ar' : 'en';
  const c = MESSAGE_COPY[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const items = d.items ?? [];
  const one = !d.digest ? items[0] : undefined;
  const preheader = d.digest ? c.digest(items.length) : (one?.summary || one?.title || c.heading);
  return h('html', { lang, dir },
    h('head', null,
      h('meta', { charSet: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('meta', { name: 'color-scheme', content: 'light dark' }),
      h('meta', { name: 'supported-color-schemes', content: 'light dark' })),
    h('body', { style: st.body },
      h('div', { style: { display: 'none', maxHeight: 0, overflow: 'hidden', opacity: 0 } }, preheader),
      h('div', { style: { ...st.wrap, direction: dir, textAlign: align } },
        h('div', { style: st.head },
          h('img', { src: MESSAGE_LOGO, width: 180, height: 40, alt: 'AI Support 360', style: { display: 'block', border: '0', width: '180px', height: '40px', maxWidth: '100%' } })),
        h('div', { style: st.main },
          d.test ? h('p', { style: st.test }, c.test) : null,
          ...(one
            ? [
                h('span', { style: st.chip(one.category) }, c.categories[one.category]),
                h('h1', { style: st.h1 }, one.title),
                one.summary ? h('p', { style: st.summary }, one.summary) : null,
                ...renderBlocks(h, one.blocks),
                contextCard(h, one, c),
                todoBox(h, one, c, lang),
                h('div', { style: st.btnWrap }, h('a', { href: one.url, style: st.btn }, c.cta)),
                h('p', { style: st.second }, h('a', { href: d.inboxUrl, style: st.a }, c.allMessages)),
                h('p', { style: st.sent }, [c.sentBy, formatSentAt(one.createdAt, lang)].filter(Boolean).join(' · ')),
              ]
            : [
                h('h1', { style: st.h1 }, c.digest(items.length)),
                ...items.map((it, i) => h('div', { key: i, style: st.card },
                  h('span', { style: st.chip(it.category) }, c.categories[it.category]),
                  h('p', { style: { ...st.ctxLabel, margin: '10px 0 4px' } }, it.title),
                  h('p', { style: { ...st.p, margin: '0 0 8px' } }, it.summary || oneLine(plainText(it.blocks), 220)),
                  it.action?.deadline ? h('p', { style: { ...st.ctxMeta, margin: '0 0 8px', fontWeight: 'bold' } }, `${c.deadline}: ${formatDeadline(it.action.deadline, lang)}`) : null,
                  h('a', { href: it.url, style: st.a }, c.open))),
                h('div', { style: st.btnWrap }, h('a', { href: d.url, style: st.btn }, c.cta)),
                h('p', { style: st.sent }, [c.sentBy, formatSentAt(items[items.length - 1]?.createdAt, lang)].filter(Boolean).join(' · ')),
              ])),
        h('div', { style: st.foot },
          h('p', { style: st.small }, c.replyNote),
          h('p', { style: st.small }, `${c.help} `, h('a', { href: d.helpHref, style: st.a }, d.helpHref.replace(/^mailto:/, ''))),
          h('p', { style: st.small }, c.why, ' ', h('a', { href: d.prefsUrl, style: st.a }, c.prefs))))));
}

export function adminMessageText(d: AdminMessageData): string {
  const lang: Lang = d.lang === 'ar' ? 'ar' : 'en';
  const c = MESSAGE_COPY[lang];
  const part = (v: MessageView) => [
    `[${c.categories[v.category]}] ${v.title}`,
    v.summary,
    plainText(v.blocks),
    v.context ? `${c.contextKinds[v.context.kind] ?? c.contextKinds.other}: ${v.context.label}${v.context.ref ? ` (${v.context.ref})` : ''}${v.context.status ? ` — ${c.status}: ${v.context.status}` : ''}` : '',
    v.action ? `${c.todo}: ${v.action.label}${v.action.deadline ? ` — ${c.deadline}: ${formatDeadline(v.action.deadline, lang)}` : ''}` : '',
    d.digest ? v.url : '',
  ].filter(Boolean).join('\n\n');
  const head = d.test ? `${c.test}\n\n` : '';
  const body = d.digest ? `${c.digest(d.items.length)}\n\n${d.items.map(part).join('\n\n---\n\n')}` : (d.items[0] ? part(d.items[0]) : c.heading);
  return `${head}${body}\n\n${c.cta}: ${d.url}\n\n${c.sentBy}\n${c.replyNote}\n${c.help} ${d.helpHref.replace(/^mailto:/, '')}\n${c.prefs}: ${d.prefsUrl}\n`;
}
