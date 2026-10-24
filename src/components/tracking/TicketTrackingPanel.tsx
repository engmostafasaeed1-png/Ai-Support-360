import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, History, ListChecks, Pencil, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useSetWorkingStatus, useTicketTracking } from '@/hooks/useTicketTracking';
import { statusLabel } from '@/lib/ticketTracking';
import { toast } from 'sonner';
import StageStepper from './StageStepper';
import { StageChip, WorkingStatusChip } from './TrackingChips';
import WorkingStatusDialog from './WorkingStatusDialog';
import StatusHistoryBar from './StatusHistoryBar';
import TrackingTimeline from './TrackingTimeline';

/** Header chips: automatic stage + manual working status ("set by the consultant 2 h ago"). Nothing while off. */
export function TrackingHeaderChips({ ticketId }: { ticketId: string }) {
  const { visible, derived, state, settings } = useTicketTracking(ticketId);
  if (!visible || !derived) return null;
  return (
    <>
      <StageChip derived={derived} />
      <WorkingStatusChip working={state?.facts?.working} settings={settings} withMeta />
    </>
  );
}

/** Two-layer tracking of one ticket: stepper (automatic), working status (manual), durations and the timeline. */
export default function TicketTrackingPanel({ ticketId, ticketTitle, fallback = null }: { ticketId: string; ticketTitle: string; fallback?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { visible, derived, state, settings } = useTicketTracking(ticketId);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const quick = useSetWorkingStatus(ticketId);
  if (!visible || !derived || !state?.facts || !state.role) return <>{fallback}</>;
  const facts = state.facts;
  const working = facts.working ?? null;
  const allowed = state.allowed ?? [];
  const role = state.role;
  const closed = facts.status === 'closed';
  const askConfirm = role === 'client' && working?.key === 'completed' && working.set_by_role === 'consultant' && !closed;

  const openWith = (k: string | null) => { setPreset(k); setOpen(true); };
  const confirmDone = async () => {
    try {
      await quick.mutateAsync({ status: 'completed', note: t('tracking.confirm.note'), expectedDate: null, responsible: null, version: working?.version ?? null });
      toast.success(t('tracking.confirm.thanks'));
    } catch (e) {
      toast.error((e as Error).message || t('tracking.err.generic'));
    }
  };

  return (
    <Card className="rounded-2xl border-border/50" data-testid="ticket-tracking">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden /> {t('tracking.title')}
          {!state.enabled && <Badge variant="outline" className="text-[10px]">{t('tracking.adminPreview')}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('tracking.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <section aria-labelledby="tt-auto">
          <h3 id="tt-auto" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('tracking.autoTitle')}</h3>
          <StageStepper derived={derived} role={role} />
        </section>

        <section aria-labelledby="tt-manual" className="space-y-2">
          <h3 id="tt-manual" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('tracking.manualTitle')}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <WorkingStatusChip working={working} settings={settings} withMeta />
            {allowed.length > 0 && (!closed || role === 'admin') && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => openWith(null)}>
                <Pencil className="h-3 w-3" /> {t('tracking.change')}
              </Button>
            )}
          </div>
          {working?.note && working.set_by_role !== 'system' && <p className="whitespace-pre-wrap rounded-xl bg-muted/50 px-3 py-2 text-xs text-foreground">{working.note}</p>}
          {working?.expected_date && (
            <p className="text-xs text-muted-foreground">
              {t('tracking.expectedBy', { date: working.expected_date })}
              {working.responsible && <> · {t('tracking.ev.responsible', { who: t(`tracking.resp.${working.responsible}`) })}</>}
            </p>
          )}
          {role === 'observer' && <p className="text-xs text-muted-foreground">{t('tracking.observerNote')}</p>}
          <p className="text-[11px] text-muted-foreground">{t('tracking.officialNote')}</p>
        </section>

        {facts.brd_approval?.blocks && !closed && (
          <div className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-xs" role="status">
            <p className="font-medium text-foreground">{t('brd.approval.blocker')}</p>
            {facts.brd_approval.state === 'pending' && working?.key !== 'waiting_consultant' && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                {t('brd.approval.suggestWorking', { status: statusLabel(settings, 'waiting_consultant', i18n.language?.startsWith('ar') ? 'ar' : 'en') })}
                {allowed.includes('waiting_consultant') && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openWith('waiting_consultant')}>{t('brd.approval.useSuggestion')}</Button>
                )}
              </p>
            )}
          </div>
        )}

        {askConfirm && (
          <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-sm" role="status">
            <p className="font-medium text-foreground">{t('tracking.confirm.title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('tracking.confirm.body')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {allowed.includes('completed') && (
                <Button size="sm" className="h-8 gap-1 text-xs" onClick={confirmDone} disabled={quick.isPending}><CheckCircle2 className="h-3.5 w-3.5" /> {t('tracking.confirm.yes')}</Button>
              )}
              {allowed.includes('needs_rework') && (
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => openWith('needs_rework')}><RotateCcw className="h-3.5 w-3.5" /> {t('tracking.confirm.rework')}</Button>
              )}
            </div>
          </div>
        )}

        <StatusHistoryBar events={state.events ?? []} settings={settings} derived={derived} closedAt={closed ? facts.closed_at : null} />

        <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs"><History className="h-3.5 w-3.5" /> {timelineOpen ? t('tracking.timeline.hide') : t('tracking.timeline.show')}</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {timelineOpen && <TrackingTimeline ticketId={ticketId} ticketTitle={ticketTitle} settings={settings} />}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
      {role !== 'observer' && (
        <WorkingStatusDialog open={open} onOpenChange={setOpen} ticketId={ticketId} ticketStatus={facts.status} role={role}
          allowed={allowed} settings={settings} current={working} preset={preset} />
      )}
    </Card>
  );
}
