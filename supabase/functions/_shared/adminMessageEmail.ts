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


// ------------------------------------------------------------------ account / profile review decisions
// Written only by ame_decision_notice (docs/sql/admin-message-email.sql); the lists below mirror its checks.

export const DECISION_SUBJECTS = ['consultant_profile', 'client_account', 'certificate', 'linkedin', 'credly', 'document', 'success_story', 'account'] as const;
export const DECISION_OUTCOMES = ['approved', 'reapproved', 'changes', 'info', 'rejected', 'unverified', 'suspended', 'reactivated', 'review'] as const;
export type DecisionSubject = (typeof DECISION_SUBJECTS)[number];
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
export type DecisionBadge = 'approved' | 'changes' | 'rejected' | 'suspended' | 'review';
export interface DecisionMeta { subject?: string; outcome?: string; comment?: string | null; key?: string }
export interface DecisionView { subject: DecisionSubject; outcome: DecisionOutcome; badge: DecisionBadge; comment: string; steps: string[]; cta: string }

export const badgeFor = (o: DecisionOutcome): DecisionBadge =>
  o === 'approved' || o === 'reapproved' || o === 'reactivated' ? 'approved'
    : o === 'rejected' ? 'rejected' : o === 'suspended' ? 'suspended' : o === 'review' ? 'review' : 'changes';

export const DECISION_BADGE_COLOURS: Record<DecisionBadge, { fg: string; bg: string }> = {
  approved: { fg: '#166534', bg: '#DCFCE7' }, changes: { fg: '#92400E', bg: '#FEF3C7' }, rejected: { fg: '#991B1B', bg: '#FEE2E2' },
  suspended: { fg: '#991B1B', bg: '#FEE2E2' }, review: { fg: '#1D4ED8', bg: '#DBEAFE' },
};

const HELP = 'info@aisupport360.com';
export const DECISION_COPY = {
  en: {
    badges: { approved: 'Approved', changes: 'Needs changes', rejected: 'Rejected', suspended: 'Suspended', review: 'In review' } as Record<DecisionBadge, string>,
    nouns: { consultant_profile: 'consultant profile', client_account: 'company account', certificate: 'certificate', linkedin: 'LinkedIn profile', credly: 'Credly badges', document: 'document', success_story: 'success story', account: 'account' } as Record<DecisionSubject, string>,
    title: (o: DecisionOutcome, n: string) => ({
      approved: `Your ${n} is approved`, reapproved: `Your ${n} is approved again`, changes: `Your ${n} needs changes`,
      info: `We need more information about your ${n}`, rejected: `Your ${n} was not approved`, unverified: `Your ${n} is no longer verified`,
      suspended: `Your ${n} is suspended`, reactivated: `Your ${n} is active again`, review: `Your ${n} is under review`,
    })[o],
    intro: (o: DecisionOutcome, n: string, hasComment: boolean) => ({
      approved: `Welcome! An administrator reviewed and approved your ${n}.`,
      reapproved: `Good news: after a new review, your ${n} is approved again.`,
      changes: `An administrator asked you to update your ${n} before it can be approved.`,
      info: `An administrator needs more information before deciding on your ${n}.`,
      rejected: hasComment ? `An administrator reviewed your ${n} and could not approve it. The reason is below.`
        : `An administrator reviewed your ${n} and could not approve it, because it does not meet our current requirements yet.`,
      unverified: `After a review, the verified mark on your ${n} was removed.`,
      suspended: hasComment ? `An administrator suspended your ${n}. The reason is below.` : `An administrator suspended your ${n}.`,
      reactivated: `Your ${n} is active again. Welcome back.`,
      review: `An administrator is reviewing your ${n}. We will tell you when a decision is made.`,
    })[o],
    quote: 'Comment from the administrator',
    next: 'What you need to do next',
    appeal: `To appeal, write to ${HELP} or use Help in the portal, with any details that support your case.`,
    steps: {
      approved_consultant_profile: ['Keep your weekly availability up to date.', 'Check how clients see your profile.', 'Watch the portal for new request invitations.'],
      approved_client_account: ['Create your first support request.', 'Invite your team members.', 'Book a session with a consultant.'],
      approved: ['Nothing else is needed. The verified mark now shows on your profile.'],
      changes: ['Read the comment above.', 'Update the details in your profile.', 'Send it again for review.'],
      info: ['Read the comment above.', 'Add the missing information in your profile.', 'Send it again for review.'],
      rejected: ['Read the reason above.', 'If you can fix it, update your details and send them again.'],
      unverified: ['Read the comment above.', 'Correct or upload the item again in your profile.', 'We will check it again.'],
      suspended: ['Read the reason above.'],
      reactivated: ['Sign in again.', 'Check that your details are still correct.'],
      review: ['No action is needed now.', 'We will e-mail you when a decision is made.'],
    } as Record<string, string[]>,
    cta: { profile: 'Open your profile', account: 'Open the portal' },
    previewLine: (to: string) => `This comment will also be e-mailed to ${to}.`,
  },
  ar: {
    badges: { approved: 'تمت الموافقة', changes: 'يحتاج إلى تعديلات', rejected: 'مرفوض', suspended: 'موقوف', review: 'قيد المراجعة' } as Record<DecisionBadge, string>,
    nouns: { consultant_profile: 'ملفك كمستشار', client_account: 'حساب شركتك', certificate: 'الشهادة', linkedin: 'ملف LinkedIn', credly: 'شارات Credly', document: 'المستند', success_story: 'قصة النجاح', account: 'حسابك' } as Record<DecisionSubject, string>,
    title: (o: DecisionOutcome, n: string) => ({
      approved: `تمت الموافقة على ${n}`, reapproved: `تمت الموافقة مجددًا على ${n}`, changes: `يحتاج ${n} إلى تعديلات`,
      info: `نحتاج إلى مزيد من المعلومات حول ${n}`, rejected: `لم تتم الموافقة على ${n}`, unverified: `لم يعد ${n} موثّقًا`,
      suspended: `تم إيقاف ${n} مؤقتًا`, reactivated: `تمت إعادة تفعيل ${n}`, review: `${n} قيد المراجعة`,
    })[o],
    intro: (o: DecisionOutcome, n: string, hasComment: boolean) => ({
      approved: `مرحبًا بك! راجع أحد المسؤولين ${n} ووافق عليه.`,
      reapproved: `خبر سار: بعد مراجعة جديدة تمت الموافقة مجددًا على ${n}.`,
      changes: `طلب أحد المسؤولين تحديث ${n} قبل الموافقة عليه.`,
      info: `يحتاج أحد المسؤولين إلى مزيد من المعلومات قبل اتخاذ قرار بشأن ${n}.`,
      rejected: hasComment ? `راجع أحد المسؤولين ${n} ولم يتمكن من الموافقة عليه. السبب مذكور أدناه.`
        : `راجع أحد المسؤولين ${n} ولم يتمكن من الموافقة عليه، لأنه لا يستوفي متطلباتنا الحالية بعد.`,
      unverified: `بعد المراجعة، أُزيلت علامة التوثيق عن ${n}.`,
      suspended: hasComment ? `أوقف أحد المسؤولين ${n} مؤقتًا. السبب مذكور أدناه.` : `أوقف أحد المسؤولين ${n} مؤقتًا.`,
      reactivated: `أصبح ${n} نشطًا من جديد. مرحبًا بعودتك.`,
      review: `يراجع أحد المسؤولين ${n} الآن. سنبلغك عند اتخاذ القرار.`,
    })[o],
    quote: 'تعليق المسؤول',
    next: 'ما الذي عليك فعله بعد ذلك',
    appeal: `للاعتراض، راسلنا على ${HELP} أو استخدم صفحة المساعدة في البوابة، مع أي تفاصيل تدعم طلبك.`,
    steps: {
      approved_consultant_profile: ['حدّث جدول توفرك الأسبوعي باستمرار.', 'تحقق من الطريقة التي يرى بها العملاء ملفك.', 'تابع البوابة لدعوات الطلبات الجديدة.'],
      approved_client_account: ['أنشئ أول طلب دعم.', 'ادعُ أعضاء فريقك.', 'احجز جلسة مع مستشار.'],
      approved: ['لا يلزم أي إجراء آخر. علامة التوثيق تظهر الآن في ملفك.'],
      changes: ['اقرأ التعليق أعلاه.', 'حدّث البيانات في ملفك.', 'أرسله مجددًا للمراجعة.'],
      info: ['اقرأ التعليق أعلاه.', 'أضف المعلومات الناقصة في ملفك.', 'أرسله مجددًا للمراجعة.'],
      rejected: ['اقرأ السبب أعلاه.', 'إذا أمكنك معالجته، حدّث بياناتك وأرسلها مجددًا.'],
      unverified: ['اقرأ التعليق أعلاه.', 'صحّح العنصر أو ارفعه مجددًا في ملفك.', 'سنراجعه مرة أخرى.'],
      suspended: ['اقرأ السبب أعلاه.'],
      reactivated: ['سجّل الدخول من جديد.', 'تحقق من أن بياناتك ما زالت صحيحة.'],
      review: ['لا يلزم أي إجراء الآن.', 'سنراسلك بالبريد عند اتخاذ القرار.'],
    } as Record<string, string[]>,
    cta: { profile: 'افتح ملفك', account: 'افتح البوابة' },
    previewLine: (to: string) => `سيُرسل هذا التعليق أيضًا بالبريد الإلكتروني إلى ${to}.`,
  },
};

const isSubject = (v: unknown): v is DecisionSubject => (DECISION_SUBJECTS as readonly string[]).includes(String(v));
const isOutcome = (v: unknown): v is DecisionOutcome => (DECISION_OUTCOMES as readonly string[]).includes(String(v));

/** Next steps for a decision (approved profile/account get their own welcome list; rejected and suspended add how to appeal). */
export function decisionSteps(subject: DecisionSubject, outcome: DecisionOutcome, lang: Lang): string[] {
  const c = DECISION_COPY[lang];
  const base = (outcome === 'approved' || outcome === 'reapproved') && c.steps[`approved_${subject}`] ? c.steps[`approved_${subject}`]
    : outcome === 'reapproved' ? c.steps.approved : c.steps[outcome] ?? [];
  return outcome === 'rejected' || outcome === 'suspended' ? [...base, c.appeal] : base;
}

/** The decision part of a message, or null when the notice is not a review decision. */
export function buildDecisionView(d: DecisionMeta | null | undefined, lang: Lang): DecisionView | null {
  if (!d || !isSubject(d.subject) || !isOutcome(d.outcome)) return null;
  const c = DECISION_COPY[lang];
  return {
    subject: d.subject, outcome: d.outcome, badge: badgeFor(d.outcome), comment: clip(d.comment, 2000),
    steps: decisionSteps(d.subject, d.outcome, lang),
    cta: d.subject === 'account' ? c.cta.account : c.cta.profile,
  };
}
export const decisionTitle = (d: DecisionView, lang: Lang) => DECISION_COPY[lang].title(d.outcome, DECISION_COPY[lang].nouns[d.subject]);
export const decisionIntro = (d: DecisionView, lang: Lang) => DECISION_COPY[lang].intro(d.outcome, DECISION_COPY[lang].nouns[d.subject], !!d.comment);

// ------------------------------------------------------------------ message view (shared by e-mail, card, preview)

export interface MessageContext { kind: string; label: string; ref?: string; status?: string }
export interface MessageMeta { v?: number; category?: string; summary?: string; context?: MessageContext | null; action_label?: string; deadline?: string; test?: boolean; decision?: DecisionMeta | null }
export interface MessageInput { title?: string | null; body?: string | null; link?: string | null; type?: string | null; meta?: MessageMeta | null; created_at?: string | null }
export interface MessageView {
  category: MessageCategory; title: string; summary: string; blocks: Block[]; context: MessageContext | null;
  action: { label: string; deadline: string | null } | null; url: string; createdAt: string | null; structured: boolean;
  decision: DecisionView | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildMessageView(n: MessageInput, base: string, lang: Lang = 'en'): MessageView {
  const b = base.replace(/\/+$/, '');
  const meta = (n.meta && typeof n.meta === 'object' ? n.meta : null) as MessageMeta | null;
  const decision = buildDecisionView(meta?.decision, lang);
  const ctx = meta?.context && typeof meta.context === 'object' && meta.context.label
    ? { kind: oneLine(meta.context.kind, 20) || 'other', label: oneLine(meta.context.label, 120), ref: oneLine(meta.context.ref, 40) || undefined, status: oneLine(meta.context.status, 40) || undefined }
    : null;
  const label = oneLine(meta?.action_label, 120);
  const deadline = typeof meta?.deadline === 'string' && DATE_RE.test(meta.deadline) ? meta.deadline : null;
  return {
    // Decisions are shown in the reader's language from the stored decision (the stored text is the English copy).
    category: decision ? 'decision' : isCategory(meta?.category) ? meta!.category as MessageCategory : categoryForType(n.type),
    title: decision ? decisionTitle(decision, lang) : oneLine(n.title, 120) || '—',
    summary: oneLine(meta?.summary, 200),
    blocks: decision ? formatBody(decisionIntro(decision, lang), b) : formatBody(n.body, b),
    context: ctx,
    action: label || deadline ? { label, deadline } : null,
    url: `${b}${safePortalPath(n.link)}`,
    createdAt: n.created_at ?? null,
    structured: !!meta?.v,
    decision,
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
  const lang: Lang = mail.lang === 'ar' ? 'ar' : 'en';
  const items = (mail.items ?? []).slice(0, 20).map((i) => buildMessageView(i, base, lang));
  const help = /^[a-z0-9._+-]+@aisupport360\.com$/i.test(helpEmail) ? helpEmail : 'info@aisupport360.com';
  return {
    lang,
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
  const badge = it?.decision ? ` (${DECISION_COPY[d.lang === 'ar' ? 'ar' : 'en'].badges[it.decision.badge]})` : '';
  return `${cat ? `${cat}: ` : ''}${t || c.heading}${badge} — AI Support 360`;
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
  badge: (b: DecisionBadge) => ({ display: 'inline-block', marginInlineStart: '6px', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold', color: DECISION_BADGE_COLOURS[b].fg, backgroundColor: DECISION_BADGE_COLOURS[b].bg, border: `1px solid ${DECISION_BADGE_COLOURS[b].fg}33` }),
  quote: { margin: '16px 0', padding: '14px 16px', borderRadius: '12px', backgroundColor: '#EFF6FF', borderInlineStart: '4px solid #3B82F6' },
  quoteH: { fontSize: '12px', fontWeight: 'bold', color: '#1D4ED8', margin: '0 0 6px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  next: { margin: '18px 0', padding: '14px 16px', borderRadius: '12px', backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1' },
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

function decisionParts(h: H, v: MessageView, lang: Lang) {
  if (!v.decision) return [];
  const c = DECISION_COPY[lang];
  const d = v.decision;
  return [
    d.comment ? h('div', { style: st.quote },
      h('p', { style: st.quoteH }, c.quote),
      ...renderBlocks(h, formatBody(d.comment, ''))) : null,
    d.steps.length ? h('div', { style: st.next },
      h('p', { style: { ...st.todoH, color: '#1B2559' } }, c.next),
      h('ol', { style: { ...st.list, margin: '0' } }, ...d.steps.map((x, i) => h('li', { key: i, style: { margin: '0 0 4px' } }, x)))) : null,
  ];
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
                h('p', { style: { margin: 0 } },
                  h('span', { style: st.chip(one.category) }, c.categories[one.category]),
                  one.decision ? h('span', { style: st.badge(one.decision.badge) }, DECISION_COPY[lang].badges[one.decision.badge]) : null),
                h('h1', { style: st.h1 }, one.title),
                one.summary ? h('p', { style: st.summary }, one.summary) : null,
                ...renderBlocks(h, one.blocks),
                ...decisionParts(h, one, lang),
                contextCard(h, one, c),
                todoBox(h, one, c, lang),
                h('div', { style: st.btnWrap }, h('a', { href: one.url, style: st.btn }, one.decision?.cta ?? c.cta)),
                h('p', { style: st.second }, h('a', { href: d.inboxUrl, style: st.a }, c.allMessages)),
                h('p', { style: st.sent }, [c.sentBy, formatSentAt(one.createdAt, lang)].filter(Boolean).join(' · ')),
              ]
            : [
                h('h1', { style: st.h1 }, c.digest(items.length)),
                ...items.map((it, i) => h('div', { key: i, style: st.card },
                  h('span', { style: st.chip(it.category) }, c.categories[it.category]),
                  it.decision ? h('span', { style: st.badge(it.decision.badge) }, DECISION_COPY[lang].badges[it.decision.badge]) : null,
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
    v.decision ? [`${DECISION_COPY[lang].badges[v.decision.badge]}`, v.decision.comment ? `${DECISION_COPY[lang].quote}:\n"${v.decision.comment}"` : '',
      `${DECISION_COPY[lang].next}:\n${v.decision.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}`].filter(Boolean).join('\n\n') : '',
    v.context ? `${c.contextKinds[v.context.kind] ?? c.contextKinds.other}: ${v.context.label}${v.context.ref ? ` (${v.context.ref})` : ''}${v.context.status ? ` — ${c.status}: ${v.context.status}` : ''}` : '',
    v.action ? `${c.todo}: ${v.action.label}${v.action.deadline ? ` — ${c.deadline}: ${formatDeadline(v.action.deadline, lang)}` : ''}` : '',
    d.digest ? v.url : '',
  ].filter(Boolean).join('\n\n');
  const head = d.test ? `${c.test}\n\n` : '';
  const body = d.digest ? `${c.digest(d.items.length)}\n\n${d.items.map(part).join('\n\n---\n\n')}` : (d.items[0] ? part(d.items[0]) : c.heading);
  return `${head}${body}\n\n${c.cta}: ${d.url}\n\n${c.sentBy}\n${c.replyNote}\n${c.help} ${d.helpHref.replace(/^mailto:/, '')}\n${c.prefs}: ${d.prefsUrl}\n`;
}
