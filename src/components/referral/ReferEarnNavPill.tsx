import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useReferNav } from '@/hooks/useReferralTracking';
import { cn } from '@/lib/utils';

/**
 * "Refer & earn" in the consultant header tabs: gradient pill with a gift icon and an "Earn" badge. A soft pulse ring
 * (outside the layout, motion-safe only) shows for the first 14 days or until the page is opened once; a dot shows new
 * rewards or referrals still waiting.
 */
export default function ReferEarnNavPill() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const nav = useReferNav(!isGuest);
  const label = t('sidebar.refer_earn', 'Refer & earn');
  const flag = nav.dot || nav.count > 0;
  return (
    <NavLink
      to="/consultant/referrals"
      data-tour="nav-referrals-top"
      aria-label={flag ? `${label} (${t('sidebar.new_activity', 'new activity')})` : label}
      className="relative ms-1 flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-refer px-3 py-1.5 text-xs font-semibold text-refer-foreground shadow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      activeClassName="ring-2 ring-refer-from/40 ring-offset-1 ring-offset-background"
    >
      {nav.pulse && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full bg-refer-from/40 motion-safe:animate-ping motion-reduce:hidden" />
      )}
      <Gift className="relative h-3.5 w-3.5" aria-hidden="true" />
      <span className="relative">{label}</span>
      <span className="relative rounded-full bg-refer-foreground/20 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide">
        {t('sidebar.earn_badge', 'Earn')}
      </span>
      {flag && (
        <span aria-hidden="true" className={cn('absolute -top-0.5 end-0 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-background')} />
      )}
    </NavLink>
  );
}
