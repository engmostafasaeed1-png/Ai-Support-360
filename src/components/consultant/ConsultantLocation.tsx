import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { locationDisplay, type LocationAudience } from '@/lib/consultantLocation';
import { cn } from '@/lib/utils';

interface Props {
  city?: string | null;
  country?: string | null;
  /** client: nothing at all when unset. owner / admin: a "Location not set" badge when unset. */
  audience: LocationAudience;
  className?: string;
  icon?: boolean;
}

/** One location line for consultant cards and profiles: "City, Country", else country (or city) only. */
export default function ConsultantLocation({ city, country, audience, className, icon = true }: Props) {
  const { t } = useTranslation();
  const shown = locationDisplay(city, country, audience);
  if (!shown) return null;
  if (shown.unset) {
    return (
      <span data-testid="location-not-set" className={cn('inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-foreground', className)}>
        {icon && <MapPin aria-hidden="true" className="h-3 w-3 shrink-0 text-warning" />}
        {t('profileRules.locationNotSet', 'Location not set')}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      {icon && <MapPin aria-hidden="true" className="h-3 w-3 shrink-0" />}
      <span className="truncate">{shown.text}</span>
    </span>
  );
}
