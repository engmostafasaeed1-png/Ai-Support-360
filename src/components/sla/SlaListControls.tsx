import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownWideNarrow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSlaEnabled, useSlaListStates, useSlaSettings } from '@/hooks/useSla';
import type { ListState } from '@/lib/sla/api';
import type { ClockState } from '@/lib/sla/policy';
import { SlaClockChip } from './SlaChips';
import { clockView } from './slaUi';

export type SlaFilter = 'all' | 'at_risk' | 'breached' | 'paused';
const RANK: Record<ClockState, number> = { breached: 0, at_risk: 1, on_track: 2, outside_hours: 3, paused: 4, not_started: 5, met_late: 6, met: 7 };

/** Worst open clock of a ticket (the one shown in lists) and its minutes left. */
export function slaRowSummary(s: ListState | undefined, atRiskPct: number, now = Date.now()) {
  if (!s?.clocks?.length) return null;
  const views = s.clocks.map((c) => ({ c, v: clockView(c, s.calendar, atRiskPct, now) }));
  views.sort((a, b) => RANK[a.v.state] - RANK[b.v.state] || a.v.leftMin - b.v.leftMin);
  const open = views.filter((x) => x.v.state !== 'met' && x.v.state !== 'met_late');
  const worst = open[0] ?? views[views.length - 1];
  return { clock: worst.c, state: worst.v.state, leftMin: open[0] ? worst.v.leftMin : Number.POSITIVE_INFINITY, anyPaused: views.some((x) => x.v.state === 'paused') };
}

/** SLA column for ticket lists: data, filter "at risk / breached / paused", sort by time left. Inert while off. */
export function useSlaList<T extends { id: string }>(rows: T[]) {
  const on = useSlaEnabled();
  const atRisk = useSlaSettings().data?.at_risk_pct ?? 75;
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const { data } = useSlaListStates(ids);
  const map = useMemo(() => new Map((data ?? []).map((s) => [s.ticket_id, s])), [data]);
  const [filter, setFilter] = useState<SlaFilter>('all');
  const [sortByLeft, setSortByLeft] = useState(false);
  const apply = (list: T[]) => {
    if (!on) return list;
    const now = Date.now();
    let out = list;
    if (filter !== 'all') {
      out = out.filter((r) => {
        const s = slaRowSummary(map.get(r.id), atRisk, now);
        if (!s) return false;
        if (filter === 'paused') return s.anyPaused;
        if (filter === 'breached') return s.state === 'breached';
        return s.state === 'at_risk' || s.state === 'breached';
      });
    }
    if (sortByLeft) {
      out = [...out].sort((a, b) => (slaRowSummary(map.get(a.id), atRisk, now)?.leftMin ?? Infinity) - (slaRowSummary(map.get(b.id), atRisk, now)?.leftMin ?? Infinity));
    }
    return out;
  };
  return { on, map, atRisk, filter, setFilter, sortByLeft, setSortByLeft, apply };
}

export function SlaFilterBar({ ctl }: { ctl: Pick<ReturnType<typeof useSlaList>, 'on' | 'filter' | 'setFilter' | 'sortByLeft' | 'setSortByLeft'> }) {
  const { t } = useTranslation();
  if (!ctl.on) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('sla.list.label')}>
      <span className="text-xs text-muted-foreground">{t('sla.list.label')}:</span>
      {(['all', 'at_risk', 'breached', 'paused'] as const).map((f) => (
        <Button key={f} size="sm" variant={ctl.filter === f ? 'default' : 'outline'} className="h-7 rounded-full text-xs" aria-pressed={ctl.filter === f} onClick={() => ctl.setFilter(f)}>{t(`sla.list.${f}`)}</Button>
      ))}
      <Button size="sm" variant={ctl.sortByLeft ? 'default' : 'ghost'} className="h-7 gap-1 text-xs" aria-pressed={ctl.sortByLeft} onClick={() => ctl.setSortByLeft(!ctl.sortByLeft)}>
        <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden /> {t('sla.list.sort')}
      </Button>
    </div>
  );
}

export function SlaRowChip({ state, atRiskPct }: { state: ListState | undefined; atRiskPct: number }) {
  const s = slaRowSummary(state, atRiskPct);
  if (!s || !state) return null;
  return <SlaClockChip clock={s.clock} calendar={state.calendar} atRiskPct={atRiskPct} compact />;
}
