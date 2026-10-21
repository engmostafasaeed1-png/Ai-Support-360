/**
 * Feature N: the Consultant Service Policy e-mail (first notice, reminder, admin reminder) with the FULL published policy.
 * Pure TypeScript shared by the e-mail template, the preview and the tests. The layout is built with the caller's
 * createElement (React in the template and the tests), so every database text is escaped by React; no HTML string is
 * ever assembled here. Table-based, inline styles only, max 640 px, no external fonts or scripts, brand images only.
 */
import { readPolicyMinutes } from './assignmentPolicy.ts';
import { readRespSettings } from './responsiveness.ts';

export type PolicyEmailLang = 'en' | 'ar';

/** Key numbers shown in the mail, read from the real platform settings (minutes / counts / days). */
export interface PolicyEmailNumbers {
  r1: number; r2: number; r3: number; expire: number;
  criticalR1: number; criticalR2: number; criticalR3: number; criticalExpire: number;
  minSample: number; notices: number; disputeDays: number; windowDays: number; graceDays: number;
}

/** Statistics use a fixed rolling 90-day window (docs/sql/responsiveness.sql); it is not an admin setting. */
export const POLICY_EMAIL_WINDOW_DAYS = 90;

export function policyEmailNumbers(minutesRaw: unknown, respRaw: unknown, graceDays: unknown): PolicyEmailNumbers {
  const m = readPolicyMinutes(minutesRaw);
  const r = readRespSettings(respRaw);
  const g = Number(graceDays);
  return {
    r1: m.r1, r2: m.r2, r3: m.r3, expire: m.expire,
    criticalR1: m.critical_r1, criticalR2: m.critical_r2, criticalR3: m.critical_r3, criticalExpire: m.critical_expire,
    minSample: r.min_sample, notices: r.warnings, disputeDays: r.dispute_days,
    windowDays: POLICY_EMAIL_WINDOW_DAYS, graceDays: Number.isInteger(g) && g >= 0 && g <= 90 ? g : 7,
  };
}

export const POLICY_EMAIL_NUMBER_DEFAULTS: PolicyEmailNumbers = policyEmailNumbers(null, null, 7);

export interface PolicyEmailProps {
  lang?: string;
  kind?: 'notice' | 'reminder' | 'manual' | string;
  name?: string;
  version?: number;
  title?: string;
  summary?: string;
  /** Published policy text (body_en or body_ar): "## " section, "- " bullet, "> " highlighted note, other lines paragraphs. */
  body?: string;
  /** Already formatted for the reader. */
  effectiveDate?: string;
  /** Already formatted for the reader: grace end from consultant_policy_state. */
  deadline?: string;
  deadlinePassed?: boolean;
  numbers?: Partial<PolicyEmailNumbers>;
  confirmUrl?: string;
  policyUrl?: string;
  privacyUrl?: string;
}

export const POLICY_EMAIL_SITE = 'https://www.aisupport360.com';
export const POLICY_EMAIL_CONFIRM_PATH = '/consultant/profile#service-policy';
/** White-on-navy brand logo (brand asset). */
export const POLICY_EMAIL_LOGO = `${POLICY_EMAIL_SITE}/__l5e/assets-v1/94a9cd20-ec56-41c9-897e-534889a80659/brand-navy.png`;

const DRAFT_NOTES = [
  'Draft - have your lawyer review this text before relying on it.',
  'مسودة - اطلب من محاميك مراجعة هذا النص قبل الاعتماد عليه.',
];

// ---------------------------------------------------------------- body parsing

export interface PolicyEmailBlock { kind: 'p' | 'li' | 'note'; text: string }
export interface PolicyEmailSection { number: string; heading: string; anchor: string; blocks: PolicyEmailBlock[] }
export interface PolicyEmailBody { notes: string[]; intro: PolicyEmailBlock[]; sections: PolicyEmailSection[] }

/** Splits the published text into a lead (draft marker, notes) and numbered sections. Never drops or shortens text. */
export function parsePolicyEmailBody(body: string | undefined | null): PolicyEmailBody {
  const out: PolicyEmailBody = { notes: [], intro: [], sections: [] };
  let cur: PolicyEmailSection | null = null;
  for (const raw of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ') || line.startsWith('# ')) {
      const h = line.replace(/^#+\s*/, '');
      const m = h.match(/^(\d+)[.)]\s*(.*)$/);
      const n = out.sections.length + 1;
      cur = { number: m ? m[1] : String(n), heading: m ? (m[2] || h) : h, anchor: `s${n}`, blocks: [] };
      out.sections.push(cur);
      continue;
    }
    let block: PolicyEmailBlock;
    if (DRAFT_NOTES.includes(line)) block = { kind: 'note', text: line };
    else if (line.startsWith('> ')) block = { kind: 'note', text: line.slice(2).trim() };
    else if (/^(note|ملاحظة)\s*:/i.test(line)) block = { kind: 'note', text: line };
    else if (line.startsWith('- ') || line.startsWith('* ')) block = { kind: 'li', text: line.slice(2).trim() };
    else block = { kind: 'p', text: line };
    if (cur) cur.blocks.push(block);
    else if (block.kind === 'note') out.notes.push(block.text);
    else out.intro.push(block);
  }
  return out;
}

// ---------------------------------------------------------------- wording

function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Short duration for the reader: 2 h, 30 min, 1 day / ساعتان، 30 دقيقة، يوم واحد. */
export function formatPolicyDuration(minutes: number, lang: PolicyEmailLang): string {
  const m = Math.max(0, Math.round(minutes));
  if (lang === 'ar') {
    if (m > 0 && m % 1440 === 0) return arCount(m / 1440, 'يوم واحد', 'يومان', 'أيام', 'يومًا');
    if (m > 0 && m % 60 === 0) return arCount(m / 60, 'ساعة واحدة', 'ساعتان', 'ساعات', 'ساعة');
    if (m < 60) return arCount(m, 'دقيقة واحدة', 'دقيقتان', 'دقائق', 'دقيقة');
    return `${Math.floor(m / 60)} س ${m % 60} د`;
  }
  if (m > 0 && m % 1440 === 0) return m === 1440 ? '1 day' : `${m / 1440} days`;
  if (m > 0 && m % 60 === 0) return `${m / 60} h`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const days = (n: number, lang: PolicyEmailLang) => formatPolicyDuration(n * 1440, lang);

export interface PolicyWhyCard { icon: string; title: string; text: string }

export const POLICY_EMAIL_STR = {
  en: {
    brand: 'AI Support 360',
    title: (v: number) => `Our Consultant Service Policy - version ${v}`,
    effective: (d: string) => `Effective ${d}`,
    confirmBy: (d: string) => `Please confirm by ${d}`,
    confirmEnded: (d: string) => `The confirmation period ended on ${d} - please confirm now`,
    confirmWindow: (g: string) => `You have ${g} to confirm from the first time you see it in your portal`,
    neverBlocked: 'Signing in, reading and confirming are never blocked, and your current work is not affected.',
    afterDeadline: 'If the date passes before you confirm, you cannot accept new assignments or place new bids, and you are not shown in search, matching or Critical alerts - only until you confirm. Tickets you already have continue as normal.',
    hello: (name?: string) => (name ? `Hello ${name},` : 'Hello,'),
    introNotice: (v: number) => `We have published version ${v} of our Consultant Service Policy. It sets out, in one place, what clients can expect from consultants on AI Support 360, what you can expect from us, and why these rules exist. Please take a few minutes to read it and confirm it in your portal.`,
    introReminder: (v: number) => `A friendly reminder: version ${v} of our Consultant Service Policy is still waiting for your confirmation. The full text is below, together with the reasons behind it - confirming takes about a minute.`,
    button: 'Read and confirm',
    whyTitle: 'Why we have this policy',
    whyLead: 'Rules only help when everyone understands the reason behind them. This is why the policy exists:',
    cards: (n: PolicyEmailNumbers): PolicyWhyCard[] => [
      { icon: '⚡', title: 'Faster answers win more work', text: 'A client with an SAP problem usually needs help quickly. When requests are answered fast, clients keep choosing the portal and trust its consultants - and that means more requests for you.' },
      { icon: '⚖️', title: 'Fair to you', text: `Statistics count only requests that arrive while you are available. Friendly notices always come first, you can dispute a no-response within ${days(n.disputeDays, 'en')}, and your figures recover over time.` },
      { icon: '🛡️', title: 'Protection for everyone', text: 'Working through the platform keeps payment protection, the NDA and our support in place for you and the client. Contact details are shared only after assignment.' },
      { icon: '⭐', title: 'Trust and quality', text: 'An accurate profile, an AI interview you take yourself and badges that really mean something help clients choose you with confidence.' },
      { icon: '📋', title: 'Clear rules in one place', text: `What happens after ${formatPolicyDuration(n.r1, 'en')}, ${formatPolicyDuration(n.r2, 'en')} and ${formatPolicyDuration(n.r3, 'en')}, and when there is no response, is written down here - so nobody is surprised.` },
    ],
    meansTitle: 'What this means for you',
    meansNote: 'These are the current platform settings. If they change materially, we publish a new version of the policy.',
    num: {
      reply: 'to accept or decline a request',
      critical: 'for Critical requests',
      reminders: 'reminders if you have not answered',
      minSample: 'counted requests before anything is shown to clients',
      notices: 'friendly notices before any indicator',
      dispute: 'to dispute a no-response',
      window: 'rolling window - your figures recover',
      grace: 'to confirm this version',
    },
    fullTitle: 'The full policy',
    toc: 'Contents',
    summary: 'In short',
    section: 'Section',
    timelineTitle: 'What happens after a request arrives',
    steps: ['Request arrives', 'Reminder', 'Reminder', 'Last reminder', 'No response'],
    at: (x: string) => `after ${x}`,
    now: 'now',
    criticalLine: (a: string, b: string, c: string, e: string) => `Critical requests: reminders after ${a}, ${b} and ${c}; no response after ${e}.`,
    needTitle: 'What we need from you',
    need: [
      'Read the policy (about 5 minutes).',
      'Confirm it in your portal - one click.',
      'Keep your availability up to date: working hours, time zone, capacity and holidays.',
      'Keep your profile accurate and your own.',
      'Take the AI interview yourself, without outside help.',
    ],
    bottomLead: 'Ready? Confirming takes about a minute.',
    printable: 'Public, printable version',
    privacy: 'Privacy policy',
    sender: 'Sent by AI Support 360 (www.aisupport360.com), the SAP support portal.',
    why: 'You receive this e-mail because you have a consultant account on AI Support 360 and a new version of the Consultant Service Policy needs your confirmation.',
    essential: 'This is an essential service notice about your account, so notification pauses do not apply to it. Our other e-mails offer "Too many e-mails? Pause for: 3 days | 1 week | 1 month".',
  },
  ar: {
    brand: 'AI Support 360',
    title: (v: number) => `سياسة خدمة المستشار لدينا - الإصدار ${v}`,
    effective: (d: string) => `سارية من ${d}`,
    confirmBy: (d: string) => `يُرجى التأكيد قبل ${d}`,
    confirmEnded: (d: string) => `انتهت فترة التأكيد في ${d} - يُرجى التأكيد الآن`,
    confirmWindow: (g: string) => `لديك ${g} للتأكيد من أول مرة تظهر لك فيها السياسة في بوابتك`,
    neverBlocked: 'تسجيل الدخول والقراءة والتأكيد متاحة دائمًا ولا تُمنع أبدًا، ولا يتأثر عملك الحالي.',
    afterDeadline: 'إذا مرّ هذا التاريخ قبل أن تؤكد، فلن تتمكن من قبول إسنادات جديدة أو تقديم عروض جديدة، ولن تظهر في البحث أو المطابقة أو التنبيهات الحرجة - وذلك فقط حتى تؤكد. تستمر تذاكرك الحالية كالمعتاد.',
    hello: (name?: string) => (name ? `مرحبًا ${name}،` : 'مرحبًا،'),
    introNotice: (v: number) => `نشرنا الإصدار ${v} من سياسة خدمة المستشار. تجمع السياسة في مكان واحد ما يمكن أن يتوقعه العملاء من المستشارين في AI Support 360، وما يمكنك أن تتوقعه منا، ولماذا وُضعت هذه القواعد. يُرجى تخصيص بضع دقائق لقراءتها وتأكيدها في بوابتك.`,
    introReminder: (v: number) => `تذكير ودي: لا يزال الإصدار ${v} من سياسة خدمة المستشار بانتظار تأكيدك. تجد النص الكامل أدناه مع أسبابه - ولا يستغرق التأكيد سوى دقيقة تقريبًا.`,
    button: 'اقرأ وأكّد',
    whyTitle: 'لماذا وضعنا هذه السياسة',
    whyLead: 'القواعد لا تنفع إلا إذا فهم الجميع سببها. وهذه أسباب وجود هذه السياسة:',
    cards: (n: PolicyEmailNumbers): PolicyWhyCard[] => [
      { icon: '⚡', title: 'ردود أسرع = عمل أكثر', text: 'من يواجه مشكلة في SAP يحتاج إلى المساعدة بسرعة غالبًا. وعندما تُجاب الطلبات بسرعة، يواصل العملاء اختيار المنصة والثقة بمستشاريها، وهذا يعني طلبات أكثر لك.' },
      { icon: '⚖️', title: 'عادلة معك', text: `لا تُحتسب في الإحصاءات إلا الطلبات التي تصل وأنت متاح. تأتي الإشعارات الودية دائمًا أولًا، ويمكنك الاعتراض على حالة عدم رد خلال ${days(n.disputeDays, 'ar')}، وتتعافى أرقامك مع الوقت.` },
      { icon: '🛡️', title: 'حماية للجميع', text: 'العمل عبر المنصة يُبقي حماية الدفع واتفاقية السرية (NDA) ودعمنا قائمة لك وللعميل. ولا تُشارك بيانات التواصل إلا بعد الإسناد.' },
      { icon: '⭐', title: 'ثقة وجودة', text: 'ملف شخصي دقيق، ومقابلة ذكاء اصطناعي تجريها بنفسك، وشارات ذات معنى حقيقي - كلها تساعد العملاء على اختيارك بثقة.' },
      { icon: '📋', title: 'قواعد واضحة في مكان واحد', text: `ما يحدث بعد ${formatPolicyDuration(n.r1, 'ar')} و${formatPolicyDuration(n.r2, 'ar')} و${formatPolicyDuration(n.r3, 'ar')}، وعند عدم الرد، مكتوب هنا - حتى لا يتفاجأ أحد.` },
    ],
    meansTitle: 'ماذا يعني ذلك لك',
    meansNote: 'هذه إعدادات المنصة الحالية. وإذا تغيرت تغيرًا جوهريًا، ننشر إصدارًا جديدًا من السياسة.',
    num: {
      reply: 'لقبول الطلب أو رفضه',
      critical: 'للطلبات الحرجة',
      reminders: 'تذكيرات إذا لم ترد',
      minSample: 'طلبات محتسبة قبل أن يظهر أي شيء للعملاء',
      notices: 'إشعارات ودية قبل ظهور أي مؤشر',
      dispute: 'للاعتراض على حالة عدم رد',
      window: 'نافذة متجددة - تتعافى أرقامك',
      grace: 'لتأكيد هذا الإصدار',
    },
    fullTitle: 'السياسة كاملة',
    toc: 'المحتويات',
    summary: 'باختصار',
    section: 'القسم',
    timelineTitle: 'ماذا يحدث بعد وصول الطلب',
    steps: ['وصول الطلب', 'تذكير', 'تذكير', 'تذكير أخير', 'بلا رد'],
    at: (x: string) => `بعد ${x}`,
    now: 'الآن',
    criticalLine: (a: string, b: string, c: string, e: string) => `الطلبات الحرجة: تذكيرات بعد ${a} و${b} و${c}، وتُعد بلا رد بعد ${e}.`,
    needTitle: 'ما نحتاجه منك',
    need: [
      'اقرأ السياسة (نحو 5 دقائق).',
      'أكّدها في بوابتك - بنقرة واحدة.',
      'حدّث أوقات إتاحتك: ساعات العمل والمنطقة الزمنية والطاقة والإجازات.',
      'حافظ على دقة ملفك وأن يعبّر عنك أنت.',
      'أجرِ مقابلة الذكاء الاصطناعي بنفسك دون مساعدة خارجية.',
    ],
    bottomLead: 'هل أنت مستعد؟ لا يستغرق التأكيد سوى دقيقة تقريبًا.',
    printable: 'النسخة العامة القابلة للطباعة',
    privacy: 'سياسة الخصوصية',
    sender: 'أُرسلت من AI Support 360 (www.aisupport360.com)، بوابة دعم SAP.',
    why: 'تصلك هذه الرسالة لأن لديك حساب مستشار في AI Support 360، ويحتاج إصدار جديد من سياسة خدمة المستشار إلى تأكيدك.',
    essential: 'هذه رسالة خدمة أساسية تخص حسابك، لذا لا ينطبق عليها الإيقاف المؤقت للإشعارات. وتتضمن رسائلنا الأخرى خيار "رسائل كثيرة؟ أوقفها مؤقتاً لمدة: 3 أيام | أسبوع | شهر".',
  },
};

// ---------------------------------------------------------------- resolved model (shared by HTML and plain text)

function safeUrl(u: string | undefined, fallback: string): string {
  return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : fallback;
}

export function policyEmailModel(p: PolicyEmailProps) {
  const lang: PolicyEmailLang = p.lang === 'ar' ? 'ar' : 'en';
  const t = POLICY_EMAIL_STR[lang];
  const n: PolicyEmailNumbers = { ...POLICY_EMAIL_NUMBER_DEFAULTS, ...(p.numbers ?? {}) };
  const v = Math.max(1, Math.floor(Number(p.version) || 1));
  const d = (m: number) => formatPolicyDuration(m, lang);
  const deadlineLine = p.deadline
    ? (p.deadlinePassed ? t.confirmEnded(p.deadline) : t.confirmBy(p.deadline))
    : t.confirmWindow(days(n.graceDays, lang));
  return {
    lang, t, n, v, dir: lang === 'ar' ? 'rtl' : 'ltr',
    title: t.title(v),
    policyTitle: p.title,
    effective: p.effectiveDate ? t.effective(p.effectiveDate) : null,
    deadlineLine,
    hello: t.hello(p.name),
    intro: p.kind === 'notice' ? t.introNotice(v) : t.introReminder(v),
    summary: p.summary?.trim() || null,
    body: parsePolicyEmailBody(p.body),
    cards: t.cards(n),
    numbers: [
      { value: d(n.expire), label: t.num.reply },
      { value: d(n.criticalExpire), label: t.num.critical },
      { value: `${d(n.r1)} · ${d(n.r2)} · ${d(n.r3)}`, label: t.num.reminders },
      { value: String(n.minSample), label: t.num.minSample },
      { value: String(n.notices), label: t.num.notices },
      { value: days(n.disputeDays, lang), label: t.num.dispute },
      { value: days(n.windowDays, lang), label: t.num.window },
      { value: days(n.graceDays, lang), label: t.num.grace },
    ],
    timeline: [
      { label: t.steps[0], at: t.now },
      { label: t.steps[1], at: t.at(d(n.r1)) },
      { label: t.steps[2], at: t.at(d(n.r2)) },
      { label: t.steps[3], at: t.at(d(n.r3)) },
      { label: t.steps[4], at: t.at(d(n.expire)) },
    ],
    criticalLine: t.criticalLine(d(n.criticalR1), d(n.criticalR2), d(n.criticalR3), d(n.criticalExpire)),
    confirmUrl: safeUrl(p.confirmUrl, `${POLICY_EMAIL_SITE}${POLICY_EMAIL_CONFIRM_PATH}`),
    policyUrl: safeUrl(p.policyUrl, `${POLICY_EMAIL_SITE}/consultant-policy`),
    privacyUrl: safeUrl(p.privacyUrl, `${POLICY_EMAIL_SITE}/privacy-policy`),
  };
}

// ---------------------------------------------------------------- HTML (via createElement)

// deno-lint-ignore no-explicit-any
export type CreateElement = (type: any, props?: any, ...children: any[]) => any;

const C = {
  navy: '#1B2559', header: '#052B5A', accent: '#3B82F6', ink: '#0f172a', text: '#334155', muted: '#64748b',
  line: '#e2e8f0', soft: '#f8fafc', blueSoft: '#eff6ff', blueLine: '#bfdbfe', amberSoft: '#fffbeb', amberLine: '#f59e0b', white: '#ffffff',
};
const SECTION_COLORS = ['#3B82F6', '#1B2559', '#0EA5E9', '#10B981', '#F59E0B', '#64748B'];
const TIMELINE_COLORS = ['#3B82F6', '#60A5FA', '#F59E0B', '#F97316', '#DC2626'];

/** Splits **bold** segments into strong elements (text stays escaped). */
function rich(h: CreateElement, text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((s, i) => (s.startsWith('**') && s.endsWith('**') && s.length > 4
    ? h('strong', { key: i, style: { color: C.ink } }, s.slice(2, -2))
    : s));
}

export function buildPolicyEmail(h: CreateElement, props: PolicyEmailProps) {
  const m = policyEmailModel(props);
  const rtl = m.lang === 'ar';
  const start = rtl ? 'right' : 'left';
  const font = rtl ? 'Tahoma, Arial, Helvetica, sans-serif' : 'Arial, Helvetica, sans-serif';
  const table = (style: Record<string, unknown> = {}, ...rows: unknown[]) =>
    h('table', { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0, border: 0, dir: m.dir, style: { borderCollapse: 'separate', ...style } }, h('tbody', null, ...rows));
  const row = (...cells: unknown[]) => h('tr', null, ...cells);
  const cell = (style: Record<string, unknown>, ...children: unknown[]) => h('td', { style: { textAlign: start, fontFamily: font, ...style }, align: start }, ...children);
  const p = (style: Record<string, unknown>, ...children: unknown[]) => h('p', { style: { margin: '0', fontFamily: font, textAlign: start, ...style } }, ...children);
  const space = (px: number) => row(h('td', { style: { height: `${px}px`, lineHeight: `${px}px`, fontSize: '1px' } }, '\u00a0'));

  const button = (testId: string) => table({}, row(h('td', { align: 'center', style: { padding: '0' } },
    h('table', { role: 'presentation', cellPadding: 0, cellSpacing: 0, border: 0, style: { margin: '0 auto' } }, h('tbody', null, row(
      h('td', { bgColor: C.navy, style: { backgroundColor: C.navy, borderRadius: '12px', textAlign: 'center' } },
        h('a', { href: m.confirmUrl, 'data-cta': testId, target: '_blank', style: { display: 'inline-block', padding: '14px 30px', fontFamily: font, fontSize: '16px', fontWeight: 'bold', color: C.white, textDecoration: 'none', borderRadius: '12px' } }, m.t.button),
      ),
    ))),
  )));

  const sectionTitle = (text: string) => p({ fontSize: '20px', fontWeight: 'bold', color: C.ink, margin: '0 0 6px' }, text);

  // Header
  const header = row(cell({ backgroundColor: C.header, padding: '24px 28px 26px', borderRadius: '18px 18px 0 0' },
    h('img', { src: POLICY_EMAIL_LOGO, width: 200, height: 45, alt: m.t.brand, style: { display: 'block', border: '0', outline: 'none', width: '200px', height: '45px', maxWidth: '100%' } }),
    h('div', { style: { height: '20px', lineHeight: '20px', fontSize: '1px' } }, '\u00a0'),
    h('h1', { style: { margin: '0 0 10px', fontFamily: font, fontSize: '24px', lineHeight: '1.3', fontWeight: 'bold', color: C.white, textAlign: start } }, m.title),
    m.effective ? p({ fontSize: '14px', color: '#cbd5e1', margin: '0 0 12px' }, m.effective) : null,
    table({ backgroundColor: '#0b3b78', borderRadius: '12px' }, row(cell({ padding: '12px 14px', backgroundColor: '#0b3b78', borderRadius: '12px' },
      p({ fontSize: '15px', fontWeight: 'bold', color: C.white, margin: '0 0 4px' }, '🗓️ ', m.deadlineLine),
      p({ fontSize: '13px', lineHeight: '1.55', color: '#dbeafe' }, m.t.neverBlocked),
    ))),
  ));

  // Intro + top button
  const intro = row(cell({ padding: '26px 28px 8px' },
    p({ fontSize: '16px', color: C.ink, margin: '0 0 10px', fontWeight: 'bold' }, m.hello),
    p({ fontSize: '15px', lineHeight: '1.65', color: C.text, margin: '0 0 20px' }, m.intro),
    button('top'),
    p({ fontSize: '13px', lineHeight: '1.55', color: C.muted, margin: '16px 0 0' }, m.t.afterDeadline),
  ));

  // Why cards
  const why = row(cell({ padding: '22px 28px 6px' },
    sectionTitle(m.t.whyTitle),
    p({ fontSize: '14px', lineHeight: '1.6', color: C.text, margin: '0 0 14px' }, m.t.whyLead),
    ...m.cards.map((c, i) => table({ margin: '0 0 10px', backgroundColor: C.blueSoft, border: `1px solid ${C.blueLine}`, borderRadius: '14px' },
      row(
        h('td', { width: 52, vAlign: 'top', align: 'center', style: { width: '52px', padding: '14px 0 14px', fontSize: '24px', lineHeight: '28px', textAlign: 'center', verticalAlign: 'top' } }, c.icon),
        cell({ padding: rtl ? '14px 0 14px 16px' : '14px 16px 14px 0', verticalAlign: 'top' },
          p({ fontSize: '15px', fontWeight: 'bold', color: C.navy, margin: '0 0 4px' }, `${String.fromCharCode(97 + i)}) ${c.title}`),
          p({ fontSize: '14px', lineHeight: '1.6', color: C.text }, c.text),
        ),
      ),
    )),
  ));

  // Key numbers
  const pairs: Array<typeof m.numbers> = [];
  for (let i = 0; i < m.numbers.length; i += 2) pairs.push(m.numbers.slice(i, i + 2));
  const numCell = (x: { value: string; label: string } | undefined) => h('td', { width: '50%', vAlign: 'top', style: { width: '50%', padding: '8px', verticalAlign: 'top', fontFamily: font, textAlign: start } },
    x ? table({ backgroundColor: '#24316e', borderRadius: '12px' }, row(cell({ padding: '12px 14px', backgroundColor: '#24316e', borderRadius: '12px' },
      p({ fontSize: '19px', fontWeight: 'bold', color: C.white, margin: '0 0 2px' }, x.value),
      p({ fontSize: '12px', lineHeight: '1.45', color: '#c7d2fe' }, x.label),
    ))) : null);
  const means = row(cell({ padding: '14px 28px 6px' },
    table({ backgroundColor: C.navy, borderRadius: '16px' },
      row(cell({ padding: '16px 18px 4px', backgroundColor: C.navy, borderRadius: '16px 16px 0 0' }, p({ fontSize: '17px', fontWeight: 'bold', color: C.white }, '✨ ', m.t.meansTitle))),
      row(h('td', { style: { padding: '4px 10px', backgroundColor: C.navy } }, table({}, ...pairs.map(pr => row(numCell(pr[0]), numCell(pr[1])))))),
      row(cell({ padding: '4px 18px 16px', backgroundColor: C.navy, borderRadius: '0 0 16px 16px' }, p({ fontSize: '12px', lineHeight: '1.5', color: '#c7d2fe' }, m.t.meansNote))),
    ),
  ));

  // Timeline (section 1)
  const timeline = table({ margin: '12px 0 6px', border: `1px solid ${C.line}`, borderRadius: '12px', backgroundColor: C.white },
    row(h('td', { colSpan: m.timeline.length, style: { padding: '12px 12px 4px', fontFamily: font, textAlign: start, fontSize: '13px', fontWeight: 'bold', color: C.navy } }, '⏱️ ', m.t.timelineTitle)),
    row(...m.timeline.map((s, i) => h('td', { key: i, width: `${Math.floor(100 / m.timeline.length)}%`, vAlign: 'top', align: 'center', 'data-step': i, style: { padding: '8px 4px 12px', verticalAlign: 'top', textAlign: 'center', fontFamily: font } },
      h('div', { style: { height: '4px', lineHeight: '4px', fontSize: '1px', backgroundColor: TIMELINE_COLORS[i] ?? C.accent, borderRadius: '2px', margin: '0 0 8px' } }, '\u00a0'),
      h('div', { style: { fontSize: '12px', fontWeight: 'bold', color: C.ink, lineHeight: '1.35' } }, s.label),
      h('div', { style: { fontSize: '12px', color: C.muted, lineHeight: '1.35' } }, s.at),
    ))),
    row(h('td', { colSpan: m.timeline.length, style: { padding: '0 12px 12px', fontFamily: font, textAlign: start, fontSize: '12px', lineHeight: '1.5', color: C.text } }, '🔴 ', m.criticalLine)),
  );

  const blocksOf = (blocks: PolicyEmailBlock[]) => {
    const out: unknown[] = [];
    let list: PolicyEmailBlock[] = [];
    const flush = () => {
      if (!list.length) return;
      out.push(h('ul', { style: { margin: '0 0 8px', padding: rtl ? '0 20px 0 0' : '0 0 0 20px', fontFamily: font, textAlign: start } },
        ...list.map(b => h('li', { style: { fontSize: '14px', lineHeight: '1.65', color: C.text, margin: '0 0 6px' } }, ...rich(h, b.text)))));
      list = [];
    };
    for (const b of blocks) {
      if (b.kind === 'li') { list.push(b); continue; }
      flush();
      if (b.kind === 'note') out.push(table({ margin: '4px 0 10px', backgroundColor: C.amberSoft, borderRadius: '10px', [rtl ? 'borderRight' : 'borderLeft']: `4px solid ${C.amberLine}` },
        row(cell({ padding: '10px 12px', fontSize: '13px', lineHeight: '1.55', color: '#78350f', fontWeight: 'bold' }, ...rich(h, b.text)))));
      else out.push(p({ fontSize: '14px', lineHeight: '1.65', color: C.text, margin: '0 0 8px' }, ...rich(h, b.text)));
    }
    flush();
    return out;
  };

  const sections = m.body.sections.map((s, i) => {
    const color = SECTION_COLORS[i % SECTION_COLORS.length];
    return h('div', { key: s.anchor, 'data-section': s.anchor },
      h('a', { id: s.anchor, name: s.anchor }),
      table({ margin: '0 0 12px', backgroundColor: C.soft, border: `1px solid ${C.line}`, [rtl ? 'borderRight' : 'borderLeft']: `5px solid ${color}`, borderRadius: '12px' },
        row(cell({ padding: '14px 16px 6px' },
          table({}, row(
            h('td', { width: 34, vAlign: 'top', style: { width: '34px', verticalAlign: 'top' } },
              h('div', { style: { width: '28px', height: '28px', lineHeight: '28px', borderRadius: '14px', backgroundColor: color, color: C.white, fontFamily: font, fontSize: '13px', fontWeight: 'bold', textAlign: 'center' }, 'aria-label': `${m.t.section} ${s.number}` }, s.number)),
            cell({ verticalAlign: 'middle', padding: rtl ? '0 8px 0 0' : '0 0 0 8px' },
              h('h3', { style: { margin: '0', fontFamily: font, fontSize: '16px', lineHeight: '1.4', fontWeight: 'bold', color: C.ink, textAlign: start } }, s.heading)),
          )),
          h('div', { style: { height: '10px', lineHeight: '10px', fontSize: '1px' } }, '\u00a0'),
          ...blocksOf(s.blocks),
          s.number === '1' ? timeline : null,
        )),
      ),
    );
  });

  const full = row(cell({ padding: '22px 28px 4px' },
    sectionTitle(m.t.fullTitle),
    m.policyTitle ? p({ fontSize: '14px', color: C.muted, margin: '0 0 12px' }, m.policyTitle, m.effective ? ` · ${m.effective}` : '') : null,
    ...m.body.notes.map(n => table({ margin: '0 0 12px', backgroundColor: C.amberSoft, borderRadius: '10px', [rtl ? 'borderRight' : 'borderLeft']: `4px solid ${C.amberLine}` },
      row(cell({ padding: '10px 12px', fontSize: '14px', fontWeight: 'bold', color: '#78350f' }, '⚠️ ', n)))),
    m.summary ? table({ margin: '0 0 12px', backgroundColor: C.blueSoft, border: `1px solid ${C.blueLine}`, borderRadius: '12px' },
      row(cell({ padding: '12px 14px' },
        p({ fontSize: '14px', fontWeight: 'bold', color: C.navy, margin: '0 0 4px' }, m.t.summary),
        p({ fontSize: '14px', lineHeight: '1.65', color: C.ink }, m.summary)))) : null,
    ...blocksOf(m.body.intro),
    m.body.sections.length ? table({ margin: '0 0 14px', border: `1px solid ${C.line}`, borderRadius: '12px' }, row(cell({ padding: '12px 14px' },
      p({ fontSize: '13px', fontWeight: 'bold', color: C.muted, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: rtl ? '0' : '0.5px' }, m.t.toc),
      ...m.body.sections.map(s => p({ fontSize: '14px', lineHeight: '1.8' },
        h('a', { href: `#${s.anchor}`, style: { color: C.accent, textDecoration: 'none' } }, `${s.number}. ${s.heading}`))),
    ))) : null,
    ...sections,
  ));

  // Checklist + bottom button
  const need = row(cell({ padding: '14px 28px 8px' },
    table({ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '14px' }, row(cell({ padding: '16px 18px' },
      p({ fontSize: '17px', fontWeight: 'bold', color: '#065f46', margin: '0 0 10px' }, m.t.needTitle),
      ...m.t.need.map(x => table({ margin: '0 0 6px' }, row(
        h('td', { width: 26, vAlign: 'top', style: { width: '26px', fontSize: '15px', lineHeight: '1.6', verticalAlign: 'top', color: '#059669' } }, '✅'),
        cell({ fontSize: '14px', lineHeight: '1.6', color: '#064e3b' }, x),
      ))),
    ))),
  ));
  const bottom = row(cell({ padding: '18px 28px 26px' },
    p({ fontSize: '14px', color: C.text, margin: '0 0 12px', textAlign: 'center' }, m.t.bottomLead),
    button('bottom'),
  ));

  const footer = row(cell({ padding: '18px 28px 24px', backgroundColor: C.soft, borderTop: `1px solid ${C.line}`, borderRadius: '0 0 18px 18px' },
    p({ fontSize: '12px', lineHeight: '1.6', color: C.muted, margin: '0 0 6px' }, m.t.sender),
    p({ fontSize: '12px', lineHeight: '1.6', color: C.muted, margin: '0 0 6px' }, m.t.why),
    p({ fontSize: '12px', lineHeight: '1.6', color: C.muted, margin: '0 0 10px' }, m.t.essential),
    p({ fontSize: '12px', lineHeight: '1.6' },
      h('a', { href: m.policyUrl, style: { color: C.navy, textDecoration: 'underline' } }, m.t.printable),
      h('span', { style: { color: '#94a3b8' } }, ' | '),
      h('a', { href: m.privacyUrl, style: { color: C.navy, textDecoration: 'underline' } }, m.t.privacy)),
  ));

  return h('html', { lang: m.lang, dir: m.dir },
    h('head', null,
      h('meta', { httpEquiv: 'Content-Type', content: 'text/html; charset=UTF-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('meta', { name: 'color-scheme', content: 'light dark' }),
      h('meta', { name: 'supported-color-schemes', content: 'light dark' }),
      h('title', null, m.title),
    ),
    h('body', { dir: m.dir, style: { margin: '0', padding: '0', backgroundColor: '#ffffff', fontFamily: font } },
      h('div', { style: { display: 'none', overflow: 'hidden', lineHeight: '1px', opacity: 0, maxHeight: 0, maxWidth: 0 } }, `${m.title} - ${m.deadlineLine}`),
      h('table', { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0, border: 0, bgColor: '#ffffff', dir: m.dir, style: { backgroundColor: '#ffffff' } }, h('tbody', null, row(
        h('td', { align: 'center', style: { padding: '16px 8px' } },
          h('table', { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0, border: 0, dir: m.dir, style: { maxWidth: '640px', width: '100%', margin: '0 auto', backgroundColor: C.white, border: `1px solid ${C.line}`, borderRadius: '18px', borderCollapse: 'separate' } },
            h('tbody', null, header, intro, why, means, full, need, bottom, footer)),
        ),
      ))),
    ),
  );
}

// ---------------------------------------------------------------- plain-text alternative

export function policyEmailText(props: PolicyEmailProps): string {
  const m = policyEmailModel(props);
  const L: string[] = [];
  const rule = '----------------------------------------';
  L.push(m.t.brand.toUpperCase(), '', m.title);
  if (m.effective) L.push(m.effective);
  L.push(m.deadlineLine, m.t.neverBlocked, '', m.hello, '', m.intro, '', `${m.t.button}: ${m.confirmUrl}`, '', m.t.afterDeadline, '', rule, m.t.whyTitle.toUpperCase(), rule, m.t.whyLead, '');
  m.cards.forEach((c, i) => L.push(`${String.fromCharCode(97 + i)}) ${c.title}`, `   ${c.text}`, ''));
  L.push(rule, m.t.meansTitle.toUpperCase(), rule);
  m.numbers.forEach(x => L.push(`- ${x.value}: ${x.label}`));
  L.push(m.t.meansNote, '', rule, m.t.fullTitle.toUpperCase(), rule);
  if (m.policyTitle) L.push(m.policyTitle);
  m.body.notes.forEach(n => L.push(`!! ${n}`));
  if (m.summary) L.push('', `${m.t.summary}: ${m.summary}`);
  const blocks = (bs: PolicyEmailBlock[]) => bs.forEach(b => L.push(b.kind === 'li' ? `  - ${b.text}` : b.kind === 'note' ? `  !! ${b.text}` : `  ${b.text}`));
  blocks(m.body.intro);
  if (m.body.sections.length) {
    L.push('', `${m.t.toc}:`);
    m.body.sections.forEach(s => L.push(`  ${s.number}. ${s.heading}`));
  }
  m.body.sections.forEach(s => {
    L.push('', `${s.number}. ${s.heading}`);
    blocks(s.blocks);
    if (s.number === '1') {
      L.push('', `  ${m.t.timelineTitle}: ${m.timeline.map(x => `${x.label} (${x.at})`).join(' -> ')}`, `  ${m.criticalLine}`);
    }
  });
  L.push('', rule, m.t.needTitle.toUpperCase(), rule);
  m.t.need.forEach(x => L.push(`[ ] ${x}`));
  L.push('', `${m.t.button}: ${m.confirmUrl}`, '', rule, m.t.sender, m.t.why, m.t.essential, `${m.t.printable}: ${m.policyUrl}`, `${m.t.privacy}: ${m.privacyUrl}`);
  return L.join('\n');
}
