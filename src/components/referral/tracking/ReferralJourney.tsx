import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, ClipboardCheck, Coins, Share2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ReferralOverview, MyReferral } from '@/hooks/useReferralProgram';
import { journeyCounts, nextAction, type NextAction } from '@/lib/referralTracking';
import { cn } from '@/lib/utils';
import { REFERRAL_SUPPORT_EMAIL } from './policyContent';

export type ReferTab = 'overview' | 'programme' | 'referrals' | 'earnings' | 'calculations';

interface Props {
  ov: ReferralOverview;
  referrals: MyReferral[];
  num: (v: number) => string;
  onTab: (tab: ReferTab) => void;
  onShare: () => void;
}

/** 5-step journey with the consultant's OWN counts and one clear "what to do next" button. */
export default function ReferralJourney({ ov, referrals, num, onTab, onShare }: Props) {
  const { t } = useTranslation();
  const lifetime = ov.earnings.reduce((n, e) => n + e.lifetime, 0);
  const available = ov.earnings.reduce((n, e) => n + e.available + e.in_payout, 0);
  const c = journeyCounts(ov.funnel, referrals, lifetime);
  const pending = referrals.filter((r) => r.activation_status === 'pending').length;
  const action = nextAction({
    suspended: ov.eligibility.suspended, profileSubmitted: ov.eligibility.profile_submitted, interviewPassed: ov.activation.interview_passed,
    acknowledged: ov.activation.acknowledged, policy: ov.eligibility.policy, verified: ov.eligibility.verified, signups: c.registered,
    pendingReferrals: pending, available, payoutDetails: ov.eligibility.payout_details,
  });

  const steps = [
    { id: 'share', Icon: Share2, label: t('reft.j_share', 'Share your code'), n: c.shared, unit: t('reft.j_share_n', 'link visits') },
    { id: 'register', Icon: UserPlus, label: t('reft.j_register', 'Colleague registers'), n: c.registered, unit: t('reft.j_register_n', 'registered') },
    { id: 'interview', Icon: BadgeCheck, label: t('reft.j_interview', 'AI interview passed'), n: c.interviewed, unit: t('reft.j_interview_n', 'interviewed') },
    { id: 'paid', Icon: ClipboardCheck, label: t('reft.j_paid', 'First paid ticket'), n: c.paying, unit: t('reft.j_paid_n', 'paid tickets started') },
    { id: 'earn', Icon: Coins, label: t('reft.j_earn', 'You earn'), n: c.earning, unit: t('reft.j_earn_n', 'earning') },
  ];
  const current = steps.findIndex((s) => s.n === 0);

  const label: Record<NextAction, string> = {
    support: t('reft.na_support', 'Contact support about your account'),
    profile: t('reft.na_profile', 'Complete and submit your profile'),
    interview: t('reft.na_interview', 'Start the AI interview'),
    terms: t('reft.na_terms', 'Accept the programme terms'),
    policy: t('reft.na_policy', 'Accept the Consultant Service Policy'),
    wait_verify: t('reft.na_verify', 'Check your verification status'),
    share: t('reft.na_share', 'Share your code with a colleague'),
    follow_up: t('reft.na_follow', 'See what your colleagues still need to do'),
    payout: t('reft.na_payout', 'Add your bank details to get paid'),
    earnings: t('reft.na_earnings', 'See your available rewards'),
  };
  const hint: Partial<Record<NextAction, string>> = {
    wait_verify: t('reft.na_verify_hint', 'Our team verifies your profile; sharing opens as soon as it is done.'),
    follow_up: t('reft.na_follow_hint', '{{n}} referral(s) are waiting for the AI interview or the terms.', { n: pending }),
  };

  const btn = (() => {
    const L = (to: string) => <Button asChild className="rounded-xl"><Link to={to}>{label[action]}<ArrowRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden="true" /></Link></Button>;
    switch (action) {
      case 'support': return <Button asChild className="rounded-xl"><a href={`mailto:${REFERRAL_SUPPORT_EMAIL}`}>{label[action]}</a></Button>;
      case 'profile': return L('/consultant/profile');
      case 'interview': return L('/consultant/interviews?start=1');
      case 'policy': return L('/consultant-policy');
      case 'wait_verify': return L('/consultant/verification');
      case 'payout': return L('/consultant/earnings');
      case 'terms': return <Button className="rounded-xl" onClick={() => onTab('programme')}>{label[action]}</Button>;
      case 'follow_up': return <Button className="rounded-xl" onClick={() => onTab('referrals')}>{label[action]}</Button>;
      case 'earnings': return <Button className="rounded-xl" onClick={() => onTab('earnings')}>{label[action]}</Button>;
      default: return <Button className="rounded-xl" onClick={onShare}><Share2 className="me-1 h-4 w-4" aria-hidden="true" />{label[action]}</Button>;
    }
  })();

  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <h2 className="text-base font-semibold">{t('reft.journey_title', 'Your referral journey')}</h2>
        <ol className="grid gap-2 sm:grid-cols-5" aria-label={t('reft.journey_title', 'Your referral journey')}>
          {steps.map((s, i) => {
            const done = s.n > 0;
            const isCurrent = i === current;
            return (
              <li key={s.id} aria-current={isCurrent ? 'step' : undefined}
                className={cn('flex items-center gap-3 rounded-xl border p-3 sm:flex-col sm:text-center',
                  done ? 'border-success/40 bg-success/10' : isCurrent ? 'border-primary bg-primary/5' : 'border-border/60')}>
                <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  done ? 'bg-success text-success-foreground' : isCurrent ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                  <s.Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 text-xs">
                  <span className="block font-medium text-foreground">{i + 1}. {s.label}</span>
                  <span className="block text-lg font-bold tabular-nums text-foreground">{num(s.n)}</span>
                  <span className="block text-muted-foreground">{s.unit}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('reft.next', 'Your next step')}</p>
            {hint[action] && <p className="text-sm text-muted-foreground">{hint[action]}</p>}
          </div>
          {btn}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('reft.journey_note', 'Link visits are counted without storing anything about the visitor. Invitations are not tracked per person.')}</p>
      </CardContent>
    </Card>
  );
}
