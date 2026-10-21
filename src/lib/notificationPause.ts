// Feature Q display helpers. Rules live in the shared module (mirrored by the database gate).
export {
  PAUSE_DAYS, PAUSE_DURATIONS, PAUSABLE, allowedDurations, clampMaxDays, isPauseActive, isPausedFor, notificationCategory,
  pauseEndsAt, popupHeldByPause, type PauseDuration, type PauseCategory, type PauseState,
} from '../../supabase/functions/_shared/notificationPause';

/** "Fri 24 Oct, 09:40" (EN) or the Arabic equivalent, in the reader's own time zone. */
export function formatPauseEnd(iso: string | Date, lang: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** In-app rows that arrived while the user chose to hold notices stay out of the bell until the pause ends. */
export function isHeldNow(n: { held_until?: string | null }, now: number): boolean {
  if (!n.held_until) return false;
  const t = Date.parse(n.held_until);
  return Number.isFinite(t) && t > now;
}
