import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleSlash, FileClock, PencilLine, ShieldOff, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stateTone, type RoundState } from '@/lib/brdApproval';
import { useBrdApproval } from '@/hooks/useBrdApproval';

const TONE: Record<ReturnType<typeof stateTone>, string> = {
  success: 'border-success/40 bg-success/10 text-foreground',
  warning: 'border-warning/50 bg-warning/10 text-foreground',
  destructive: 'border-destructive/40 bg-destructive/10 text-foreground',
  info: 'border-info/40 bg-info/10 text-foreground',
  muted: 'border-border bg-muted/50 text-muted-foreground',
};
const ICON_TONE: Record<ReturnType<typeof stateTone>, string> = {
  success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', info: 'text-info', muted: 'text-muted-foreground',
};
const ICONS: Record<RoundState, typeof CheckCircle2> = {
  not_requested: FileClock, pending: FileClock, approved: CheckCircle2, changes_requested: PencilLine,
  rejected: XCircle, superseded: CircleSlash, withdrawn: ShieldOff,
};

/** Coloured BRD approval state ("Approved by consultant", "Pending consultant approval", ...). */
export function BrdApprovalChip({ state, version, className, prefix = true }: { state: RoundState; version?: number | null; className?: string; prefix?: boolean }) {
  const { t } = useTranslation();
  const tone = stateTone(state);
  const Icon = ICONS[state] ?? FileClock;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE[tone], className)}
      data-testid="brd-approval-chip" data-state={state}>
      <Icon className={cn('h-3 w-3', ICON_TONE[tone])} aria-hidden />
      {prefix && version ? <span className="text-muted-foreground">BRD v{version}:</span> : null}
      {t(`brd.approval.state.${state}`)}
    </span>
  );
}

/** Header chip on the ticket page: newest round + a "Waiting for BRD approval" blocker when the gate blocks. */
export function BrdApprovalHeaderChip({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation();
  const { data } = useBrdApproval(ticketId);
  const g = data?.gate;
  if (!data?.role || !g || g.mode === 'off' || g.state === 'not_requested') return null;
  return (
    <>
      <BrdApprovalChip state={g.state} version={g.version} />
      {g.blocks && (
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-foreground" role="status">
          <FileClock className="h-3 w-3 text-warning" aria-hidden /> {t('brd.approval.blocker')}
        </span>
      )}
      {g.waived && <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{t('brd.approval.waivedChip')}</span>}
    </>
  );
}
