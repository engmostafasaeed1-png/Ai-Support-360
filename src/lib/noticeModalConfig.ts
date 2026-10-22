/**
 * The ONE list of notices that may open a blocking pop-up (modal). Everything else is a normal card in the bell; a few
 * routine kinds may in addition show a one-time banner at the top of the page. Every pop-up family (responsiveness,
 * Refer & earn, admin broadcast messages) asks here, so no screen can turn a routine notice into a modal on its own.
 *
 * Rule of thumb for a modal: it changes the person's statistics or money, concerns account security, or needs a decision.
 */
export type NoticeFamily = 'responsiveness' | 'referral' | 'broadcast';
export type NoticeDisplay = 'modal' | 'banner' | 'bell';

/** `prefix_*` matches every kind that starts with the prefix. */
export const NOTICE_MODAL_KINDS: Readonly<Record<NoticeFamily, readonly string[]>> = {
  // Counted no-response, friendly notices 1 / 2 / ..., indicator now shown, dispute decided.
  responsiveness: ['counted', 'warning_*', 'badge_visible', 'dispute_upheld', 'dispute_rejected'],
  // Money taken back, a referral refused, bank details changed (security), terms to accept (virtual item).
  referral: ['ack_request', 'reward_reversed', 'referral_rejected', 'bank_changed', 'terms_pending'],
  // The administrator explicitly chose "Pop-up on next visit" for that message.
  broadcast: ['popup'],
};

/** Routine notices that may show ONE banner (once per device), besides their bell card. */
export const NOTICE_BANNER_KINDS: Readonly<Record<NoticeFamily, readonly string[]>> = {
  responsiveness: [],
  referral: ['invitation'],
  broadcast: [],
};

const matches = (list: readonly string[], kind: string) =>
  list.some((p) => (p.endsWith('*') ? kind.startsWith(p.slice(0, -1)) : p === kind));

export function noticeDisplay(family: NoticeFamily, kind: string | null | undefined): NoticeDisplay {
  const k = String(kind ?? '');
  if (matches(NOTICE_MODAL_KINDS[family], k)) return 'modal';
  if (matches(NOTICE_BANNER_KINDS[family], k)) return 'banner';
  return 'bell';
}

export const isModalNotice = (family: NoticeFamily, kind: string | null | undefined) => noticeDisplay(family, kind) === 'modal';
