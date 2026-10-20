import { useState } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import { favouriteErrorKey } from '@/lib/clientFavourites';

/**
 * Feature O heart toggle for a consultant. Hidden until the feature is set up; members who may only read
 * see a filled heart for saved consultants and no button. Never tells the consultant anything.
 */
export default function FavouriteButton({ consultantId, name, className, size = 'md' }: { consultantId: string; name?: string; className?: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const fav = useClientFavourites();
  const [busy, setBusy] = useState(false);
  if (!fav.ready || !consultantId) return null;
  const on = fav.isFavourite(consultantId);
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const box = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const who = name || t('fav.this_consultant');

  if (!fav.canEdit) {
    if (!on) return null;
    return (
      <span className={cn('inline-flex items-center justify-center text-destructive', box, className)} title={t('fav.saved_by_org')}>
        <Heart className={cn(icon, 'fill-current')} aria-hidden="true" />
        <span className="sr-only">{t('fav.saved_by_org')}</span>
      </span>
    );
  }

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!on && fav.blocked.has(consultantId)) {
      toast.info(t('fav.err.fav_blocked'));
      return;
    }
    setBusy(true);
    try {
      if (on) {
        await fav.removeFavourites([consultantId]);
        toast.success(t('fav.removed', { name: who }));
      } else {
        await fav.addFavourite(consultantId);
        toast.success(t('fav.added', { name: who }));
      }
    } catch (err) {
      toast.error(t(`fav.err.${favouriteErrorKey((err as Error).message)}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? t('fav.remove_label', { name: who }) : t('fav.add_label', { name: who })}
      title={on ? t('fav.remove_label', { name: who }) : t('fav.add_label', { name: who })}
      data-testid="favourite-button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:bg-muted hover:text-destructive',
        box, className,
      )}
    >
      {busy ? <Loader2 className={cn(icon, 'animate-spin')} aria-hidden="true" /> : <Heart className={cn(icon, on && 'fill-current')} aria-hidden="true" />}
    </button>
  );
}

/** "Your favourite" chip for recommendation and match lists. */
export function FavouriteChip({ consultantId, className }: { consultantId: string; className?: string }) {
  const { t } = useTranslation();
  const fav = useClientFavourites();
  if (!fav.ready || !fav.isFavourite(consultantId)) return null;
  return (
    <span data-testid="favourite-chip" className={cn('inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive', className)}>
      <Heart className="h-3 w-3 fill-current" aria-hidden="true" />
      {t('fav.your_favourite')}
    </span>
  );
}

/** "Do not suggest" toggle: private to the client; the consultant is never told. */
export function BlockToggle({ consultantId, className }: { consultantId: string; className?: string }) {
  const { t } = useTranslation();
  const fav = useClientFavourites();
  const [busy, setBusy] = useState(false);
  if (!fav.ready || !fav.canEdit || !consultantId) return null;
  const on = fav.blocked.has(consultantId);
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) { await fav.unblock(consultantId); toast.success(t('fav.unblocked')); }
      else { await fav.block(consultantId); toast.success(t('fav.blocked_done')); }
    } catch (err) {
      toast.error(t(`fav.err.${favouriteErrorKey((err as Error).message)}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={on} title={t('fav.blocked_hint')}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground hover:bg-muted', className)}>
      {on ? t('fav.blocked_on') : t('fav.block')}
    </button>
  );
}
