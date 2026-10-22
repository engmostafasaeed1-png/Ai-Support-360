/**
 * Refer & earn e-mails (Feature Z): ONE shared layout + small content blocks per event, bilingual (EN / AR + RTL).
 * Pure TypeScript without imports, so the edge functions (referral-run, referral-email-test), the admin preview in the
 * browser and the vitest suite render the very same HTML.
 *
 * Mail-client rules followed here: table layout, 600 px, inline CSS only (no <style>, no external fonts, system font
 * stack), white body background, colours that survive dark-mode inversion, alt text on every image, a bulletproof button
 * (table cell + Outlook VML), images only from our own domain. Every value that comes from data is escaped with `esc`
 * and every link goes through `safeUrl` (our own domain only, no tokens or personal data in query strings).
 * Numbers come from the live programme settings passed in; the example is always labelled as an example.
 * The managed e-mail platform appends the unsubscribe footer itself, so this layout never adds its own unsubscribe link.
 */

export type ReferralEmailLang = 'en' | 'ar';
export type ReferralEmailKind =
  | 'signup' | 'invited' | 'passed_self' | 'passed_other' | 'active' | 'reminder' | 'expired' | 'ack_request' | 'verified'
  | 'first_reward' | 'reward_earned' | 'reward_available' | 'reward_held' | 'reward_paid' | 'reward_reversed'
  | 'referral_rejected' | 'payout_details_changed';

export const REFERRAL_EMAIL_KINDS: readonly ReferralEmailKind[] = [
  'signup', 'invited', 'passed_self', 'passed_other', 'active', 'verified', 'reminder', 'ack_request', 'expired',
  'first_reward', 'reward_earned', 'reward_held', 'reward_available', 'reward_paid', 'reward_reversed', 'referral_rejected',
  'payout_details_changed',
] as const;

export type ReferralTone = 'invite' | 'earned' | 'pending' | 'negative';
export type ReferralTab = 'programme' | 'referrals' | 'earnings';
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
}

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

const TONES: Record<ReferralTone, { from: string; to: string; solid: string; soft: string; ink: string; button: string; emoji: string }> = {
  invite: { from: '#6D28D9', to: '#0F766E', solid: '#5B21B6', soft: '#F3EEFF', ink: '#4C1D95', button: '#5B21B6', emoji: '🎁' },
  earned: { from: '#15803D', to: '#0F766E', solid: '#166534', soft: '#ECFDF3', ink: '#14532D', button: '#166534', emoji: '✓' },
  pending: { from: '#B45309', to: '#A16207', solid: '#92400E', soft: '#FFF7E6', ink: '#78350F', button: '#92400E', emoji: '⏳' },
  negative: { from: '#B91C1C', to: '#9F1239', solid: '#991B1B', soft: '#FEF2F2', ink: '#7F1D1D', button: '#991B1B', emoji: '!' },
};

const fmtNum = (n: number, lang: ReferralEmailLang, digits = 2) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const fmtRate = (n: number, lang: ReferralEmailLang) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const fmtInt = (n: number, lang: ReferralEmailLang) => new Intl.NumberFormat('en-US').format(n);

function money(amount: unknown, currency: string, lang: ReferralEmailLang): string | null {
  const n = typeof amount === 'number' ? amount : Number(String(amount ?? '').replace(/[^0-9.\-]/g, ''));
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
    },
  },
};

const FONT_EN = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_AR = "Tahoma, 'Segoe UI', 'Geeza Pro', Arial, sans-serif";

function button(href: string, label: string, color: string, font: string): string {
  // Bulletproof: VML roundrect for Outlook on Windows, a padded link inside a coloured table cell everywhere else.
  return `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:24px 0 8px"><tr><td align="center" bgcolor="${color}" style="border-radius:12px;background:${color}">`
    + `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:48px;v-text-anchor:middle;width:260px" arcsize="25%" stroke="f" fillcolor="${color}"><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${esc(label)}</center></v:roundrect><![endif]-->`
    + `<!--[if !mso]><!--><a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px;background:${color}">${esc(label)}</a><!--<![endif]-->`
    + `</td></tr></table>`;
}

export function renderReferralEmail(input: ReferralEmailInput): RenderedReferralEmail {
  const lang: ReferralEmailLang = input.lang === 'ar' ? 'ar' : 'en';
  const kind = normaliseKind(input.kind);
  const tone = toneFor(kind);
  const tab = tabFor(kind);
  const s = cleanSettings(input.settings);
  const c = COPY[lang];
  const t = TONES[tone];
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? FONT_AR : FONT_EN;
  const site = safeUrl(input.siteUrl || SITE).replace(/\/+$/, '');
  const other = String(input.other || '').trim().slice(0, 80) || (lang === 'ar' ? 'المستشار' : 'the consultant');
  const ctx: Ctx = { o: other, s, lang };
  const b = c.k[kind](ctx);
  const amount = money(input.amount, String(input.currency || s.currency), lang);
  const step = (['pass_interview', 'acknowledge', 'wait_other'].includes(String(input.nextStep)) ? input.nextStep : 'none') as ReferralNextStep;
  const nextText = b.next ? c.next[step](ctx) : '';
  const ctaUrl = safeUrl(`${site}/consultant/referrals?tab=${tab}`);
  const howUrl = safeUrl(`${site}/consultant/referrals?tab=programme`);
  const termsUrl = safeUrl(`${site}/referral-terms`);
  const prefsUrl = safeUrl(`${site}/consultant/settings`);
  const logo = safeUrl(input.logoUrl || `${SITE}/icon-192.png`, `${SITE}/icon-192.png`);
  const banner = input.bannerUrl ? safeUrl(input.bannerUrl, '') : '';
  const subject = `${input.test ? '[TEST] ' : ''}${b.subject}`;
  const preheader = b.intro.length > 110 ? `${b.intro.slice(0, 107)}…` : b.intro;
  const p = (txt: string, extra = '') => `<p style="margin:0 0 16px;font-family:${font};font-size:16px;line-height:1.6;color:#1F2937;text-align:${align}${extra}">${esc(txt)}</p>`;

  const parts: string[] = [];
  if (input.test) parts.push(`<p style="margin:0 0 16px;padding:8px 12px;border-radius:8px;background:#FFF7E6;font-family:${font};font-size:13px;color:#78350F;text-align:${align}">${esc(c.test)}</p>`);
  parts.push(p(c.hello(input.name ? String(input.name).slice(0, 80) : undefined)));
  parts.push(p(b.intro));
  if (amount && b.amountLabel) {
    const sign = kind === 'reward_reversed' ? '−' : '';
    parts.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px"><tr><td style="padding:16px 20px;border-radius:14px;background:${t.soft};border:1px solid ${t.solid}33;text-align:${align}">`
      + `<p style="margin:0;font-family:${font};font-size:13px;color:${t.ink};text-transform:${rtl ? 'none' : 'uppercase'};letter-spacing:${rtl ? '0' : '0.04em'}">${esc(c.amountNote[b.amountLabel] ?? '')}</p>`
      + `<p style="margin:4px 0 0;font-family:${font};font-size:28px;font-weight:800;color:${t.ink}" dir="ltr">${esc(sign + amount)}</p></td></tr></table>`);
  }
  if (nextText) {
    parts.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px"><tr><td style="padding:14px 18px;border-radius:12px;background:#F8FAFC;border-${rtl ? 'right' : 'left'}:4px solid ${t.solid};text-align:${align}">`
      + `<p style="margin:0 0 4px;font-family:${font};font-size:13px;font-weight:700;color:${t.ink}">${esc(c.nextTitle)}</p><p style="margin:0;font-family:${font};font-size:15px;line-height:1.5;color:#1F2937">${esc(nextText)}</p></td></tr></table>`);
  }
  if (b.benefits) {
    const cells = c.benefits(ctx).map(([h, d]) => `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:14px 16px;border-radius:12px;background:${t.soft};text-align:${align}">`
      + `<p style="margin:0 0 4px;font-family:${font};font-size:15px;font-weight:700;color:${t.ink}">${esc(h)}</p><p style="margin:0;font-family:${font};font-size:14px;line-height:1.5;color:#374151">${esc(d)}</p></td></tr></table></td></tr>`).join('');
    parts.push(`<p style="margin:8px 0 10px;font-family:${font};font-size:17px;font-weight:700;color:#111827;text-align:${align}">${esc(c.benefitsTitle)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${cells}</table>`);
  }
  if (b.steps) {
    const rows = c.steps(ctx).map((st, i) => `<tr><td width="36" valign="top" style="padding:0 0 10px"><div style="width:26px;height:26px;border-radius:13px;background:${t.solid};color:#ffffff;font-family:${font};font-size:13px;font-weight:700;line-height:26px;text-align:center">${fmtInt(i + 1, lang)}</div></td>`
      + `<td valign="top" style="padding:3px 0 10px;font-family:${font};font-size:15px;line-height:1.5;color:#1F2937;text-align:${align}">${esc(st)}</td></tr>`).join('');
    parts.push(`<p style="margin:8px 0 10px;font-family:${font};font-size:17px;font-weight:700;color:#111827;text-align:${align}">${esc(c.stepsTitle)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" dir="${dir}">${rows}</table>`);
  }
  if (b.example) {
    parts.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:12px 0 4px"><tr><td style="padding:16px 18px;border-radius:12px;border:1px dashed #94A3B8;background:#F8FAFC;text-align:${align}">`
      + `<p style="margin:0 0 6px;font-family:${font};font-size:13px;font-weight:700;color:#475569">${esc(c.exampleTitle)}</p>`
      + `<p style="margin:0 0 6px;font-family:${font};font-size:16px;font-weight:700;color:#111827">${esc(c.example(ctx))}</p>`
      + `<p style="margin:0;font-family:${font};font-size:13px;line-height:1.5;color:#475569">${esc(c.exampleNote(ctx))}</p></td></tr></table>`);
  }
  parts.push(button(esc(ctaUrl), b.cta, t.button, font));
  parts.push(`<p style="margin:0 0 20px;font-family:${font};font-size:14px;text-align:${align}"><a href="${esc(howUrl)}" target="_blank" style="color:${t.ink};text-decoration:underline">${esc(c.how)}</a></p>`);
  parts.push(`<p style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:1.6;color:#64748B;text-align:${align}">${esc(c.fine(ctx))}${s.termsDraft ? ` ${esc(c.draft)}` : ''} <a href="${esc(termsUrl)}" target="_blank" style="color:#475569;text-decoration:underline">${esc(c.terms)}</a></p>`);

  const pl = input.pauseLinks;
  const pause = pl ? `<p style="margin:8px 0 0;font-family:${font};font-size:12px;color:#64748B">${esc(c.pauseLead)} <a href="${esc(safeUrl(pl.d3))}" style="color:#475569">${esc(c.d3)}</a> | <a href="${esc(safeUrl(pl.w1))}" style="color:#475569">${esc(c.w1)}</a> | <a href="${esc(safeUrl(pl.m1))}" style="color:#475569">${esc(c.m1)}</a></p>` : '';

  const bannerImg = banner && tone !== 'negative' && tone !== 'pending'
    ? `<tr><td style="padding:0;line-height:0;font-size:0"><img src="${esc(banner)}" width="600" alt="${esc(c.bannerAlt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:16px 16px 0 0" /></td></tr>`
    : '';

  const html = `<!DOCTYPE html><html lang="${lang}" dir="${dir}" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#ffffff;" dir="${dir}">`
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" dir="${dir}" style="width:100%;max-width:600px">`
    // Brand header
    + `<tr><td style="padding:0 4px 16px;text-align:${align}"><a href="${esc(site)}" target="_blank" style="text-decoration:none"><img src="${esc(logo)}" width="36" height="36" alt="${esc(c.logoAlt)}" style="vertical-align:middle;border:0;border-radius:8px" /> <span style="font-family:${FONT_EN};font-size:17px;font-weight:800;color:#1B2559;vertical-align:middle">AI Support 360</span></a></td></tr>`
    // Banner (illustration + gradient headline)
    + `<tr><td style="border-radius:16px;overflow:hidden;background:${t.solid}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${bannerImg}`
    + `<tr><td bgcolor="${t.solid}" style="padding:24px 28px 26px;background:${t.solid};background-image:linear-gradient(135deg,${t.from},${t.to});border-radius:${bannerImg ? '0 0 16px 16px' : '16px'};text-align:${align}">`
    + `<p style="margin:0 0 6px;font-family:${font};font-size:13px;font-weight:700;letter-spacing:${rtl ? '0' : '0.06em'};text-transform:${rtl ? 'none' : 'uppercase'};color:#ffffff">${esc(c.eyebrow)}</p>`
    + `<h1 style="margin:0;font-family:${font};font-size:26px;line-height:1.25;font-weight:800;color:#ffffff">${esc(b.headline)}</h1></td></tr></table></td></tr>`
    // Body
    + `<tr><td style="padding:28px 8px 8px">${parts.join('')}</td></tr>`
    // Footer
    + `<tr><td style="padding:16px 8px 0;border-top:1px solid #E2E8F0;text-align:${align}">`
    + `<p style="margin:0 0 6px;font-family:${font};font-size:12px;line-height:1.6;color:#64748B">${esc(c.why)} <a href="${esc(prefsUrl)}" target="_blank" style="color:#475569;text-decoration:underline">${esc(c.prefs)}</a></p>`
    + pause
    + `<p style="margin:8px 0 0;font-family:${font};font-size:12px;color:#94A3B8">${esc(c.company)} · <span dir="ltr">${esc(c.sentBy)}</span></p>`
    + `</td></tr></table></td></tr></table></body></html>`;

  const lines: string[] = [];
  if (input.test) lines.push(c.test, '');
  lines.push(`${c.eyebrow.toUpperCase()} - ${b.headline}`, '', c.hello(input.name ? String(input.name).slice(0, 80) : undefined), '', b.intro);
  if (amount && b.amountLabel) lines.push('', `${c.amountNote[b.amountLabel]}: ${kind === 'reward_reversed' ? '-' : ''}${amount}`);
  if (nextText) lines.push('', `${c.nextTitle}: ${nextText}`);
  if (b.benefits) { lines.push('', c.benefitsTitle); for (const [h, d] of c.benefits(ctx)) lines.push(`- ${h}: ${d}`); }
  if (b.steps) { lines.push('', c.stepsTitle); c.steps(ctx).forEach((st, i) => lines.push(`${i + 1}. ${st}`)); }
  if (b.example) lines.push('', `${c.exampleTitle}: ${c.example(ctx)}`, c.exampleNote(ctx));
  lines.push('', `${b.cta}: ${ctaUrl}`, `${c.how}: ${howUrl}`, '', `${c.fine(ctx)}${s.termsDraft ? ` ${c.draft}` : ''}`, `${c.terms}: ${termsUrl}`, '', '--',
    `${c.why} ${c.prefs}: ${prefsUrl}`);
  if (pl) lines.push(`${c.pauseLead} ${c.d3}: ${safeUrl(pl.d3)} | ${c.w1}: ${safeUrl(pl.w1)} | ${c.m1}: ${safeUrl(pl.m1)}`);
  lines.push(`${c.company} · ${c.sentBy}`);

  return { kind, lang, tone, tab, subject, preheader, html, text: lines.join('\n'), ctaUrl };
}

/** Sample data for the admin preview and the "Send test to me" mail (masked names only, clearly fake amounts). */
export function sampleReferralEmail(kind: ReferralEmailKind, lang: ReferralEmailLang): ReferralEmailInput {
  const money = ['first_reward', 'reward_earned', 'reward_available', 'reward_held', 'reward_paid', 'reward_reversed'].includes(kind);
  return {
    kind, lang, name: lang === 'ar' ? 'سارة' : 'Sara', other: 'D. K****',
    amount: money ? 12.5 : null, currency: 'USD',
    nextStep: kind === 'passed_self' ? 'acknowledge' : kind === 'passed_other' || kind === 'reminder' ? 'pass_interview' : 'none',
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

export const REFERRAL_BANNER_URL = `${SITE}/email/referral-banner.png`;
