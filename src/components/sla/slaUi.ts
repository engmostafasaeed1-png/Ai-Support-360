import type { TFunction } from 'i18next';
import { clockState, formatMinutes, isValidTimeZone, type ClockRow, type ClockState, type ResolvedCalendar } from '@/lib/sla/policy';
import type { TtColor } from '@/lib/ticketTracking';

export type Lang = 'en' | 'ar';
export const langOf = (l: string | undefined): Lang => (l?.startsWith('ar') ? 'ar' : 'en');

/** Colour by risk: green on track / met, amber at risk / met late, red breached, grey paused or not started. */
export const STATE_COLOR: Record<ClockState, TtColor> = {
  not_started: 'muted', on_track: 'success', at_risk: 'warning', paused: 'muted', outside_hours: 'info', breached: 'destructive', met: 'success', met_late: 'warning',
};

export function clockView(c: ClockRow, cal: ResolvedCalendar, atRiskPct: number, now = Date.now()) {
  return clockState(c, now, cal, atRiskPct);
}

export function fmtAt(iso: string | number | null | undefined, tz: string | null | undefined, lang: Lang, withDay = true): string {
  if (iso === null || iso === undefined) return '—';
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const zone = isValidTimeZone(tz) ? tz : undefined;
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en-GB', {
    timeZone: zone, ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const dayLabel = (t: TFunction, d: number) => t(`sla.day.${DAY_KEYS[d]}`);

export function coverageText(t: TFunction, cal: Pick<ResolvedCalendar, 'mode' | 'days' | 'start' | 'end' | 'tz'>): string {
  if (cal.mode === '24x7') return t('sla.coverage.always');
  const days = [...cal.days].sort().map((d) => dayLabel(t, d)).join(', ');
  return t('sla.coverage.businessLine', { days, start: cal.start, end: cal.end, tz: cal.tz ?? t('sla.coverage.companyTz') });
}

/** "Response: 1 h 12 m left" / "Met" / "Breached" / "Paused: waiting for client information since 10:15". */
export function clockChipText(t: TFunction, lang: Lang, c: ClockRow, state: ClockState, leftMin: number, tz: string): string {
  const name = t(`sla.clock.${c.kind}`);
  switch (state) {
    case 'met': return `${name}: ${t('sla.state.met')}`;
    case 'met_late': return `${name}: ${t('sla.state.met_late')}`;
    case 'breached': return `${name}: ${t('sla.state.breached')}`;
    case 'not_started': return `${name}: ${t('sla.state.not_started')}`;
    case 'paused': return `${name}: ${t('sla.state.pausedSince', { reason: t(`sla.pause.${c.pause_reason ?? 'other'}`), at: fmtAt(c.paused_since, tz, lang, false) })}`;
    case 'outside_hours': return `${name}: ${t('sla.state.left', { left: formatMinutes(leftMin, lang) })} · ${t('sla.state.outside_hours')}`;
    default: return `${name}: ${t('sla.state.left', { left: formatMinutes(leftMin, lang) })}`;
  }
}

/** Short translated message for a database error code. */
export function slaErrorText(t: TFunction, e: unknown): string {
  const code = (e as { code?: string })?.code ?? 'generic';
  return t(`sla.err.${code}`, { defaultValue: t('sla.err.generic') });
}
