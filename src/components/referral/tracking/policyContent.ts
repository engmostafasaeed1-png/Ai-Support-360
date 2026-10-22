import type { TFunction } from 'i18next';
import { formatRate, rateRangeText, tierRangeLabel, type ReferralSettings, type Tier } from '@/lib/referrals';

/** Support address already published on the site (contact section and client support page). */
export const REFERRAL_SUPPORT_EMAIL = 'info@qurtubatalks.com';

export type PolicyCardId =
  | 'join' | 'code' | 'counts' | 'earn' | 'tiers' | 'reversals' | 'hold' | 'minimum' | 'fraud' | 'self' | 'suspended' | 'tax'
  | 'changes' | 'dispute' | 'contact';

export interface PolicyCard { id: PolicyCardId; title: string; lines: string[] }

export interface PolicyCtx { s: ReferralSettings; tiers: Tier[]; money: (v: number) => string }

/**
 * "Programme policy" cards in simple words. Every number is read from the live settings passed in, so the page, the
 * PDF and the database always agree; nothing here is a rule of its own (the database decides).
 */
export function buildPolicyCards(t: TFunction, c: PolicyCtx): PolicyCard[] {
  const s = c.s;
  const rates = rateRangeText(c.tiers);
  return [
    { id: 'join', title: t('reft.p_join', 'Who can join'), lines: [
      t('reft.p_join_1', 'Verified consultants who passed the AI interview (score at least {{pass}}) and accepted the programme terms.', { pass: s.pass_mark }),
      t('reft.p_join_2', 'Your account must not be suspended and the Consultant Service Policy must be accepted.'),
    ] },
    { id: 'code', title: t('reft.p_code', 'How your code works'), lines: [
      t('reft.p_code_1', 'Share your personal code or link. It is used only when your colleague signs up.'),
      t('reft.p_code_2', 'The first valid code wins and is never overwritten. A link is remembered for 30 days on the device that opened it.'),
      t('reft.p_code_3', 'You can change your code once; old links keep working.'),
    ] },
    { id: 'counts', title: t('reft.p_counts', 'When a referral counts'), lines: [
      t('reft.p_counts_1', 'Your colleague registers with your code and passes the AI interview (at least {{pass}}).', { pass: s.pass_mark }),
      t('reft.p_counts_2', 'You both accept the programme terms within {{days}} days of their sign-up. Otherwise the referral expires.', { days: s.activation_days }),
      t('reft.p_counts_3', 'Only work invoiced after the referral became active earns a reward.'),
    ] },
    { id: 'earn', title: t('reft.p_earn', 'What you earn'), lines: [
      t('reft.p_earn_1', '{{rate}} % (by your tier) of the referred consultant\'s approved fee, for {{months}} months from their first paid ticket.', { rate: rates, months: s.months }),
      t('reft.p_earn_2', 'Fee = approved hours x approved hourly rate. AI Support 360 pays the reward from its own fee; nothing is taken from your colleague or added for the client.'),
    ] },
    { id: 'tiers', title: t('reft.p_tiers', 'Tiers'), lines: [
      ...c.tiers.map((x, i) => t('refr.rate_row', '{{name}}: {{range}} referred consultants - {{rate}} %', { name: x.name, range: tierRangeLabel(c.tiers, i), rate: formatRate(x.rate) })),
      t('reft.p_tiers_1', 'A new tier applies only to rewards created from then on.'),
    ] },
    { id: 'reversals', title: t('reft.p_reversals', 'Refunds and disputes'), lines: [
      t('reft.p_rev_1', 'A refund or chargeback reverses the reward, at the rate it was created with.'),
      t('reft.p_rev_2', 'While a client disputes a payment, the reward is held. It is released if the payment stands.'),
      t('reft.p_rev_3', 'A reversed reward that was already paid is deducted from later rewards.'),
    ] },
    { id: 'hold', title: t('reft.p_hold', 'Hold period and payout timing'), lines: [
      t('reft.p_hold_1', 'A reward is created after the client paid and your colleague\'s payout was released.'),
      t('reft.p_hold_2', 'It stays pending for {{days}} days, then becomes available and is paid with the normal payout run.', { days: s.hold_days ?? 0 }),
      t('reft.p_hold_3', 'After you change your bank details, referral payouts wait {{days}} days.', { days: s.payout_change_hold_days ?? 0 }),
    ] },
    { id: 'minimum', title: t('reft.p_min', 'Minimum payout'), lines: [
      t('reft.p_min_1', 'Paid once at least {{min}} is available in one currency, to your own verified bank details.', { min: c.money(s.min_payout) }),
      t('reft.p_min_2', 'Invoice lines below {{v}} earn no reward.', { v: c.money(s.min_invoice ?? 0) }),
    ] },
    { id: 'fraud', title: t('reft.p_fraud', 'Fraud rules - what gets a referral rejected'), lines: [
      t('refr.rej_1', 'Self-referral or two accounts of one person'),
      t('refr.rej_2', 'A referral loop (A refers B who refers A)'),
      t('refr.rej_3', 'Fake or duplicate accounts'),
      t('refr.rej_4', 'Small or fake tickets for a related or friendly client'),
      t('refr.rej_5', 'A shared bank account, phone or device'),
      t('refr.rej_6', 'A dishonest AI interview'),
      t('reft.p_fraud_1', 'Referrals with signals like these are reviewed first and earn nothing until cleared. Fraud means forfeiture and reversal.'),
    ] },
    { id: 'self', title: t('reft.p_self', 'No self-referral, no duplicate accounts'), lines: [
      t('reft.p_self_1', 'You can not refer yourself with another account, e-mail, phone, device, bank account or company.'),
      t('reft.p_self_2', 'One person, one account. Duplicate accounts are closed and their rewards cancelled.'),
    ] },
    { id: 'suspended', title: t('reft.p_susp', 'If an account is suspended'), lines: [
      t('reft.p_susp_1', 'If your account is suspended, no new rewards are created while it is suspended and existing rewards may be held for review.'),
      t('reft.p_susp_2', 'If your colleague\'s account is suspended, they stop counting for your tier and no rewards come from work they are not paid for.'),
    ] },
    { id: 'tax', title: t('reft.p_tax', 'Tax'), lines: [
      t('refr.rule_5', 'Rewards are a referral incentive, not wages or salary. You are responsible for declaring them for tax.'),
    ] },
    { id: 'changes', title: t('reft.p_changes', 'Changes to the terms'), lines: [
      t('reft.p_changes_1', 'AI Support 360 may change or end the programme for future rewards with notice. A new terms version must be accepted again.'),
    ] },
    { id: 'dispute', title: t('reft.p_dispute', 'How to dispute a referral'), lines: [
      t('reft.p_dispute_1', 'If you think a referral or reward was decided wrongly, write to {{email}} with the name shown here and the line or payout reference (L-…, RP-…).', { email: REFERRAL_SUPPORT_EMAIL }),
      t('reft.p_dispute_2', 'An administrator reviews it and answers you in writing.'),
    ] },
    { id: 'contact', title: t('reft.p_contact', 'Contact'), lines: [
      t('reft.p_contact_1', 'Questions about the programme: {{email}}.', { email: REFERRAL_SUPPORT_EMAIL }),
    ] },
  ];
}
