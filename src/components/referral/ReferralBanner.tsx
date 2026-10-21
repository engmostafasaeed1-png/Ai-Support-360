import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { usePublicReferralSettings } from '@/hooks/useReferralProgram';
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
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm')}>
      <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1 min-w-0 text-foreground">{text}</span>
      <Link to="/consultant/referrals" className="font-medium text-primary underline-offset-2 hover:underline">{t('refz.banner_open', 'Open Refer & earn')}</Link>
    </div>
  );
}
