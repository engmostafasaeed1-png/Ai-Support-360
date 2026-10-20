import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { AlertTriangle, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMyLocation } from '@/hooks/useMyLocation';
import { useGuestMode } from '@/contexts/GuestModeContext';
import LocationDialog from './LocationDialog';

/** Persistent dashboard / profile banner until the consultant's country and city are saved; after the grace period it explains the block. */
export default function LocationBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { data, has, isConsultant, grace, save } = useMyLocation();
  const [open, setOpen] = useState(false);
  if (isGuest || !data || !isConsultant || has) return null;
  const blocked = grace.state === 'blocked';
  const message = blocked
    ? t('location.banner_blocked', 'Your location is missing, so you are hidden from search, the map and matching, and cannot place new bids or accept invitations. Add it to continue.')
    : grace.state === 'grace' && grace.deadline
      ? t('location.banner_grace', 'Add your location - needed to appear in search and on the map. Please add it by {{date}}.', { date: format(new Date(grace.deadline), 'd MMM yyyy') })
      : t('location.banner', 'Add your location - needed to appear in search and on the map.');
  return (
    <>
      <div role={blocked ? 'alert' : 'status'} data-testid="location-banner"
        className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${blocked ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10'} ${compact ? 'p-3' : ''}`}>
        {blocked ? <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-destructive" /> : <MapPin aria-hidden="true" className="h-5 w-5 shrink-0 text-warning" />}
        <p className="flex-1 text-sm text-foreground">{message}</p>
        <Button size="sm" className="gradient-primary text-primary-foreground" onClick={() => setOpen(true)}>{t('location.add', 'Add my location')}</Button>
      </div>
      <LocationDialog open={open} onOpenChange={setOpen} initial={{ country: data.country, city: data.city }} onSave={save} />
    </>
  );
}

/** Inline notice for bid and invitation screens after the grace period, with the fix. */
export function LocationBlockedNotice() {
  const { t } = useTranslation();
  const { data, grace, save } = useMyLocation();
  const [open, setOpen] = useState(false);
  if (!data || grace.state !== 'blocked') return null;
  return (
    <>
      <div role="alert" data-testid="location-blocked" className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 text-destructive" />
        <span className="flex-1">{t('location.blocked_action', 'Add your country and city in your profile before placing bids or accepting invitations.')}</span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t('location.add', 'Add my location')}</Button>
      </div>
      <LocationDialog open={open} onOpenChange={setOpen} initial={{ country: data.country, city: data.city }} onSave={save} />
    </>
  );
}

export function useLocationBlocked(): boolean {
  return useMyLocation().grace.state === 'blocked';
}
