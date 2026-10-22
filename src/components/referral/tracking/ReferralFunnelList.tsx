import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useNextStepText } from '@/components/referral/ReferralActivation';
import type { MyReferral } from '@/hooks/useReferralProgram';
import type { TrackingInfo } from '@/hooks/useReferralTracking';
import { FUNNEL_TONE, funnelChip, type FunnelChip } from '@/lib/referralTracking';
import { cn } from '@/lib/utils';

const CHIP_TEXT: Record<FunnelChip, string> = {
  registered: 'Registered', interview_pending: 'Interview pending', active: 'Active', earning: 'Earning', ended: 'Window ended',
  on_review: 'Under review', expired: 'Expired', rejected: 'Rejected',
};

export function FunnelChipBadge({ chip }: { chip: FunnelChip }) {
  const { t } = useTranslation();
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', FUNNEL_TONE[chip])}>{t(`reft.chip_${chip}`, CHIP_TEXT[chip])}</span>;
}

interface Props {
  referrals: MyReferral[];
  rejected: TrackingInfo['rejected'];
  loading: boolean;
  passMark: number;
  date: (iso: string | null | undefined) => string;
  money: (v: number, cur?: string) => string;
}

/** One card per referred consultant (masked name only, Feature X) with a plain status and the next step. */
export default function ReferralFunnelList({ referrals, rejected, loading, passMark, date, money }: Props) {
  const { t } = useTranslation();
  const nextText = useNextStepText();
  const reason = (r: string) => r === 'account_closed'
    ? t('reft.rej_account', 'The account was closed or suspended.')
    : r === 'review_failed'
      ? t('reft.rej_review', 'It did not pass our fraud review (see "Fraud rules" in the programme policy).')
      : t('reft.rej_rules', 'It did not meet the programme rules.');

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" aria-hidden="true" />{t('refz.list', 'Consultants you referred')}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {loading ? <Skeleton className="h-20 w-full rounded-xl" />
          : referrals.length === 0 && rejected.length === 0 ? (
            <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
              {t('reft.list_empty', 'No one has signed up with your code yet. Share it from the Overview tab - colleagues appear here as soon as they register.')}
            </p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {referrals.map((r, i) => {
                const chip = funnelChip(r);
                const earned = Object.entries(r.earned ?? {});
                return (
                  <li key={`${r.referred_name}-${r.attributed_at}-${i}`} className="space-y-1.5 rounded-xl border border-border/60 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium" dir="auto">{r.referred_name}</span>
                      <FunnelChipBadge chip={chip} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('reft.signed_up_on', 'Registered {{date}}', { date: date(r.attributed_at) })}
                      {r.window_ends_at ? ` · ${t('reft.window_until', 'Rewards until {{date}}', { date: date(r.window_ends_at) })}` : ''}
                    </p>
                    {r.activation_status === 'pending' && (
                      <p className="text-xs">
                        {r.chip === 'waiting_you'
                          ? <><span className="font-medium">{t('refz.your_next', 'Your next step:')}</span> {nextText(r.my_next, r.referred_name, passMark)}</>
                          : <><span className="font-medium">{t('refz.their_next', 'Their next step:')}</span> {nextText(r.their_next, r.referred_name, passMark)}</>}
                        {r.activation_expires_at && <span className="text-muted-foreground"> · {t('refz.deadline', 'Deadline: {{date}}', { date: date(r.activation_expires_at) })}</span>}
                      </p>
                    )}
                    {chip === 'expired' && <p className="text-xs text-muted-foreground">{t('reft.expired_hint', 'Not activated in time. Only an administrator can revive it.')}</p>}
                    {chip === 'on_review' && <p className="text-xs text-muted-foreground">{t('reft.review_hint', 'Our team is reviewing this referral. Nothing is paid until it is cleared.')}</p>}
                    {earned.length > 0 && (
                      <p className="text-xs">{t('refz.c_earned', 'Earned')}: <span className="font-semibold tabular-nums">{earned.map(([c, v]) => money(Number(v), c)).join(' · ')}</span></p>
                    )}
                  </li>
                );
              })}
              {rejected.map((r, i) => (
                <li key={`rej-${r.referred_name}-${r.attributed_at}-${i}`} className="space-y-1.5 rounded-xl border border-destructive/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium" dir="auto">{r.referred_name}</span>
                    <FunnelChipBadge chip="rejected" />
                  </div>
                  <p className="text-xs text-muted-foreground">{t('reft.rejected_on', 'Registered {{a}} · decided {{b}}', { a: date(r.attributed_at), b: date(r.decided_at) })}</p>
                  <p className="text-xs">{reason(r.reason)}</p>
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}
