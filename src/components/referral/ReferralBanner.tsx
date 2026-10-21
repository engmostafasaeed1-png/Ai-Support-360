import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { useMyReferralInvite, useMyReferralList, usePublicReferralSettings } from '@/hooks/useReferralProgram';
import { ChipBadge, useNextStepText } from '@/components/referral/ReferralActivation';
import { formatRate } from '@/lib/referrals';
import { cn } from '@/lib/utils';

/** One honest line with the real rate and months from the settings. Hidden until the programme is live. */
export default function ReferralBanner({ variant }: { variant: 'dashboard' | 'landing' }) {
  const { t } = useTranslation();
  const { available, settings } = usePublicReferralSettings();
  if (!available || !settings.enabled) return null;
  const text = t('refz.banner', 'Refer and earn: {{rate}} % of the fees of every consultant you bring, for {{months}} months - paid by AI Support 360, never deducted from them.', {
    rate: formatRate(settings.rate_percent), months: settings.months,
  });
  if (variant === 'landing') {
    return (
      <p className="mt-3 inline-flex max-w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{text}</span>
      </p>
    );
  }
  return <DashboardReferral text={text} passMark={settings.pass_mark} />;
}

/** Dashboard: the one-line offer plus a status chip and the exact next step for each referral. */
function DashboardReferral({ text, passMark }: { text: string; passMark: number }) {
  const { t } = useTranslation();
  const invite = useMyReferralInvite();
  const list = useMyReferralList(true);
  const next = useNextStepText();
  const rows = (list.data ?? []).filter((r) => r.activation_status !== 'active' || r.chip === 'under_review').slice(0, 3);
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm space-y-2">
      <div className={cn('flex flex-wrap items-center gap-2')}>
        <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-foreground">{text}</span>
        <Link to="/consultant/referrals" className="font-medium text-primary underline-offset-2 hover:underline">{t('refz.banner_open', 'Open Refer & earn')}</Link>
      </div>
      {invite.data && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <ChipBadge chip={invite.data.chip} />
          <span className="text-muted-foreground">{t('refz.invited_by_short', 'Invited by {{name}}', { name: invite.data.referrer_name })}
            {invite.data.activation_status === 'pending' && <> - {next(invite.data.my_next, invite.data.referrer_name, passMark)}</>}</span>
        </div>
      )}
      {rows.map((r, i) => (
        <div key={`${r.referred_name}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
          <ChipBadge chip={r.chip} />
          <span className="text-muted-foreground" dir="auto">{r.referred_name}
            {r.activation_status === 'pending' && <> - {r.chip === 'waiting_you' ? next(r.my_next, r.referred_name, passMark) : next(r.their_next, r.referred_name, passMark)}</>}</span>
        </div>
      ))}
    </div>
  );
}
