import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSlaSettings, useTicketSla } from '@/hooks/useSla';
import type { ClockRow, ResolvedCalendar } from '@/lib/sla/policy';
import { CHIP, ICON } from '@/components/tracking/trackingStyles';
import { clockChipText, clockView, coverageText, fmtAt, langOf, STATE_COLOR } from './slaUi';

export function SlaClockChip({ clock, calendar, atRiskPct, rule, compact = false }: {
  clock: ClockRow; calendar: ResolvedCalendar; atRiskPct: number; rule?: string; compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const v = clockView(clock, calendar, atRiskPct);
  const color = STATE_COLOR[v.state];
  const text = clockChipText(t, lang, clock, v.state, v.leftMin, calendar.tz);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} data-sla-state={v.state}
          className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', compact ? 'text-[10px]' : 'text-[11px]', CHIP[color])}>
          <Timer className={cn('h-3 w-3', ICON[color])} aria-hidden />
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p>{coverageText(t, calendar)}</p>
        {clock.due_at && !clock.met_at && <p>{t('sla.chip.due', { at: fmtAt(clock.due_at, calendar.tz, lang) })}</p>}
        {clock.met_at && <p>{t('sla.chip.metAt', { at: fmtAt(clock.met_at, calendar.tz, lang) })}</p>}
        {rule && <p className="text-muted-foreground">{rule}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Ticket header: one chip per clock ("Response: 1 h 12 m left", "Resolution: Met"). Nothing while off or without a snapshot. */
export function SlaHeaderChips({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const { data } = useTicketSla(ticketId);
  const settings = useSlaSettings().data;
  if (!data?.snapshot || !data.clocks?.length) return null;
  const s = data.snapshot;
  const rule = t('sla.chip.rule', { name: s.policy_name, version: s.version, severity: s.severity, start: t(`sla.start.${s.data.clock.start}`) });
  return (
    <>
      {data.clocks.filter((c) => c.kind !== 'workaround' || !c.met_at).map((c) => (
        <SlaClockChip key={c.kind} clock={c} calendar={s.data.calendar} atRiskPct={settings?.at_risk_pct ?? 75} rule={rule} />
      ))}
    </>
  );
}
