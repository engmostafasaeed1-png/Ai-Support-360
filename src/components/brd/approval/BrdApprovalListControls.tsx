import { useTranslation } from 'react-i18next';
import { FileClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ApprovalListRow } from '@/lib/brdApproval';
import { BrdApprovalChip } from './BrdApprovalChip';

/** List toggle: consultants "Needs my approval", clients "Awaiting consultant approval" (with count). Hidden when 0 and off. */
export function BrdApprovalFilterButton({ rows, kind, active, onToggle }: {
  rows: ReadonlyMap<string, ApprovalListRow>; kind: 'needs_me' | 'waiting_consultant'; active: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation();
  let n = 0;
  for (const r of rows.values()) if (r[kind]) n++;
  if (n === 0 && !active) return null;
  return (
    <Button size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} onClick={onToggle}
      className={cn('h-8 gap-1.5 rounded-full text-xs', active && 'gradient-primary border-0')} data-testid={`brd-filter-${kind}`}>
      <FileClock className="h-3.5 w-3.5" /> {t(kind === 'needs_me' ? 'brd.approval.list.needsMe' : 'brd.approval.list.waiting')}
      <span className="rounded-full bg-background/80 px-1.5 text-[10px] font-semibold text-foreground">{n}</span>
    </Button>
  );
}

/** Small row chip in ticket lists. */
export function BrdApprovalRowChip({ row }: { row: ApprovalListRow | undefined }) {
  const { t } = useTranslation();
  if (!row || row.state === 'not_requested' || row.state === 'superseded') return null;
  return (
    <>
      <BrdApprovalChip state={row.state} version={row.version} />
      {row.needs_me && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('brd.approval.list.yourTurn')}</span>}
    </>
  );
}
