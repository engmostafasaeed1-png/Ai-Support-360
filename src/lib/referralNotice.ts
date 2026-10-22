/**
 * Refer & earn in-app notices: which event a stored notification describes, its colour family, its single action and the
 * deep link (right tab / filter of /consultant/referrals). Stored notifications keep type 'referral' (or the older
 * 'referral_intro') and their database title; the kind is read from the known database titles (EN, plus the Arabic
 * invitation subject), so old and new notices look the same. Amounts are read from the stored text, never computed here.
 */
export type ReferralNoticeKind =
  | 'invitation' | 'registered' | 'invited' | 'interview_passed' | 'activated' | 'verified' | 'reminder' | 'ack_request' | 'expired'
  | 'reward_earned' | 'reward_held' | 'reward_available' | 'reward_paid' | 'reward_reversed' | 'referral_rejected'
  | 'bank_changed' | 'statement' | 'generic';

export type ReferralNoticeTone = 'invite' | 'earned' | 'pending' | 'negative';
export type ReferralNoticeAction = 'open' | 'view_earning' | 'view_referral';

export const REFERRAL_NOTICE_TYPES = ['referral', 'referral_intro'] as const;

export function isReferralNotice(type: string | null | undefined): boolean {
  return (REFERRAL_NOTICE_TYPES as readonly string[]).includes(String(type ?? ''));
}

/** Exact titles written by the database (referral-program.sql, referral-invitations.sql). */
const TITLE_KIND: Record<string, ReferralNoticeKind> = {
  'someone registered with your referral code': 'registered',
  'you were invited to ai support 360': 'invited',
  'you passed the ai interview': 'interview_passed',
  'your referral partner passed the ai interview': 'interview_passed',
  'your referral is active': 'activated',
  'your referral is verified': 'verified',
  'your referral is still pending': 'reminder',
  'please accept the referral terms': 'ack_request',
  'your referral has expired': 'expired',
  'you earned your first referral reward': 'reward_earned',
  'new referral reward recorded': 'reward_earned',
  'a referral reward is on hold': 'reward_held',
  'your referral reward is available': 'reward_available',
  'your referral reward was paid': 'reward_paid',
  'a referral reward was reversed': 'reward_reversed',
  'a referral was not accepted': 'referral_rejected',
  'your bank details were changed': 'bank_changed',
  'your referral statement is ready': 'statement',
  'invitation: refer & earn on ai support 360': 'invitation',
  'دعوة: برنامج أحِل واربح على ai support 360': 'invitation',
};

export interface NoticeLike { type?: string | null; title?: string | null; body?: string | null; link?: string | null }

export function referralNoticeKind(n: NoticeLike): ReferralNoticeKind {
  if (n.type === 'referral_intro') return 'invitation';
  const title = String(n.title ?? '').replace(/^\[TEST\]\s*/i, '').trim().toLowerCase();
  if (TITLE_KIND[title]) return TITLE_KIND[title];
  if (/[?&]from=invite\b/.test(String(n.link ?? ''))) return 'invitation';
  if (/reversed/.test(title)) return 'reward_reversed';
  if (/on hold|held/.test(title)) return 'reward_held';
  if (/reward/.test(title) && /paid/.test(title)) return 'reward_paid';
  if (/reward/.test(title)) return 'reward_earned';
  return 'generic';
}

export function referralNoticeTone(kind: ReferralNoticeKind): ReferralNoticeTone {
  switch (kind) {
    case 'reward_earned': case 'reward_available': case 'reward_paid': return 'earned';
    case 'reward_held': case 'reminder': case 'ack_request': return 'pending';
    case 'reward_reversed': case 'referral_rejected': case 'expired': case 'bank_changed': return 'negative';
    default: return 'invite';
  }
}

export function referralNoticeAction(kind: ReferralNoticeKind): ReferralNoticeAction {
  if (kind.startsWith('reward_') || kind === 'statement' || kind === 'bank_changed') return 'view_earning';
  if (['registered', 'interview_passed', 'activated', 'verified', 'reminder', 'ack_request', 'expired', 'referral_rejected'].includes(kind)) return 'view_referral';
  return 'open';
}

const STATUS_FILTER: Partial<Record<ReferralNoticeKind, string>> = {
  reward_held: 'held', reward_available: 'available', reward_paid: 'paid', reward_reversed: 'reversed', reward_earned: 'pending',
};

/** Same-site deep link only: /consultant/referrals with the tab (and the earnings status filter for reward notices). */
export function referralNoticeLink(kind: ReferralNoticeKind): string {
  const action = referralNoticeAction(kind);
  if (action === 'view_earning') {
    const s = STATUS_FILTER[kind];
    return `/consultant/referrals?tab=earnings${s ? `&status=${s}` : ''}`;
  }
  if (action === 'view_referral') return '/consultant/referrals?tab=referrals';
  return '/consultant/referrals?tab=programme';
}

/** "12.50 USD" / "USD 12.50" / "$12.50" from the stored text; null when there is none. */
export function referralNoticeAmount(text: string | null | undefined): { amount: string; currency: string } | null {
  const s = String(text ?? '');
  const a = s.match(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})|\d+(?:\.\d{1,2})?)\s*(USD|EUR|SAR|AED|EGP|GBP)\b/);
  if (a) return { amount: a[1].replace(/[,\s]/g, ''), currency: a[2] };
  const b = s.match(/\b(USD|EUR|SAR|AED|EGP|GBP)\s*(\d+(?:\.\d{1,2})?)/);
  if (b) return { amount: b[2], currency: b[1] };
  const c = s.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  if (c) return { amount: c[1], currency: 'USD' };
  return null;
}

export interface ReferralNoticeView {
  kind: ReferralNoticeKind; tone: ReferralNoticeTone; action: ReferralNoticeAction; link: string;
  amount: { amount: string; currency: string } | null; test: boolean;
}

export function referralNoticeView(n: NoticeLike): ReferralNoticeView {
  const kind = referralNoticeKind(n);
  const money = kind.startsWith('reward_') ? referralNoticeAmount(`${n.title ?? ''} ${n.body ?? ''}`) : null;
  return {
    kind, tone: referralNoticeTone(kind), action: referralNoticeAction(kind), link: referralNoticeLink(kind), amount: money,
    test: /^\[TEST\]/i.test(String(n.title ?? '')),
  };
}
