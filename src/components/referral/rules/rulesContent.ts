import type { TFunction } from 'i18next';
import { formatRate, MAN_DAY_HOURS, rateRangeText, tierFor, tierRangeLabel, type ReferralSettings, type RulesSection, type Tier } from '@/lib/referrals';

/**
 * One source for the "Programme rules" text (the hub on screen and the PDF): every number comes from the live settings
 * passed in. Administrator notes (plain text, rules_texts) are added per section in the reader's language.
 */
export interface RulesCtx {
  s: ReferralSettings;
  tiers: Tier[];
  tierCount: number;
  lang: 'en' | 'ar';
  money: (v: number) => string;
  date: (iso: string | null | undefined) => string;
  /** Fee of the worked example (one man-day at the consultant's own / platform rate). */
  exampleFee: number;
}

export interface RulesBlock { id: RulesSection; title: string; note: string | null; bullets: string[]; more: string[] }

export function buildRulesContent(t: TFunction, c: RulesCtx): RulesBlock[] {
  const s = c.s;
  const my = tierFor(c.tierCount, c.tiers);
  const note = (id: RulesSection) => s.rules_texts?.[id]?.[c.lang] ?? null;
  const rate = formatRate(my.rate);
  const example = Math.round(c.exampleFee * my.rate) / 100;
  const caps = [
    s.monthly_cap != null ? t('refr.cap_ref', '{{v}} a month for you', { v: c.money(s.monthly_cap) }) : null,
    s.monthly_cap_referred != null ? t('refr.cap_one', '{{v}} a month per referred consultant', { v: c.money(s.monthly_cap_referred) }) : null,
    s.max_per_referred != null ? t('refr.cap_total', '{{v}} in total per referred consultant', { v: c.money(s.max_per_referred) }) : null,
  ].filter(Boolean).join(t('refr.list_sep', ', '));
  return [
    {
      id: 'overview', title: t('refr.s_overview', 'Overview'), note: note('overview'),
      bullets: [
        t('refr.ov_1', 'Refer SAP consultants you know. When they work and the client pays, AI Support 360 pays you {{rate}} % of their fee for {{months}} months.', { rate: rateRangeText(c.tiers), months: s.months }),
        t('refr.ov_2', 'It costs your colleague nothing: the reward comes from the platform\'s own fee, never from their payout or the client\'s price.'),
        t('refr.ov_3', 'The referral becomes active when you both pass the AI interview (score at least {{pass}}) and both accept the terms, within {{days}} days of their sign-up.', { pass: s.pass_mark, days: s.activation_days }),
      ],
      more: [t('refr.ov_more', 'Only work invoiced after the referral became active earns a reward. If the referral is not active in time it expires; only an administrator can revive it.')],
    },
    {
      id: 'prerequisites', title: t('refr.s_prereq', 'Prerequisites'), note: note('prerequisites'),
      bullets: [
        t('refr.pre_1', 'You: profile submitted, AI interview passed (at least {{pass}}), programme terms accepted, verified account and Consultant Service Policy accepted.', { pass: s.pass_mark }),
        t('refr.pre_2', 'Your colleague needs exactly the same: submitted profile, AI interview passed (at least {{pass}}), terms accepted, verified account and accepted policy.', { pass: s.pass_mark }),
        t('refr.pre_3', 'Bank details are needed to be paid, not to share your code.'),
      ],
      more: [t('refr.pre_more', 'The AI interview must be taken honestly, alone and without outside help. If a score is too low you can retake it under the normal interview rules.')],
    },
    {
      id: 'earn', title: t('refr.s_earn', 'How you earn'), note: note('earn'),
      bullets: [
        t('refr.earn_1', 'Reward = your tier rate x the consultant fee. Fee = approved hourly rate x approved hours; 1 man-day = {{h}} hours.', { h: MAN_DAY_HOURS }),
        t('refr.earn_2', 'Example at your rate ({{rate}} %): a fee of {{fee}} gives you {{reward}}.', { rate, fee: c.money(c.exampleFee), reward: c.money(example) }),
        t('refr.earn_3', 'Paid by AI Support 360 - never deducted from your colleague and never added to the client\'s price.'),
        t('refr.earn_4', 'A reward is created only after the client has paid and your colleague\'s payout was released; invoice lines below {{min}} earn nothing.', { min: c.money(s.min_invoice ?? 0) }),
        t('refr.earn_5', '{{months}} months per referred consultant, counted from their first paid ticket.', { months: s.months }),
        t('refr.earn_6', 'Refunds and chargebacks reverse the reward, at the rate it was created with.'),
      ],
      more: [t('refr.earn_more', 'Never on VAT, the platform service fee, payment fees or your own work.')],
    },
    {
      id: 'rates', title: t('refr.s_rates', 'Rates'), note: note('rates'),
      bullets: [
        ...c.tiers.map((x, i) => t('refr.rate_row', '{{name}}: {{range}} referred consultants - {{rate}} %', { name: x.name, range: tierRangeLabel(c.tiers, i), rate: formatRate(x.rate) })),
        s.tier_requires_paid !== false
          ? t('refr.rate_count_paid', 'Counted: referred consultants who are verified, have at least one paid ticket within {{days}} days of verification and are not suspended.', { days: s.tier_paid_days ?? 0 })
          : t('refr.rate_count', 'Counted: referred consultants who are verified and not suspended.'),
        t('refr.rate_future', 'A new tier applies to rewards created from then on - never to earlier rewards.'),
      ],
      more: [t('refr.rate_more', 'If your count goes down (for example a referred consultant is suspended), later rewards use the lower rate.')],
    },
    {
      id: 'payment', title: t('refr.s_payment', 'Payment'), note: note('payment'),
      bullets: [
        t('refr.pay_1', 'Each reward stays pending for {{days}} days after the payout (refunds and chargebacks), then becomes available.', { days: s.hold_days ?? 0 }),
        t('refr.pay_2', 'From {{min}} available in one currency, it is paid with the normal payout run to your own verified bank details.', { min: c.money(s.min_payout) }),
        t('refr.pay_3', 'Rewards keep the currency of the invoice.'),
        t('refr.pay_4', 'After a change of bank details, referral payouts wait {{days}} days.', { days: s.payout_change_hold_days ?? 0 }),
        t('refr.pay_5', 'See them in Earnings and in Referral calculations.'),
      ],
      more: [],
    },
    {
      id: 'rules', title: t('refr.s_rules', 'Rules & fairness'), note: note('rules'),
      bullets: [
        t('refr.rule_1', 'No self-referral: not with another account, e-mail, device, phone, bank account or company of your own.'),
        t('refr.rule_2', 'One referrer per consultant: the first valid code wins and can not be changed.'),
        t('refr.rule_3', 'The AI interview is taken honestly, alone and without outside help.'),
        ...(caps ? [t('refr.rule_caps', 'Rewards above {{caps}} are held for review.', { caps })] : []),
        t('refr.rule_4', 'In case of fraud or suspected fraud rewards may be held, reversed, cancelled or forfeited and the referral removed.'),
        t('refr.rule_5', 'Rewards are a referral incentive, not wages or salary. You are responsible for declaring them for tax.'),
        t('refr.rule_terms', 'Terms version {{v}} of {{date}}.', { v: s.terms_version, date: c.date(s.terms_published_at) }),
      ],
      more: [
        t('refr.rej_1', 'Self-referral or two accounts of one person'),
        t('refr.rej_2', 'A referral loop (A refers B who refers A)'),
        t('refr.rej_3', 'Fake or duplicate accounts'),
        t('refr.rej_4', 'Small or fake tickets for a related or friendly client'),
        t('refr.rej_5', 'A shared bank account, phone or device'),
        t('refr.rej_6', 'A dishonest AI interview'),
      ],
    },
    {
      id: 'simulator', title: t('refr.s_sim', 'Simulator'), note: note('simulator'),
      bullets: [t('refr.sim_intro', 'Try your own numbers. The tier is chosen automatically from the number of referrals. Nothing is saved.')],
      more: [],
    },
  ];
}
