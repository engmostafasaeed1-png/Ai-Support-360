/**
 * Refer & earn e-mails (Feature Z): ONE shared layout + small content blocks per event, bilingual (EN / AR + RTL).
 * Pure TypeScript without imports, so the edge functions (referral-run, referral-email-test), the admin preview in the
 * browser and the vitest suite render the very same HTML.
 *
 * Mail-client rules followed here: table layout, 600 px, inline CSS only (no <style>, no external fonts, system font
 * stack), white body background, colours that survive dark-mode inversion, alt text on every image, a bulletproof button
 * (table cell + Outlook VML), images only from our own domain. Fluid-hybrid columns (inline-block + Outlook tables) put
 * cards side by side on wide screens and stack them on phones; progress and status bars are table cells (Outlook-safe). Every value that comes from data is escaped with `esc`
 * and every link goes through `safeUrl` (our own domain only, no tokens or personal data in query strings).
 * Numbers come from the live programme settings passed in; the example is always labelled as an example.
 * The managed e-mail platform appends the unsubscribe footer itself, so this layout never adds its own unsubscribe link.
 */

export type ReferralEmailLang = 'en' | 'ar';
export type ReferralEmailKind =
  | 'signup' | 'invited' | 'passed_self' | 'passed_other' | 'active' | 'reminder' | 'expired' | 'ack_request' | 'verified'
  | 'first_reward' | 'reward_earned' | 'reward_available' | 'reward_held' | 'reward_paid' | 'reward_reversed'
  | 'referral_rejected' | 'payout_details_changed' | 'monthly_statement' | 'weekly_digest_admin';

export const REFERRAL_EMAIL_KINDS: readonly ReferralEmailKind[] = [
  'signup', 'invited', 'passed_self', 'passed_other', 'active', 'verified', 'reminder', 'ack_request', 'expired',
  'first_reward', 'reward_earned', 'reward_held', 'reward_available', 'reward_paid', 'reward_reversed', 'referral_rejected',
  'payout_details_changed', 'monthly_statement', 'weekly_digest_admin',
] as const;

export type ReferralTone = 'invite' | 'earned' | 'pending' | 'negative';
export type ReferralTab = 'programme' | 'referrals' | 'earnings' | 'calculations';
export type ReferralNextStep = 'pass_interview' | 'acknowledge' | 'wait_other' | 'none';

export interface ReferralEmailSettings {
  minRate: number; maxRate: number; months: number; holdDays: number; passMark: number; activationDays: number;
  payoutChangeDays: number; exampleFee: number; currency: string; termsDraft: boolean;
}

export const DEFAULT_REFERRAL_EMAIL_SETTINGS: ReferralEmailSettings = {
  minRate: 0.5, maxRate: 1, months: 12, holdDays: 14, passMark: 50, activationDays: 90, payoutChangeDays: 7,
  exampleFee: 1000, currency: 'USD', termsDraft: true,
};

export interface ReferralEmailInput {
  kind: ReferralEmailKind | string;
  lang?: string | null;
  name?: string | null;          // recipient's display name
  other?: string | null;         // the other consultant, ALWAYS the masked public name
  amount?: number | string | null;
  currency?: string | null;
  nextStep?: string | null;
  settings?: Partial<ReferralEmailSettings> | null;
  siteUrl?: string | null;
  bannerUrl?: string | null;     // hosted PNG on our domain, omitted when not published yet
  logoUrl?: string | null;
  pauseLinks?: { d3: string; w1: string; m1: string } | null;
  test?: boolean;
  /** Progress to the next reward level (database referral_tier_for): verified referrals counted, current and next level. */
  tier?: ReferralEmailTier | null;
  /** Monthly statement / weekly digest: period label, lines (masked names, anonymous ticket references) and totals. */
  period?: string | null;
  lines?: ReferralEmailLine[] | null;
  totals?: ReferralEmailTotal[] | null;
  /** Weekly digest (administrators): programme counts of the week. */
  stats?: { signups?: number; verified?: number; review?: number } | null;
}

export interface ReferralEmailTier { count: number; name?: string | null; rate?: number | null; min?: number | null; next_name?: string | null; next_min?: number | null; next_rate?: number | null; needed?: number | null }
export interface ReferralEmailLine { who?: string | null; ref?: string | null; fee?: number | null; reward?: number | null; status?: string | null; kind?: string | null; currency?: string | null }
export interface ReferralEmailTotal { currency: string; earned?: number; held?: number; available?: number; paid?: number; reversed?: number }

export interface RenderedReferralEmail {
  kind: ReferralEmailKind; lang: ReferralEmailLang; tone: ReferralTone; tab: ReferralTab;
  subject: string; preheader: string; html: string; text: string; ctaUrl: string;
}

const SITE = 'https://www.aisupport360.com';
const SENDER_DOMAIN = 'notify.aisupport360.com';
const OWN_HOSTS = new Set(['www.aisupport360.com', 'aisupport360.com']);

/** HTML-escapes any value (text and attribute safe). */
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"'`=]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' }[c]!));
}

/** Only https links on our own domain survive; anything else falls back to the site address. */
export function safeUrl(u: unknown, fallback = SITE): string {
  try {
    const url = new URL(String(u ?? ''));
    if (url.protocol !== 'https:' || !OWN_HOSTS.has(url.hostname) || url.username || url.password) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

const KIND_SET = new Set<string>(REFERRAL_EMAIL_KINDS);
export function normaliseKind(k: unknown): ReferralEmailKind {
  return (KIND_SET.has(String(k)) ? String(k) : 'signup') as ReferralEmailKind;
}

export function toneFor(kind: ReferralEmailKind): ReferralTone {
  if (['first_reward', 'reward_earned', 'reward_available', 'reward_paid'].includes(kind)) return 'earned';
  if (['reward_held', 'reminder', 'ack_request'].includes(kind)) return 'pending';
  if (['reward_reversed', 'referral_rejected', 'expired', 'payout_details_changed'].includes(kind)) return 'negative';
  return 'invite';
}

export function tabFor(kind: ReferralEmailKind): ReferralTab {
  if (kind === 'monthly_statement') return 'calculations';
  if (kind.startsWith('reward_') || kind === 'first_reward' || kind === 'payout_details_changed') return 'earnings';
  if (kind === 'signup' || kind === 'invited') return 'programme';
  return 'referrals';
}

/** Essential notices (money and bank-detail safety) are never paused; reminders and the rest follow the user's pause. */
export function pauseCategoryFor(kind: ReferralEmailKind): 'essential' | 'reminders' | 'activity' {
  if (['first_reward', 'reward_paid', 'reward_reversed', 'payout_details_changed'].includes(kind)) return 'essential';
  if (kind === 'reminder' || kind === 'ack_request') return 'reminders';
  return 'activity';
}


const fmtNum = (n: number, lang: ReferralEmailLang, digits = 2) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const fmtRate = (n: number, lang: ReferralEmailLang) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const fmtInt = (n: number, lang: ReferralEmailLang) => new Intl.NumberFormat('en-US').format(n);

function money(amount: unknown, currency: string, lang: ReferralEmailLang): string | null {
  const n = typeof amount === 'number' ? amount : Number(String(amount ?? '').replace(/[^0-9.-]/g, ''));
  if (amount == null || amount === '' || !Number.isFinite(n)) return null;
  const cur = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  return `${fmtNum(Math.abs(n), lang)} ${cur}`;
}

function cleanSettings(s?: Partial<ReferralEmailSettings> | null): ReferralEmailSettings {
  const d = DEFAULT_REFERRAL_EMAIL_SETTINGS;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  };
  const minRate = num(s?.minRate, d.minRate, 0.01, 10);
  return {
    minRate,
    maxRate: Math.max(minRate, num(s?.maxRate, Math.max(minRate, d.maxRate), 0.01, 10)),
    months: Math.round(num(s?.months, d.months, 1, 60)),
    holdDays: Math.round(num(s?.holdDays, d.holdDays, 0, 90)),
    passMark: Math.round(num(s?.passMark, d.passMark, 0, 100)),
    activationDays: Math.round(num(s?.activationDays, d.activationDays, 1, 365)),
    payoutChangeDays: Math.round(num(s?.payoutChangeDays, d.payoutChangeDays, 0, 60)),
    exampleFee: num(s?.exampleFee, d.exampleFee, 1, 1_000_000),
    currency: /^[A-Z]{3}$/.test(String(s?.currency ?? '')) ? String(s!.currency) : d.currency,
    termsDraft: s?.termsDraft == null ? d.termsDraft : !!s.termsDraft,
  };
}

/** "0.5 %–1 %" (or one value when the tiers have a single rate). */
export function rateRange(s: ReferralEmailSettings, lang: ReferralEmailLang): string {
  const a = fmtRate(s.minRate, lang), b = fmtRate(s.maxRate, lang);
  return s.minRate === s.maxRate ? `${a} %` : `${a} %–${b} %`;
}

/** Illustration only: example fee x base rate. */
export function exampleCalc(s: ReferralEmailSettings): { fee: number; rate: number; reward: number } {
  return { fee: s.exampleFee, rate: s.minRate, reward: Math.round(s.exampleFee * s.minRate) / 100 };
}

interface Block {
  subject: string; headline: string; intro: string; amountLabel?: string; next?: boolean; steps?: boolean; example?: boolean; benefits?: boolean; cta: string;
}

type Ctx = { o: string; s: ReferralEmailSettings; lang: ReferralEmailLang };

const COPY: Record<ReferralEmailLang, {
  eyebrow: string; hello: (n?: string) => string; test: string; how: string; stepsTitle: string; steps: (c: Ctx) => string[];
  benefitsTitle: string; benefits: (c: Ctx) => Array<[string, string]>; exampleTitle: string; example: (c: Ctx) => string;
  exampleNote: (c: Ctx) => string; fine: (c: Ctx) => string; draft: string; terms: string; next: Record<ReferralNextStep, (c: Ctx) => string>;
  nextTitle: string; why: string; prefs: string; pauseLead: string; d3: string; w1: string; m1: string; company: string; sentBy: string;
  logoAlt: string; bannerAlt: string; amountNote: Record<string, string>; k: Record<ReferralEmailKind, (c: Ctx) => Block>;
}> = {
  en: {
    eyebrow: 'Refer & earn',
    hello: (n) => `Hello ${n || 'there'},`,
    test: 'TEST - sample data, sent only to you',
    how: 'How it works',
    stepsTitle: 'How Refer & earn works',
    steps: ({ s, lang }) => [
      'Share your personal referral code with an SAP consultant you know.',
      'They register on AI Support 360 with your code.',
      `You both pass the AI interview (score at least ${fmtInt(s.passMark, lang)}) and accept the referral terms.`,
      'They complete approved, paid work for clients.',
      `You receive ${rateRange(s, lang)} of their approved consultant fee for ${fmtInt(s.months, lang)} months from their first paid ticket, after a ${fmtInt(s.holdDays, lang)}-day hold.`,
    ],
    benefitsTitle: 'Why it is worth it',
    benefits: ({ s, lang }) => [
      [`${rateRange(s, lang)} for ${fmtInt(s.months, lang)} months`, 'Of every referred consultant’s approved fee, paid by AI Support 360 - never deducted from them.'],
      ['Five simple steps', 'Share your code, both pass the AI interview, accept the terms - then paid work counts.'],
      ['Tracked in your dashboard', 'Every referral, reward line and payout is visible on your Refer & earn page.'],
    ],
    exampleTitle: 'Example calculation',
    example: ({ s, lang }) => { const e = exampleCalc(s); return `${fmtNum(e.fee, lang, 0)} ${s.currency} approved fee × ${fmtRate(e.rate, lang)} % = ${fmtNum(e.reward, lang)} ${s.currency}`; },
    exampleNote: ({ s, lang }) => `Example only, not a promise of income. Your rate is ${rateRange(s, lang)} depending on your tier.`,
    fine: () => 'Rewards depend on approved, paid work and are paid by AI Support 360 out of its own fee - never deducted from the consultant you referred and never added to the client’s price. There is no guaranteed income.',
    draft: 'The programme terms are a draft and may still change.',
    terms: 'Programme terms',
    nextTitle: 'Next step',
    next: {
      pass_interview: ({ s, lang }) => `Pass the AI interview (score at least ${fmtInt(s.passMark, lang)}).`,
      acknowledge: () => 'Accept the referral terms on the Refer & earn page.',
      wait_other: ({ o }) => `Waiting for ${o} to pass the AI interview and accept the terms.`,
      none: () => '',
    },
    why: 'You receive this e-mail because you take part in Refer & earn on AI Support 360.',
    prefs: 'Notification settings',
    pauseLead: 'Too many e-mails? Pause for:', d3: '3 days', w1: '1 week', m1: '1 month',
    company: 'AI Support 360 · SAP support portal by Qurtuba Talks',
    sentBy: `Sent from ${SENDER_DOMAIN}`,
    logoAlt: 'AI Support 360',
    bannerAlt: 'Gift box with sparkles - Refer & earn',
    amountNote: { first_reward: 'Your reward', reward_earned: 'Reward recorded', reward_available: 'Now available', reward_held: 'On hold', reward_paid: 'Paid to you', reward_reversed: 'Reversed' },
    k: {
      signup: ({ o }) => ({ subject: 'Someone registered with your referral code', headline: 'A colleague joined with your code', intro: `${o} registered with your referral code. Your referral becomes active when you both pass the AI interview and accept the referral terms.`, steps: true, example: true, cta: 'Open Refer & earn' }),
      invited: ({ o }) => ({ subject: 'You were invited to AI Support 360', headline: 'Welcome - you were invited', intro: `You were invited by ${o}. The referral becomes active after you and your referrer pass the AI interview and accept the terms. It never reduces your own earnings.`, benefits: true, steps: true, cta: 'Open Refer & earn' }),
      passed_self: () => ({ subject: 'You passed the AI interview', headline: 'You passed the AI interview', intro: 'Well done - you passed the AI interview. Here is what is next for your referral.', next: true, cta: 'View my referrals' }),
      passed_other: ({ o }) => ({ subject: 'Your referral partner passed the AI interview', headline: 'Your partner passed the AI interview', intro: `${o} passed the AI interview. Here is what is next for your referral.`, next: true, cta: 'View my referrals' }),
      active: ({ o }) => ({ subject: 'Your referral is active', headline: 'Your referral is active', intro: `Your referral with ${o} is now active. Approved, paid work invoiced from today counts towards your rewards.`, example: true, cta: 'View my referrals' }),
      verified: ({ o }) => ({ subject: 'Your referral is verified', headline: 'Your referral is verified', intro: `${o} is now a verified consultant. Your reward starts with their first paid ticket once your referral is active.`, cta: 'View my referrals' }),
      reminder: ({ o }) => ({ subject: 'Your referral is still pending', headline: 'Your referral is still pending', intro: `Your referral with ${o} is not active yet.`, next: true, cta: 'View my referrals' }),
      ack_request: ({ o }) => ({ subject: 'Please accept the referral terms', headline: 'One step left: accept the terms', intro: `Please accept the referral terms so your referral with ${o} can become active.`, cta: 'Accept the terms' }),
      expired: ({ o, s, lang }) => ({ subject: 'Your referral has expired', headline: 'Your referral has expired', intro: `Your referral with ${o} has expired: both of you had to pass the AI interview and accept the terms within ${fmtInt(s.activationDays, lang)} days. An administrator can revive it.`, cta: 'View my referrals' }),
      first_reward: ({ o, s, lang }) => ({ subject: 'You earned your first referral reward', headline: 'Your first referral reward', intro: `You earned a reward from the approved, paid work of ${o}. It becomes available after the ${fmtInt(s.holdDays, lang)}-day hold that follows their payout.`, amountLabel: 'first_reward', cta: 'View earning' }),
      reward_earned: ({ o, s, lang }) => ({ subject: 'New referral reward recorded', headline: 'New referral reward', intro: `A new reward was recorded from the approved, paid work of ${o}. It becomes available after the ${fmtInt(s.holdDays, lang)}-day hold.`, amountLabel: 'reward_earned', cta: 'View earning' }),
      reward_held: ({ o }) => ({ subject: 'A referral reward is on hold', headline: 'Reward on hold for review', intro: `A reward from the work of ${o} is on hold while we check it. Nothing is lost - you will be told when the review is finished.`, amountLabel: 'reward_held', cta: 'View earning' }),
      reward_available: () => ({ subject: 'Your referral reward is available', headline: 'Reward now available', intro: 'The hold period is over. This reward is now available and will be paid with the next normal payout run to your own verified bank details.', amountLabel: 'reward_available', cta: 'View earning' }),
      reward_paid: () => ({ subject: 'Your referral reward was paid', headline: 'Referral reward paid', intro: 'Your referral reward was paid to your verified bank details as "Referral reward". Your statement shows every line.', amountLabel: 'reward_paid', cta: 'View earning' }),
      reward_reversed: ({ o }) => ({ subject: 'A referral reward was reversed', headline: 'Reward reversed', intro: `A reward from the work of ${o} was reversed because the client payment was refunded or disputed. It is taken off at the original rate.`, amountLabel: 'reward_reversed', cta: 'View earning' }),
      referral_rejected: ({ o }) => ({ subject: 'A referral was not accepted', headline: 'Referral not accepted', intro: `Your referral with ${o} was not accepted after review and will not earn rewards. If you think this is wrong, contact support.`, cta: 'View my referrals' }),
      payout_details_changed: ({ s, lang }) => ({ subject: 'Your bank details were changed', headline: 'Your bank details were changed', intro: `Your payout bank details were just changed. If this was not you, contact support immediately. For your safety, referral payouts wait ${fmtInt(s.payoutChangeDays, lang)} days after a change.`, cta: 'Check my details' }),
      monthly_statement: () => ({ subject: 'Your monthly referral statement', headline: 'Your monthly referral statement', intro: 'Here is a summary of your Refer & earn reward lines for the month. The full statement with every calculation is on your Refer & earn page.', cta: 'Open my statement' }),
      weekly_digest_admin: () => ({ subject: 'Weekly Refer & earn summary', headline: 'Refer & earn this week', intro: 'The programme numbers of the last 7 days. Lines waiting for review need an administrator.', cta: 'Open admin referrals' }),
    },
  },
  ar: {
    eyebrow: 'أحِل واربح',
    hello: (n) => `مرحبًا ${n || ''}،`,
    test: 'اختبار - بيانات نموذجية، أُرسلت إليك فقط',
    how: 'كيف يعمل البرنامج',
    stepsTitle: 'كيف يعمل برنامج أحِل واربح',
    steps: ({ s, lang }) => [
      'شارك رمز الإحالة الخاص بك مع مستشار SAP تعرفه.',
      'يسجّل في AI Support 360 باستخدام رمزك.',
      `تجتازان كلاكما المقابلة الذكية (بدرجة ${fmtInt(s.passMark, lang)} على الأقل) وتوافقان على شروط الإحالة.`,
      'يُنجز أعمالًا معتمدة ومدفوعة للعملاء.',
      `تحصل على ${rateRange(s, lang)} من أتعابه المعتمدة لمدة ${fmtInt(s.months, lang)} شهرًا من أول تذكرة مدفوعة له، بعد فترة انتظار ${fmtInt(s.holdDays, lang)} يومًا.`,
    ],
    benefitsTitle: 'لماذا يستحق الأمر',
    benefits: ({ s, lang }) => [
      [`${rateRange(s, lang)} لمدة ${fmtInt(s.months, lang)} شهرًا`, 'من الأتعاب المعتمدة لكل مستشار تحيله، تدفعها AI Support 360 ولا تُخصم منه أبدًا.'],
      ['خمس خطوات بسيطة', 'شارك رمزك، اجتازا المقابلة الذكية، وافقا على الشروط - ثم تُحتسب الأعمال المدفوعة.'],
      ['متابعة في لوحتك', 'كل إحالة وسطر مكافأة ودفعة ظاهر في صفحة أحِل واربح.'],
    ],
    exampleTitle: 'مثال حسابي',
    example: ({ s, lang }) => { const e = exampleCalc(s); return `أتعاب معتمدة ${fmtNum(e.fee, lang, 0)} ${s.currency} × ${fmtRate(e.rate, lang)} ٪ = ${fmtNum(e.reward, lang)} ${s.currency}`; },
    exampleNote: ({ s, lang }) => `مثال توضيحي فقط وليس وعدًا بدخل. نسبتك ${rateRange(s, lang)} بحسب مستواك.`,
    fine: () => 'تعتمد المكافآت على أعمال معتمدة ومدفوعة، وتدفعها AI Support 360 من رسومها - لا تُخصم من المستشار الذي أحلته ولا تُضاف إلى سعر العميل. لا يوجد دخل مضمون.',
    draft: 'شروط البرنامج مسودة وقد تتغير.',
    terms: 'شروط البرنامج',
    nextTitle: 'الخطوة التالية',
    next: {
      pass_interview: ({ s, lang }) => `اجتز المقابلة الذكية (بدرجة ${fmtInt(s.passMark, lang)} على الأقل).`,
      acknowledge: () => 'وافق على شروط الإحالة في صفحة أحِل واربح.',
      wait_other: ({ o }) => `بانتظار أن يجتاز ${o} المقابلة الذكية ويوافق على الشروط.`,
      none: () => '',
    },
    why: 'تصلك هذه الرسالة لأنك مشارك في برنامج أحِل واربح على AI Support 360.',
    prefs: 'إعدادات الإشعارات',
    pauseLead: 'رسائل كثيرة؟ أوقفها مؤقتاً لمدة:', d3: '3 أيام', w1: 'أسبوع', m1: 'شهر',
    company: 'AI Support 360 · بوابة دعم SAP من Qurtuba Talks',
    sentBy: `أُرسلت من ${SENDER_DOMAIN}`,
    logoAlt: 'AI Support 360',
    bannerAlt: 'صندوق هدية مع لمعان - أحِل واربح',
    amountNote: { first_reward: 'مكافأتك', reward_earned: 'مكافأة مسجّلة', reward_available: 'متاحة الآن', reward_held: 'قيد المراجعة', reward_paid: 'دُفعت لك', reward_reversed: 'مستردّة' },
    k: {
      signup: ({ o }) => ({ subject: 'سجّل شخص باستخدام رمز الإحالة الخاص بك', headline: 'انضم زميل برمزك', intro: `سجّل ${o} باستخدام رمز الإحالة الخاص بك. تصبح الإحالة نشطة عندما تجتازان كلاكما المقابلة الذكية وتوافقان على الشروط.`, steps: true, example: true, cta: 'افتح أحِل واربح' }),
      invited: ({ o }) => ({ subject: 'تمت دعوتك إلى AI Support 360', headline: 'أهلًا بك - تمت دعوتك', intro: `دعاك ${o}. تصبح الإحالة نشطة بعد أن تجتاز أنت ومن دعاك المقابلة الذكية وتوافقا على الشروط. ولا تُنقص من أرباحك أبدًا.`, benefits: true, steps: true, cta: 'افتح أحِل واربح' }),
      passed_self: () => ({ subject: 'لقد اجتزت المقابلة الذكية', headline: 'لقد اجتزت المقابلة الذكية', intro: 'أحسنت - لقد اجتزت المقابلة الذكية. هذه الخطوة التالية لإحالتك.', next: true, cta: 'عرض إحالاتي' }),
      passed_other: ({ o }) => ({ subject: 'اجتاز شريك الإحالة المقابلة الذكية', headline: 'اجتاز شريكك المقابلة الذكية', intro: `اجتاز ${o} المقابلة الذكية. هذه الخطوة التالية لإحالتك.`, next: true, cta: 'عرض إحالاتي' }),
      active: ({ o }) => ({ subject: 'إحالتك نشطة الآن', headline: 'إحالتك نشطة الآن', intro: `أصبحت إحالتك مع ${o} نشطة. تُحتسب الأعمال المعتمدة والمدفوعة المفوترة من اليوم ضمن مكافآتك.`, example: true, cta: 'عرض إحالاتي' }),
      verified: ({ o }) => ({ subject: 'تم توثيق المستشار الذي أحلته', headline: 'تم توثيق إحالتك', intro: `أصبح ${o} مستشارًا موثّقًا. تبدأ مكافأتك مع أول تذكرة مدفوعة له بعد تفعيل الإحالة.`, cta: 'عرض إحالاتي' }),
      reminder: ({ o }) => ({ subject: 'إحالتك ما زالت قيد الانتظار', headline: 'إحالتك ما زالت قيد الانتظار', intro: `إحالتك مع ${o} لم تصبح نشطة بعد.`, next: true, cta: 'عرض إحالاتي' }),
      ack_request: ({ o }) => ({ subject: 'يرجى الموافقة على شروط الإحالة', headline: 'خطوة واحدة: الموافقة على الشروط', intro: `يرجى الموافقة على شروط الإحالة حتى تصبح إحالتك مع ${o} نشطة.`, cta: 'الموافقة على الشروط' }),
      expired: ({ o, s, lang }) => ({ subject: 'انتهت صلاحية إحالتك', headline: 'انتهت صلاحية إحالتك', intro: `انتهت صلاحية إحالتك مع ${o}: كان على كليكما اجتياز المقابلة الذكية والموافقة على الشروط خلال ${fmtInt(s.activationDays, lang)} يومًا. يمكن للمسؤول إعادة تفعيلها.`, cta: 'عرض إحالاتي' }),
      first_reward: ({ o, s, lang }) => ({ subject: 'حصلت على أول مكافأة إحالة', headline: 'أول مكافأة إحالة لك', intro: `حصلت على مكافأة من الأعمال المعتمدة والمدفوعة لـ ${o}. تصبح متاحة بعد فترة انتظار ${fmtInt(s.holdDays, lang)} يومًا تلي دفعته.`, amountLabel: 'first_reward', cta: 'عرض المكافأة' }),
      reward_earned: ({ o, s, lang }) => ({ subject: 'تم تسجيل مكافأة إحالة جديدة', headline: 'مكافأة إحالة جديدة', intro: `سُجّلت مكافأة جديدة من الأعمال المعتمدة والمدفوعة لـ ${o}. تصبح متاحة بعد فترة انتظار ${fmtInt(s.holdDays, lang)} يومًا.`, amountLabel: 'reward_earned', cta: 'عرض المكافأة' }),
      reward_held: ({ o }) => ({ subject: 'مكافأة إحالة قيد المراجعة', headline: 'مكافأة قيد المراجعة', intro: `مكافأة من عمل ${o} معلّقة أثناء التحقق منها. لن تضيع - سنخبرك عند انتهاء المراجعة.`, amountLabel: 'reward_held', cta: 'عرض المكافأة' }),
      reward_available: () => ({ subject: 'مكافأة الإحالة متاحة الآن', headline: 'المكافأة متاحة الآن', intro: 'انتهت فترة الانتظار. أصبحت هذه المكافأة متاحة وستُدفع مع دورة الدفع العادية التالية إلى حسابك البنكي الموثّق.', amountLabel: 'reward_available', cta: 'عرض المكافأة' }),
      reward_paid: () => ({ subject: 'تم دفع مكافأة الإحالة', headline: 'تم دفع مكافأة الإحالة', intro: 'دُفعت مكافأة الإحالة إلى حسابك البنكي الموثّق باسم "مكافأة إحالة". يعرض كشفك كل سطر.', amountLabel: 'reward_paid', cta: 'عرض المكافأة' }),
      reward_reversed: ({ o }) => ({ subject: 'تم استرداد مكافأة إحالة', headline: 'تم استرداد المكافأة', intro: `استُردّت مكافأة من عمل ${o} لأن دفعة العميل رُدّت أو عليها نزاع. تُخصم بالنسبة الأصلية.`, amountLabel: 'reward_reversed', cta: 'عرض المكافأة' }),
      referral_rejected: ({ o }) => ({ subject: 'لم تُقبل إحالة', headline: 'لم تُقبل الإحالة', intro: `لم تُقبل إحالتك مع ${o} بعد المراجعة ولن تحقق مكافآت. إن كنت ترى أن هذا خطأ، تواصل مع الدعم.`, cta: 'عرض إحالاتي' }),
      payout_details_changed: ({ s, lang }) => ({ subject: 'تم تغيير بياناتك البنكية', headline: 'تم تغيير بياناتك البنكية', intro: `تم للتو تغيير بيانات حسابك البنكي لاستلام المدفوعات. إن لم تكن أنت، تواصل مع الدعم فورًا. حفاظًا على أمانك، تنتظر مدفوعات الإحالة ${fmtInt(s.payoutChangeDays, lang)} أيام بعد أي تغيير.`, cta: 'مراجعة بياناتي' }),
      monthly_statement: () => ({ subject: 'كشف الإحالات الشهري', headline: 'كشف الإحالات الشهري', intro: 'هذا ملخص أسطر مكافآت أحِل واربح لهذا الشهر. الكشف الكامل بكل الحسابات موجود في صفحة أحِل واربح.', cta: 'فتح الكشف' }),
      weekly_digest_admin: () => ({ subject: 'ملخص أحِل واربح الأسبوعي', headline: 'أحِل واربح هذا الأسبوع', intro: 'أرقام البرنامج لآخر 7 أيام. الأسطر التي تنتظر المراجعة تحتاج إلى مسؤول.', cta: 'فتح إحالات الإدارة' }),
    },
  },
};

const FONT_EN = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_AR = "Tahoma, 'Segoe UI', 'Geeza Pro', Arial, sans-serif";

// Brand hero: violet to teal on every Refer & earn e-mail; the status shows in the chip and the amount colour.
const BRAND = { from: '#6D28D9', to: '#0F766E', solid: '#5B21B6', button: '#5B21B6', ink: '#4C1D95', soft: '#F5F3FF', track: '#E9E5F5' };

export type ReferralChip = 'earned' | 'held' | 'available' | 'paid' | 'reversed' | 'active' | 'pending' | 'rejected' | 'expired' | 'statement' | 'digest' | 'security';
/** Status chip colours (all with dark text on a light fill, readable in light and inverted dark mode). */
export const CHIP_COLORS: Record<ReferralChip, { bg: string; fg: string }> = {
  earned: { bg: '#DCFCE7', fg: '#166534' }, held: { bg: '#FEF3C7', fg: '#92400E' }, available: { bg: '#CCFBF1', fg: '#115E59' },
  paid: { bg: '#DBEAFE', fg: '#1E40AF' }, reversed: { bg: '#FEE2E2', fg: '#991B1B' }, active: { bg: '#DCFCE7', fg: '#166534' },
  pending: { bg: '#EDE9FE', fg: '#5B21B6' }, rejected: { bg: '#FEE2E2', fg: '#991B1B' }, expired: { bg: '#F1F5F9', fg: '#475569' },
  statement: { bg: '#EDE9FE', fg: '#5B21B6' }, digest: { bg: '#EDE9FE', fg: '#5B21B6' }, security: { bg: '#FEE2E2', fg: '#991B1B' },
};
const KIND_CHIP: Record<ReferralEmailKind, ReferralChip> = {
  signup: 'pending', invited: 'pending', passed_self: 'active', passed_other: 'active', active: 'active', verified: 'active', reminder: 'pending',
  ack_request: 'pending', expired: 'expired', first_reward: 'earned', reward_earned: 'earned', reward_held: 'held', reward_available: 'available',
  reward_paid: 'paid', reward_reversed: 'reversed', referral_rejected: 'rejected', payout_details_changed: 'security',
  monthly_statement: 'statement', weekly_digest_admin: 'digest',
};
export const chipFor = (kind: ReferralEmailKind): ReferralChip => KIND_CHIP[kind];
/** Status of one reward line (database status / kind) as a chip. */
export function lineChip(status: unknown, kind?: unknown): ReferralChip {
  const s = String(status ?? '');
  if (kind === 'reversal' || s === 'reversed') return 'reversed';
  if (s === 'paid') return 'paid';
  if (s === 'held') return 'held';
  if (s === 'available' || s === 'in_payout') return 'available';
  return 'earned';
}

const UI = {
  en: {
    chip: { earned: 'Earned', held: 'Held', available: 'Available', paid: 'Paid', reversed: 'Reversed', active: 'Active', pending: 'In progress', rejected: 'Not accepted', expired: 'Expired', statement: 'Statement', digest: 'Weekly summary', security: 'Security' } as Record<ReferralChip, string>,
    amountWord: { first_reward: 'earned', reward_earned: 'earned', reward_held: 'on hold', reward_available: 'available', reward_paid: 'paid', reward_reversed: 'reversed' } as Record<string, string>,
    strip: (c: Ctx) => [
      ['Share your code', 'Send your personal code to an SAP consultant you know.'],
      ['Both pass the AI interview', `Score at least ${fmtInt(c.s.passMark, c.lang)} and accept the referral terms.`],
      ['Earn on paid work', `${rateRange(c.s, c.lang)} of their approved fee for ${fmtInt(c.s.months, c.lang)} months.`],
    ],
    stripTitle: 'Three simple steps',
    tierTitle: 'Your reward level',
    tierLine: (t: ReferralEmailTier, lang: ReferralEmailLang) => `${t.name ? `${t.name} · ` : ''}${t.rate != null ? `${fmtRate(Number(t.rate), lang)} %` : ''} · ${fmtInt(t.count, lang)} verified referral${t.count === 1 ? '' : 's'}`,
    tierNext: (t: ReferralEmailTier, lang: ReferralEmailLang) => (t.next_min != null && t.needed != null
      ? `${fmtInt(Number(t.needed), lang)} more verified referral${Number(t.needed) === 1 ? '' : 's'} to reach ${t.next_rate != null ? `${fmtRate(Number(t.next_rate), lang)} %` : 'the next level'} on later work.`
      : 'You are on the top level.'),
    tableTitle: 'Reward lines', thWho: 'Referral', thRef: 'Ticket', thFee: 'Fee', thReward: 'Reward', thStatus: 'Status',
    total: 'Total', net: 'Net for the period', more: (n: number) => `+ ${n} more line${n === 1 ? '' : 's'} in your statement`, none: 'No reward lines in this period.',
    barTitle: 'Where the period’s rewards stand',
    kpi: { signups: 'New sign-ups', verified: 'Verified', review: 'Waiting for review' },
    period: 'Period',
    adminWhy: 'You receive this summary because you are an administrator of AI Support 360.',
  },
  ar: {
    chip: { earned: 'مكتسبة', held: 'معلّقة', available: 'متاحة', paid: 'مدفوعة', reversed: 'مستردّة', active: 'نشطة', pending: 'قيد التقدّم', rejected: 'غير مقبولة', expired: 'منتهية', statement: 'كشف', digest: 'ملخص أسبوعي', security: 'أمان' } as Record<ReferralChip, string>,
    amountWord: { first_reward: 'مكتسبة', reward_earned: 'مكتسبة', reward_held: 'معلّقة', reward_available: 'متاحة', reward_paid: 'مدفوعة', reward_reversed: 'مستردّة' } as Record<string, string>,
    strip: (c: Ctx) => [
      ['شارك رمزك', 'أرسل رمزك الشخصي إلى مستشار SAP تعرفه.'],
      ['اجتيازكما المقابلة الذكية', `بدرجة ${fmtInt(c.s.passMark, c.lang)} على الأقل مع الموافقة على شروط الإحالة.`],
      ['اربح من الأعمال المدفوعة', `${rateRange(c.s, c.lang)} من أتعابه المعتمدة لمدة ${fmtInt(c.s.months, c.lang)} شهرًا.`],
    ],
    stripTitle: 'ثلاث خطوات بسيطة',
    tierTitle: 'مستوى مكافأتك',
    tierLine: (t: ReferralEmailTier, lang: ReferralEmailLang) => `${t.name ? `${t.name} · ` : ''}${t.rate != null ? `${fmtRate(Number(t.rate), lang)} ٪` : ''} · ${fmtInt(t.count, lang)} إحالات موثّقة`,
    tierNext: (t: ReferralEmailTier, lang: ReferralEmailLang) => (t.next_min != null && t.needed != null
      ? `${fmtInt(Number(t.needed), lang)} إحالات موثّقة أخرى للوصول إلى ${t.next_rate != null ? `${fmtRate(Number(t.next_rate), lang)} ٪` : 'المستوى التالي'} على الأعمال اللاحقة.`
      : 'أنت في أعلى مستوى.'),
    tableTitle: 'أسطر المكافآت', thWho: 'الإحالة', thRef: 'التذكرة', thFee: 'الأتعاب', thReward: 'المكافأة', thStatus: 'الحالة',
    total: 'الإجمالي', net: 'الصافي للفترة', more: (n: number) => `+ ${n} أسطر أخرى في كشفك`, none: 'لا توجد أسطر مكافآت في هذه الفترة.',
    barTitle: 'وضع مكافآت الفترة',
    kpi: { signups: 'تسجيلات جديدة', verified: 'موثّقة', review: 'بانتظار المراجعة' },
    period: 'الفترة',
    adminWhy: 'يصلك هذا الملخص لأنك مسؤول في AI Support 360.',
  },
} as const;

const MONEY_KINDS = ['first_reward', 'reward_earned', 'reward_held', 'reward_available', 'reward_paid', 'reward_reversed'];
const TIER_KINDS = [...MONEY_KINDS, 'active', 'verified', 'monthly_statement'];
const STRIP_STEP: Partial<Record<ReferralEmailKind, number>> = {
  signup: 2, invited: 2, passed_self: 2, passed_other: 2, reminder: 2, ack_request: 2, active: 3, verified: 3,
};
const CONTENT_W = 576;

/** "$12.50", "€12.50" or "12.50 SAR" (amount never computed here, only formatted). */
function moneyShort(n: number, cur: string, lang: ReferralEmailLang): string {
  const c = /^[A-Z]{3}$/.test(cur) ? cur : 'USD';
  const v = fmtNum(Math.abs(n), lang);
  return c === 'USD' ? `$${v}` : c === 'EUR' ? `€${v}` : `${v} ${c}`;
}
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n; };
/** "D. K****" -> "D. K." (initials only in tables). */
export function initials(name: unknown): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  return parts.length ? parts.map((p) => `${p.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase()}.`).join(' ') : '—';
}

/** Columns that sit side by side on wide screens and stack on phones (fluid hybrid; Outlook gets a real table). */
function columns(cells: string[], gap = 12): string {
  const n = Math.max(1, cells.length);
  const w = Math.floor((CONTENT_W - gap * (n - 1)) / n);
  const open = `<!--[if mso]><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><![endif]-->`;
  const body = cells.map((c, i) => `<!--[if mso]><td width="${w}" valign="top" style="padding:0 ${i < n - 1 ? gap : 0}px 0 0"><![endif]-->`
    + `<div style="display:inline-block;width:100%;max-width:${w}px;vertical-align:top;font-size:16px;line-height:1.5;margin:0 ${i < n - 1 ? Math.floor(gap / 2) : 0}px ${gap}px ${i > 0 ? Math.floor(gap / 2) : 0}px">${c}</div>`
    + `<!--[if mso]></td><![endif]-->`).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-size:0;line-height:0;text-align:center">${open}${body}<!--[if mso]></tr></table><![endif]--></td></tr></table>`;
}

function card(inner: string, opts: { bg?: string; border?: string; pad?: string; align: string } ): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:${opts.pad ?? '16px 18px'};border-radius:14px;background:${opts.bg ?? '#ffffff'};border:1px solid ${opts.border ?? '#E5E7EB'};text-align:${opts.align}">${inner}</td></tr></table>`;
}

function chipHtml(chip: ReferralChip, label: string, font: string, size = 12): string {
  const c = CHIP_COLORS[chip];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};color:${c.fg};font-family:${font};font-size:${size}px;font-weight:700;line-height:18px;white-space:nowrap">${esc(label)}</span>`;
}

/** Progress bar made of table cells (works in Outlook): filled part in brand violet, the rest a light track. */
function barHtml(parts: Array<{ pct: number; color: string }>, height = 10): string {
  const clean = parts.map((p) => ({ pct: Math.max(0, Math.min(100, Math.round(p.pct))), color: p.color })).filter((p) => p.pct > 0);
  const used = clean.reduce((a, p) => a + p.pct, 0);
  const cells = clean.map((p) => `<td width="${p.pct}%" bgcolor="${p.color}" style="background:${p.color};height:${height}px;font-size:0;line-height:0">&nbsp;</td>`).join('')
    + (used < 100 ? `<td width="${100 - used}%" bgcolor="${BRAND.track}" style="background:${BRAND.track};height:${height}px;font-size:0;line-height:0">&nbsp;</td>` : '');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:${height}px;overflow:hidden;table-layout:fixed"><tr>${cells}</tr></table>`;
}

function button(href: string, label: string, color: string, font: string): string {
  // Bulletproof: VML roundrect for Outlook on Windows, a padded link inside a coloured table cell everywhere else.
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:28px auto 8px"><tr><td align="center" bgcolor="${color}" style="border-radius:999px;background:${color}">`
    + `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:52px;v-text-anchor:middle;width:300px" arcsize="50%" stroke="f" fillcolor="${color}"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]-->`
    + `<!--[if !mso]><!--><a href="${href}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:${font};font-size:17px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:999px;background:${color}">${esc(label)}</a><!--<![endif]-->`
    + `</td></tr></table>`;
}

function totalsFrom(lines: ReferralEmailLine[], given: ReferralEmailTotal[] | null | undefined, fallbackCur: string): ReferralEmailTotal[] {
  if (given && given.length) return given.filter((t) => /^[A-Z]{3}$/.test(String(t.currency))).slice(0, 4);
  const map = new Map<string, ReferralEmailTotal>();
  for (const l of lines) {
    const cur = /^[A-Z]{3}$/.test(String(l.currency)) ? String(l.currency) : fallbackCur;
    const t = map.get(cur) ?? { currency: cur, earned: 0, held: 0, available: 0, paid: 0, reversed: 0 };
    const chip = lineChip(l.status, l.kind);
    const key = (['earned', 'held', 'available', 'paid', 'reversed'] as const).includes(chip as never) ? chip as 'earned' : 'earned';
    t[key] = (t[key] ?? 0) + Math.abs(num(l.reward) ?? 0);
    map.set(cur, t);
  }
  return [...map.values()].slice(0, 4);
}

export function renderReferralEmail(input: ReferralEmailInput): RenderedReferralEmail {
  const lang: ReferralEmailLang = input.lang === 'ar' ? 'ar' : 'en';
  const kind = normaliseKind(input.kind);
  const tone = toneFor(kind);
  const tab = tabFor(kind);
  const s = cleanSettings(input.settings);
  const c = COPY[lang];
  const u = UI[lang];
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? FONT_AR : FONT_EN;
  const admin = kind === 'weekly_digest_admin';
  const site = safeUrl(input.siteUrl || SITE).replace(/\/+$/, '');
  const other = String(input.other || '').trim().slice(0, 80) || (lang === 'ar' ? 'المستشار' : 'the consultant');
  const ctx: Ctx = { o: other, s, lang };
  const b = c.k[kind](ctx);
  const chip = chipFor(kind);
  const amountN = num(input.amount);
  const cur = /^[A-Z]{3}$/.test(String(input.currency)) ? String(input.currency) : s.currency;
  const amount = money(input.amount, cur, lang);
  const step = (['pass_interview', 'acknowledge', 'wait_other'].includes(String(input.nextStep)) ? input.nextStep : 'none') as ReferralNextStep;
  const nextText = b.next ? c.next[step](ctx) : '';
  const ctaUrl = admin ? safeUrl(`${site}/admin/referrals`) : safeUrl(`${site}/consultant/referrals?tab=${tab}`);
  const howUrl = safeUrl(`${site}/consultant/referrals?tab=programme`);
  const termsUrl = safeUrl(`${site}/referral-terms`);
  const prefsUrl = safeUrl(admin ? `${site}/admin` : `${site}/consultant/settings`);
  const logo = safeUrl(input.logoUrl || `${SITE}/icon-192.png`, `${SITE}/icon-192.png`);
  const hero = input.bannerUrl ? safeUrl(input.bannerUrl, '') : '';
  const subject = `${input.test ? '[TEST] ' : ''}${b.subject}`;
  const preheader = b.intro.length > 110 ? `${b.intro.slice(0, 107)}…` : b.intro;
  const lines = (input.lines ?? []).slice(0, 20);
  const isTable = kind === 'monthly_statement' || admin;
  const tier = input.tier && Number.isFinite(Number(input.tier.count)) && TIER_KINDS.includes(kind) ? input.tier : null;
  const P = (txt: string, extra = '') => `<p style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:1.65;color:#1F2937;text-align:${align}${extra}">${esc(txt)}</p>`;
  const H = (txt: string) => `<p style="margin:8px 0 12px;font-family:${font};font-size:18px;font-weight:800;color:#111827;text-align:${align}">${esc(txt)}</p>`;
  const divider = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:12px 0"><div style="height:1px;line-height:1px;font-size:0;background:#EEF0F4">&nbsp;</div></td></tr></table>`;

  const parts: string[] = [];
  if (input.test) parts.push(`<p style="margin:0 0 16px;padding:8px 12px;border-radius:10px;background:#FFF7E6;font-family:${font};font-size:13px;color:#78350F;text-align:${align}">${esc(c.test)}</p>`);
  parts.push(P(c.hello(input.name ? String(input.name).slice(0, 80) : undefined)));
  parts.push(P(b.intro));

  // Large number highlight: "+$12.50 earned"
  if (amountN != null && amount && b.amountLabel) {
    const sign = kind === 'reward_reversed' ? '−' : kind === 'first_reward' || kind === 'reward_earned' ? '+' : '';
    const ch = CHIP_COLORS[chip];
    parts.push(card(
      `<p style="margin:0 0 6px">${chipHtml(chip, u.chip[chip], font)}</p>`
      + `<p style="margin:0;font-family:${font};line-height:1.15;color:${ch.fg}"><span dir="ltr" style="font-size:40px;font-weight:800;letter-spacing:-0.02em">${esc(sign + moneyShort(amountN, cur, lang))}</span> <span style="font-size:18px;font-weight:700">${esc(u.amountWord[kind] ?? '')}</span></p>`
      + `<p style="margin:6px 0 0;font-family:${font};font-size:13px;color:#475569">${esc(c.amountNote[b.amountLabel] ?? '')}</p>`,
      { bg: ch.bg, border: `${ch.fg}33`, pad: '20px 22px', align }));
    parts.push('<div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>');
  }

  if (nextText) {
    parts.push(card(`<p style="margin:0 0 4px;font-family:${font};font-size:13px;font-weight:700;color:${BRAND.ink}">${esc(c.nextTitle)}</p><p style="margin:0;font-family:${font};font-size:16px;line-height:1.55;color:#1F2937">${esc(nextText)}</p>`,
      { bg: BRAND.soft, border: '#DDD6FE', align }));
    parts.push('<div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>');
  }

  // Weekly digest: three KPI cards
  if (admin) {
    const st = input.stats ?? {};
    parts.push(columns((['signups', 'verified', 'review'] as const).map((k) => card(
      `<p style="margin:0;font-family:${font};font-size:30px;font-weight:800;color:${BRAND.ink}">${esc(fmtInt(Number(st[k] ?? 0), lang))}</p><p style="margin:4px 0 0;font-family:${font};font-size:13px;color:#475569">${esc(u.kpi[k])}</p>`,
      { bg: BRAND.soft, border: '#DDD6FE', align: 'center', pad: '14px 10px' }))));
  }

  // Statement / digest: period, mini table, totals and a stacked bar
  if (isTable) {
    if (input.period) parts.push(`<p style="margin:0 0 10px;font-family:${font};font-size:14px;color:#475569;text-align:${align}">${esc(u.period)}: <strong style="color:#111827">${esc(String(input.period).slice(0, 60))}</strong></p>`);
    parts.push(H(u.tableTitle));
    if (!lines.length) parts.push(P(u.none, ';color:#475569'));
    else {
      const th = (x: string, a = align) => `<th align="${a}" style="padding:10px 6px;font-family:${font};font-size:12px;font-weight:700;color:#475569;text-align:${a};border-bottom:1px solid #E5E7EB">${esc(x)}</th>`;
      const end = rtl ? 'left' : 'right';
      const td = (x: string, a = align, extra = '') => `<td align="${a}" style="padding:10px 6px;font-family:${font};font-size:13px;color:#1F2937;text-align:${a};border-bottom:1px solid #F1F5F9${extra}">${x}</td>`;
      const rows = lines.map((l) => {
        const lc = lineChip(l.status, l.kind);
        const lcur = /^[A-Z]{3}$/.test(String(l.currency)) ? String(l.currency) : cur;
        const fee = num(l.fee); const rw = num(l.reward);
        return `<tr>${td(esc(initials(l.who)))}${td(`<span dir="ltr" style="white-space:nowrap;font-size:12px">${esc(String(l.ref ?? '—').slice(0, 16))}</span>`)}`
          + `${td(fee == null ? '—' : `<span dir="ltr">${esc(moneyShort(fee, lcur, lang))}</span>`, end)}`
          + `${td(rw == null ? '—' : `<span dir="ltr" style="font-weight:700;color:${CHIP_COLORS[lc].fg}">${esc((lc === 'reversed' ? '−' : '') + moneyShort(rw, lcur, lang))}</span>`, end)}`
          + `${td(chipHtml(lc, u.chip[lc], font, 11), end)}</tr>`;
      }).join('');
      parts.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="${dir}" style="border:1px solid #E5E7EB;border-radius:14px;border-collapse:separate;overflow:hidden">`
        + `<tr style="background:#F8FAFC">${th(u.thWho)}${th(u.thRef)}${th(u.thFee, end)}${th(u.thReward, end)}${th(u.thStatus, end)}</tr>${rows}</table>`);
      const extraLines = Math.max(0, (input.lines ?? []).length - lines.length);
      if (extraLines) parts.push(`<p style="margin:8px 0 0;font-family:${font};font-size:13px;color:#64748B;text-align:${align}">${esc(u.more(extraLines))}</p>`);
    }
    const totals = totalsFrom(input.lines ?? [], input.totals, cur);
    for (const tt of totals) {
      const keys = ['earned', 'held', 'available', 'paid', 'reversed'] as const;
      const sum = keys.reduce((a, k) => a + Math.abs(Number(tt[k] ?? 0)), 0);
      const net = keys.filter((k) => k !== 'reversed').reduce((a, k) => a + Math.abs(Number(tt[k] ?? 0)), 0) - Math.abs(Number(tt.reversed ?? 0));
      const legend = keys.filter((k) => Number(tt[k] ?? 0) !== 0).map((k) => `${chipHtml(k, `${u.chip[k]} ${moneyShort(Number(tt[k]), tt.currency, lang)}`, font, 11)} `).join('');
      parts.push('<div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>');
      parts.push(card(
        `<p style="margin:0 0 4px;font-family:${font};font-size:13px;font-weight:700;color:#475569">${esc(u.barTitle)} · ${esc(tt.currency)}</p>`
        + `<p style="margin:0 0 12px;font-family:${font};font-size:15px;color:#111827">${esc(u.net)}: <strong dir="ltr" style="font-size:22px;color:${BRAND.ink}">${esc((net < 0 ? '−' : '') + moneyShort(net, tt.currency, lang))}</strong></p>`
        + (sum > 0 ? barHtml(keys.map((k) => ({ pct: (Math.abs(Number(tt[k] ?? 0)) / sum) * 100, color: CHIP_COLORS[k].fg })), 12) : '')
        + `<p style="margin:12px 0 0;line-height:26px">${legend}</p>`,
        { align }));
    }
  }

  // Progress to the next reward level (table cells, works in Outlook)
  if (tier) {
    const min = Number(tier.min ?? 0); const next = tier.next_min != null ? Number(tier.next_min) : null;
    const pct = next == null ? 100 : Math.max(0, Math.min(100, ((Number(tier.count) - min) / Math.max(1, next - min)) * 100));
    parts.push('<div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>');
    parts.push(card(
      `<p style="margin:0 0 4px;font-family:${font};font-size:13px;font-weight:700;color:${BRAND.ink}">${esc(u.tierTitle)}</p>`
      + `<p style="margin:0 0 12px;font-family:${font};font-size:16px;font-weight:700;color:#111827">${esc(u.tierLine(tier, lang))}</p>`
      + barHtml([{ pct, color: BRAND.solid }], 10)
      + `<p style="margin:10px 0 0;font-family:${font};font-size:13px;line-height:1.5;color:#475569">${esc(u.tierNext(tier, lang))}</p>`,
      { bg: BRAND.soft, border: '#DDD6FE', align }));
  }

  // Benefit cards (side by side, stacked on phones)
  if (b.benefits) {
    parts.push(divider, H(c.benefitsTitle));
    parts.push(columns(c.benefits(ctx).map(([h, d]) => card(
      `<p style="margin:0 0 6px;font-family:${font};font-size:15px;font-weight:800;color:${BRAND.ink}">${esc(h)}</p><p style="margin:0;font-family:${font};font-size:14px;line-height:1.5;color:#374151">${esc(d)}</p>`,
      { bg: BRAND.soft, border: '#DDD6FE', align }))));
  }

  // Simple 3-step strip (done steps get a tick)
  const stripAt = STRIP_STEP[kind];
  if (stripAt) {
    parts.push(divider, H(u.stripTitle));
    parts.push(columns(u.strip(ctx).map(([h, d], i) => {
      const done = i + 1 < stripAt; const now = i + 1 === stripAt;
      const bg = done ? '#16A34A' : now ? BRAND.solid : '#CBD5E1';
      return card(
        `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="${rtl ? 'right' : 'left'}"><tr><td bgcolor="${bg}" style="width:30px;height:30px;border-radius:15px;background:${bg};color:#ffffff;font-family:${font};font-size:14px;font-weight:800;line-height:30px;text-align:center">${done ? '&#10003;' : esc(fmtInt(i + 1, lang))}</td></tr></table>`
        + `<div style="clear:both;height:10px;line-height:10px;font-size:0">&nbsp;</div>`
        + `<p style="margin:0 0 4px;font-family:${font};font-size:15px;font-weight:800;color:#111827">${esc(h)}</p><p style="margin:0;font-family:${font};font-size:13px;line-height:1.5;color:#475569">${esc(d)}</p>`,
        { bg: now ? BRAND.soft : '#ffffff', border: now ? '#C4B5FD' : '#E5E7EB', align, pad: '14px 14px' });
    })));
  }

  if (b.example) {
    parts.push('<div style="height:8px;line-height:8px;font-size:0">&nbsp;</div>');
    parts.push(card(`<p style="margin:0 0 6px;font-family:${font};font-size:13px;font-weight:700;color:#475569">${esc(c.exampleTitle)}</p>`
      + `<p style="margin:0 0 6px;font-family:${font};font-size:17px;font-weight:800;color:#111827">${esc(c.example(ctx))}</p>`
      + `<p style="margin:0;font-family:${font};font-size:13px;line-height:1.5;color:#475569">${esc(c.exampleNote(ctx))}</p>`,
      { bg: '#F8FAFC', border: '#CBD5E1', align }));
  }

  parts.push(button(esc(ctaUrl), b.cta, BRAND.button, font));
  if (!admin) parts.push(`<p style="margin:0 0 8px;font-family:${font};font-size:14px;text-align:center"><a href="${esc(howUrl)}" target="_blank" style="color:${BRAND.ink};text-decoration:underline">${esc(c.how)}</a></p>`);
  parts.push(divider);
  if (!admin) parts.push(`<p style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:1.6;color:#64748B;text-align:${align}">${esc(c.fine(ctx))}${s.termsDraft ? ` ${esc(c.draft)}` : ''} <a href="${esc(termsUrl)}" target="_blank" style="color:#475569;text-decoration:underline">${esc(c.terms)}</a></p>`);

  const pl = input.pauseLinks;
  const pause = pl ? `<p style="margin:8px 0 0;font-family:${font};font-size:12px;color:#64748B">${esc(c.pauseLead)} <a href="${esc(safeUrl(pl.d3))}" style="color:#475569">${esc(c.d3)}</a> | <a href="${esc(safeUrl(pl.w1))}" style="color:#475569">${esc(c.w1)}</a> | <a href="${esc(safeUrl(pl.m1))}" style="color:#475569">${esc(c.m1)}</a></p>` : '';

  const showArt = hero && tone !== 'negative' && tone !== 'pending' && kind !== 'payout_details_changed';
  const heroText = `<p style="margin:0 0 10px">${chipHtml(chip, u.chip[chip], font)}</p>`
    + `<p style="margin:0 0 6px;font-family:${font};font-size:13px;font-weight:700;letter-spacing:${rtl ? '0' : '0.08em'};text-transform:${rtl ? 'none' : 'uppercase'};color:#EDE9FE">${esc(c.eyebrow)}</p>`
    + `<h1 style="margin:0;font-family:${font};font-size:28px;line-height:1.25;font-weight:800;color:#ffffff">${esc(b.headline)}</h1>`;
  const heroInner = showArt
    ? `<!--[if mso]><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="360" valign="middle"><![endif]-->`
      + `<div style="display:inline-block;width:100%;max-width:340px;vertical-align:middle;font-size:16px;line-height:1.4;text-align:${align}">${heroText}</div>`
      + `<!--[if mso]></td><td width="180" valign="middle" align="center"><![endif]-->`
      + `<div style="display:inline-block;width:100%;max-width:170px;vertical-align:middle;text-align:center;padding-top:8px"><img src="${esc(hero)}" width="140" alt="${esc(c.bannerAlt)}" style="display:inline-block;width:140px;max-width:100%;height:auto;border:0" /></div>`
      + `<!--[if mso]></td></tr></table><![endif]-->`
    : `<div style="font-size:16px;line-height:1.4;text-align:${align}">${heroText}</div>`;

  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#ffffff;" dir="${dir}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 8px">`
    + `<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" dir="${dir}" style="width:100%;max-width:600px">`
    // Brand header
    + `<tr><td style="padding:0 8px 16px;text-align:${align}"><a href="${esc(site)}" target="_blank" style="text-decoration:none"><img src="${esc(logo)}" width="36" height="36" alt="${esc(c.logoAlt)}" style="vertical-align:middle;border:0;border-radius:10px" /> <span style="font-family:${FONT_EN};font-size:17px;font-weight:800;color:#1B2559;vertical-align:middle">AI Support 360</span></a></td></tr>`
    // Gradient hero (violet to teal) with the gift-and-coins illustration
    + `<tr><td bgcolor="${BRAND.solid}" style="padding:28px 24px;border-radius:20px;background:${BRAND.solid};background-image:linear-gradient(135deg,${BRAND.from},${BRAND.to});font-size:0;text-align:center">${heroInner}</td></tr>`
    // Body card
    + `<tr><td style="padding:28px 12px 8px">${parts.join('')}</td></tr>`
    // Footer
    + `<tr><td style="padding:8px 12px 0;text-align:${align}">`
    + `<p style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:1.6;color:#64748B">${esc(admin ? u.adminWhy : c.why)} <a href="${esc(prefsUrl)}" target="_blank" style="color:#475569;text-decoration:underline">${esc(c.prefs)}</a></p>`
    + pause
    + `<p style="margin:8px 0 0;font-family:${font};font-size:12px;color:#94A3B8">${esc(c.company)} · <span dir="ltr">${esc(c.sentBy)}</span></p>`
    + `</td></tr></table></td></tr></table></body></html>`;

  // Plain-text part (same content, same order)
  const out: string[] = [];
  if (input.test) out.push(c.test, '');
  out.push(`${c.eyebrow.toUpperCase()} - ${b.headline} [${u.chip[chip]}]`, '', c.hello(input.name ? String(input.name).slice(0, 80) : undefined), '', b.intro);
  if (amount && b.amountLabel) out.push('', `${c.amountNote[b.amountLabel]}: ${kind === 'reward_reversed' ? '-' : ''}${amount}`);
  if (nextText) out.push('', `${c.nextTitle}: ${nextText}`);
  if (admin) { const st = input.stats ?? {}; out.push('', `${u.kpi.signups}: ${st.signups ?? 0} | ${u.kpi.verified}: ${st.verified ?? 0} | ${u.kpi.review}: ${st.review ?? 0}`); }
  if (isTable) {
    if (input.period) out.push('', `${u.period}: ${input.period}`);
    out.push('', u.tableTitle);
    if (!lines.length) out.push(u.none);
    for (const l of lines) {
      const lc = lineChip(l.status, l.kind); const lcur = /^[A-Z]{3}$/.test(String(l.currency)) ? String(l.currency) : cur;
      const fee = num(l.fee); const rw = num(l.reward);
      out.push(`- ${initials(l.who)} | ${String(l.ref ?? '-').slice(0, 16)} | ${fee == null ? '-' : moneyShort(fee, lcur, lang)} | ${rw == null ? '-' : (lc === 'reversed' ? '-' : '') + moneyShort(rw, lcur, lang)} | ${u.chip[lc]}`);
    }
    for (const tt of totalsFrom(input.lines ?? [], input.totals, cur)) {
      out.push(`${u.total} ${tt.currency}: ${(['earned', 'held', 'available', 'paid', 'reversed'] as const).filter((k) => Number(tt[k] ?? 0)).map((k) => `${u.chip[k]} ${moneyShort(Number(tt[k]), tt.currency, lang)}`).join(', ') || '0'}`);
    }
  }
  if (tier) out.push('', `${u.tierTitle}: ${u.tierLine(tier, lang)}`, u.tierNext(tier, lang));
  if (b.benefits) { out.push('', c.benefitsTitle); for (const [h, d] of c.benefits(ctx)) out.push(`- ${h}: ${d}`); }
  if (stripAt) { out.push('', u.stripTitle); u.strip(ctx).forEach(([h, d], i) => out.push(`${i + 1}. ${h} - ${d}`)); }
  if (b.example) out.push('', `${c.exampleTitle}: ${c.example(ctx)}`, c.exampleNote(ctx));
  out.push('', `${b.cta}: ${ctaUrl}`);
  if (!admin) out.push(`${c.how}: ${howUrl}`, '', `${c.fine(ctx)}${s.termsDraft ? ` ${c.draft}` : ''}`, `${c.terms}: ${termsUrl}`);
  out.push('', '--', `${admin ? u.adminWhy : c.why} ${c.prefs}: ${prefsUrl}`);
  if (pl) out.push(`${c.pauseLead} ${c.d3}: ${safeUrl(pl.d3)} | ${c.w1}: ${safeUrl(pl.w1)} | ${c.m1}: ${safeUrl(pl.m1)}`);
  out.push(`${c.company} · ${c.sentBy}`);

  return { kind, lang, tone, tab, subject, preheader, html, text: out.join('\n'), ctaUrl };
}

/** Sample data for the admin preview and the "Send test to me" mail (masked names only, clearly fake amounts). */
export function sampleReferralEmail(kind: ReferralEmailKind, lang: ReferralEmailLang): ReferralEmailInput {
  const isMoney = MONEY_KINDS.includes(kind);
  const sampleLines: ReferralEmailLine[] = [
    { who: 'D. K****', ref: 'R-7Q4M', fee: 480, reward: 2.4, status: 'pending', currency: 'USD' },
    { who: 'M. A****', ref: 'R-2H9X', fee: 1200, reward: 6, status: 'available', currency: 'USD' },
    { who: 'D. K****', ref: 'R-5K1T', fee: 960, reward: 4.8, status: 'paid', currency: 'USD' },
    { who: 'S. N****', ref: 'R-8P3C', fee: 300, reward: 1.5, status: 'held', currency: 'USD' },
    { who: 'M. A****', ref: 'R-2H9X', fee: 240, reward: 1.2, status: 'reversed', kind: 'reversal', currency: 'USD' },
  ];
  return {
    kind, lang, name: lang === 'ar' ? 'سارة' : 'Sara', other: 'D. K****',
    amount: isMoney ? (kind === 'reward_earned' || kind === 'first_reward' ? 2.4 : 12.5) : null, currency: 'USD',
    nextStep: kind === 'passed_self' ? 'acknowledge' : kind === 'passed_other' || kind === 'reminder' ? 'pass_interview' : 'none',
    tier: TIER_KINDS.includes(kind) ? { count: 7, name: 'Tier 1', rate: 0.5, min: 0, next_name: 'Tier 2', next_min: 11, next_rate: 0.6, needed: 4 } : null,
    period: kind === 'monthly_statement' ? (lang === 'ar' ? 'سبتمبر 2026' : 'September 2026') : kind === 'weekly_digest_admin' ? '12–18 Oct 2026' : null,
    lines: kind === 'monthly_statement' || kind === 'weekly_digest_admin' ? sampleLines : null,
    stats: kind === 'weekly_digest_admin' ? { signups: 4, verified: 2, review: 1 } : null,
  };
}

/** Programme numbers for e-mails from platform_settings rows (key/value), with the documented defaults. */
export function referralEmailSettingsFrom(rows: Array<{ key: string; value: unknown }> | null | undefined): ReferralEmailSettings {
  const get = (k: string) => (rows ?? []).find((r) => r.key === k)?.value;
  const tiers = Array.isArray(get('referral_tiers')) ? (get('referral_tiers') as Array<{ rate?: unknown }>) : [];
  const rates = tiers.map((x) => Number(x?.rate)).filter((n) => Number.isFinite(n) && n > 0);
  const n = (k: string) => { const v = get(k); const x = typeof v === 'string' ? Number(v) : (v as number); return Number.isFinite(x) ? x : undefined; };
  const cur = get('referral_email_example_currency');
  const draft = get('referral_terms_draft');
  return cleanSettings({
    minRate: rates.length ? Math.min(...rates) : undefined,
    maxRate: rates.length ? Math.max(...rates) : undefined,
    months: n('referral_months'), holdDays: n('referral_hold_days'), passMark: n('referral_min_interview_score'),
    activationDays: n('referral_activation_days'), payoutChangeDays: n('payout_details_change_hold_days'),
    exampleFee: n('referral_email_example_fee'),
    currency: typeof cur === 'string' ? cur : undefined,
    termsDraft: draft === false || draft === 'false' ? false : true,
  });
}

export const REFERRAL_EMAIL_SETTING_KEYS = [
  'referral_tiers', 'referral_months', 'referral_hold_days', 'referral_min_interview_score', 'referral_activation_days',
  'payout_details_change_hold_days', 'referral_email_example_fee', 'referral_email_example_currency', 'referral_terms_draft',
] as const;

/** Gift-and-coins illustration of the hero (a file of the published site; omitted until it is live). */
export const REFERRAL_BANNER_URL = `${SITE}/email/referral-hero.png`;
