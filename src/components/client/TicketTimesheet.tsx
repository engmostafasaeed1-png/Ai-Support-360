import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Lock, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import TimesheetRateCard from '@/components/timesheet/TimesheetRateCard';
import TimesheetSummary, { type PlanInfo } from '@/components/timesheet/TimesheetSummary';
import TimesheetSubmissions from '@/components/timesheet/TimesheetSubmissions';
import WorkLogDialog from '@/components/timesheet/WorkLogDialog';
import SubmitTimesheetDialog from '@/components/timesheet/SubmitTimesheetDialog';
import StatusBadge from '@/components/timesheet/StatusBadge';
import { usePricingTerms } from '@/hooks/usePricingTerms';
import { buildCsv, downloadText, type ExportRow } from '@/lib/timesheetExport';
import { downloadTimesheetPdf } from '@/lib/timesheetPdf';
import {
  categoryLabel, entriesToSubmit, entryAmount, entryStatus, formatDuration, formatHours, formatMoney, isLocked, num, planUsage, rateStateFor, rateText,
  splitBySubmission, statusInfo, submitBlockReason, summarise,
  type CommentRow, type InvoiceRow, type RateRow, type SubmissionRow, type WorkLogRow,
} from '@/lib/timesheet';

const categoryColors: Record<string, string> = {
  analysis: 'bg-violet-100 text-violet-700',
  development: 'bg-blue-100 text-blue-700',
  testing: 'bg-cyan-100 text-cyan-700',
  meeting: 'bg-amber-100 text-amber-700',
  documentation: 'bg-emerald-100 text-emerald-700',
  support: 'bg-pink-100 text-pink-700',
  other: 'bg-muted text-muted-foreground',
};

const unique = (values: (string | null | undefined)[]): string[] => Array.from(new Set(values.filter((v): v is string => !!v)));
// a day without a time is read as that day in the time zone of the viewer
const parseDay = (day: string) => new Date(`${day}T00:00:00`);

interface Props {
  ticketId: string;
  ticketTitle: string;
  /** true for the client (and the colleagues of the client): the client does not log work */
  isReadOnly?: boolean;
  /** the client who owns the ticket: approves the hourly rate and the timesheets */
  canApprove?: boolean;
}

/**
 * The timesheet of a ticket. The consultant proposes the hourly rate, logs the activities (day, duration, kind of work, what was done, billable or not),
 * and submits them; the client approves the rate and the timesheet or asks for changes with a comment. Every amount is billable hours x the approved rate.
 */
export default function TicketTimesheet({ ticketId, ticketTitle, isReadOnly = false, canApprove = false }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<WorkLogRow | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<WorkLogRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [tab, setTab] = useState('entries');
  const [tabChosen, setTabChosen] = useState(false);

  const { data: viewer } = useQuery({
    queryKey: ['timesheet-viewer'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { userId: null as string | null, consultantId: null as string | null, profileRate: null as number | null };
      const { data: consultant } = await supabase.from('consultants').select('id, hourly_rate').eq('user_id', user.id).maybeSingle();
      return { userId: user.id as string | null, consultantId: (consultant?.id ?? null) as string | null, profileRate: (consultant?.hourly_rate ?? null) as number | null };
    },
    staleTime: 5 * 60 * 1000,
  });

  // true for the client of the ticket, its consultant and the consultants assigned to it (the database decides)
  const { data: participant = false } = useQuery({
    queryKey: ['timesheet-participant', ticketId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('is_ticket_participant', { _ticket_id: ticketId });
      if (error) return false;
      return data === true;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: ticket } = useQuery({
    queryKey: ['timesheet-ticket', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('consultant_id, planned_hours, planned_cost, cost_currency, plan_approved_at')
        .eq('id', ticketId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['ticket-work-logs', ticketId],
    queryFn: async (): Promise<WorkLogRow[]> => {
      const { data, error } = await supabase
        .from('ticket_work_logs')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('work_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as WorkLogRow[];
    },
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ['ticket-timesheet-submissions', ticketId],
    queryFn: async (): Promise<SubmissionRow[]> => {
      const { data, error } = await supabase
        .from('ticket_timesheet_submissions')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SubmissionRow[];
    },
  });

  const { data: rates = [] } = useQuery({
    queryKey: ['ticket-rates', ticketId],
    queryFn: async (): Promise<RateRow[]> => {
      const { data, error } = await supabase.from('ticket_rates').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RateRow[];
    },
  });

  const submissionIds = submissions.map(s => s.id);
  const { data: comments = [] } = useQuery({
    queryKey: ['ticket-timesheet-comments', ticketId, submissionIds.join(',')],
    enabled: submissionIds.length > 0,
    queryFn: async (): Promise<CommentRow[]> => {
      const { data, error } = await supabase.from('ticket_timesheet_comments').select('*').in('submission_id', submissionIds).order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as CommentRow[];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['ticket-timesheet-invoices', ticketId],
    queryFn: async (): Promise<InvoiceRow[]> => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, timesheet_id, invoice_number, status, amount, currency, due_date, paid_at')
        .eq('ticket_id', ticketId)
        .not('timesheet_id', 'is', null);
      if (error) return [];
      return (data || []) as unknown as InvoiceRow[];
    },
  });

  const { data: vatPercent = 0 } = useQuery({
    queryKey: ['timesheet-vat-percent'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('timesheet_vat_percent');
      if (error) return 0;
      return num(data);
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: pricingTerms } = usePricingTerms();
  const consultantIds = unique([ticket?.consultant_id, ...rates.map(r => r.consultant_id), ...logs.map(l => l.consultant_id)]);
  const userIds = unique([...submissions.map(s => s.submitted_by), ...comments.map(c => c.author_id)]);
  const { data: names } = useQuery({
    queryKey: ['timesheet-names', ticketId, consultantIds.join(','), userIds.join(',')],
    enabled: consultantIds.length + userIds.length > 0,
    queryFn: async () => {
      const byConsultant: Record<string, string> = {};
      const byUser: Record<string, string> = {};
      let consultants: { id: string; user_id: string }[] = [];
      if (consultantIds.length > 0) {
        const { data } = await supabase.from('consultants').select('id, user_id').in('id', consultantIds);
        consultants = (data || []) as { id: string; user_id: string }[];
      }
      const allUsers = unique([...consultants.map(c => c.user_id), ...userIds]);
      if (allUsers.length > 0) {
        const { data: profiles } = await supabase.from('profile_directory').select('user_id, display_name').in('user_id', allUsers);
        for (const p of profiles || []) byUser[p.user_id as string] = (p.display_name as string | null) || 'Unknown';
      }
      for (const c of consultants) byConsultant[c.id] = byUser[c.user_id] || 'Unknown';
      return { byConsultant, byUser };
    },
  });
  const byConsultant = names?.byConsultant ?? {};
  const byUser = names?.byUser ?? {};

  const refresh = () => {
    for (const key of ['ticket-work-logs', 'ticket-timesheet-submissions', 'ticket-rates', 'ticket-timesheet-comments', 'ticket-timesheet-invoices', 'ticket-payment-invoices', 'timesheet-ticket', 'timesheet-names']) {
      queryClient.invalidateQueries({ queryKey: [key, ticketId] });
    }
  };

  const namedLogs = useMemo(() => logs.map(l => ({ ...l, consultant_name: byConsultant[l.consultant_id] ?? 'Consultant' })), [logs, byConsultant]);

  // the consultant view is for a consultant who works on this ticket (an administrator who looks at a ticket sees the read-only view)
  const myConsultantId = !isReadOnly && participant ? viewer?.consultantId ?? null : null;
  const isConsultantView = !!myConsultantId;
  const waitingForClient = submissions.some(s => s.status === 'submitted');

  // the client lands on the timesheets when one waits for an answer
  useEffect(() => {
    if (!tabChosen && canApprove && waitingForClient) {
      setTab('timesheets');
      setTabChosen(true);
    }
  }, [canApprove, waitingForClient, tabChosen]);

  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  const knownIds = new Set(submissions.map(s => s.id));
  const { bySubmission } = splitBySubmission(namedLogs);
  const openLogs = namedLogs.filter(l => !l.submission_id || !knownIds.has(l.submission_id));
  const entryCounts: Record<string, number> = {};
  for (const s of submissions) entryCounts[s.id] = bySubmission[s.id]?.length ?? 0;

  const myOpenEntries = entriesToSubmit(namedLogs, submissions, myConsultantId);
  const myWaiting = submissions.some(s => s.status === 'submitted' && s.submitted_by === viewer?.userId);
  const resubmit = submissions.some(s => s.status === 'changes_requested' && s.submitted_by === viewer?.userId);
  const blockReason = submitBlockReason(myOpenEntries, myWaiting);

  const myRates = rateStateFor(rates, myConsultantId);
  const approvedRates = rates.filter(r => r.status === 'approved');
  const currency = (myConsultantId ? myRates.approved?.currency : approvedRates[0]?.currency) ?? approvedRates[0]?.currency ?? ticket?.cost_currency ?? 'USD';
  const rateLabel = myConsultantId ? (myRates.approved ? rateText(myRates.approved) : null) : approvedRates.length === 1 ? rateText(approvedRates[0]) : null;

  const plan: PlanInfo | null = ticket && num(ticket.planned_hours) > 0
    ? { plannedHours: num(ticket.planned_hours), plannedCost: num(ticket.planned_cost), currency: ticket.cost_currency || currency, approved: !!ticket.plan_approved_at }
    : null;
  const totals = summarise(namedLogs, vatPercent, pricingTerms ?? undefined);
  const planOverBy = plan ? planUsage(plan.plannedHours, totals.totalHours)?.overBy ?? 0 : 0;

  const byCategory: Record<string, { hours: number; amount: number }> = {};
  for (const l of namedLogs) {
    const row = (byCategory[l.category] ||= { hours: 0, amount: 0 });
    row.hours += num(l.hours);
    row.amount += entryAmount(l) ?? 0;
  }

  const entryStatusLabel = (l: WorkLogRow) => {
    const status = entryStatus(l, submissions);
    return status === 'open' ? 'Not sent yet' : statusInfo(status).label;
  };
  const exportRows = (): ExportRow[] =>
    namedLogs.map(l => ({
      date: l.work_date,
      consultant: l.consultant_name ?? '',
      category: categoryLabel(l.category),
      hours: num(l.hours),
      billable: l.billable,
      rate: l.hourly_rate,
      amount: entryAmount(l),
      currency,
      timesheet: entryStatusLabel(l),
      description: l.description ?? '',
    }));

  const exportCsv = () => {
    downloadText(`timesheet-${ticketId.substring(0, 8)}.csv`, buildCsv(exportRows()));
    toast.success('CSV exported');
  };

  const exportPdf = async () => {
    try {
      await downloadTimesheetPdf({
        ticketTitle,
        ticketId,
        currency,
        vatPercent,
        serviceFeePercent: pricingTerms?.serviceFeePercent,
        processingFeePercent: pricingTerms?.processingFeePercent,
        rates: approvedRates.map(r => {
          const when = r.decided_at ? ` on ${format(new Date(r.decided_at), 'MMM d, yyyy')}` : '';
          return `${byConsultant[r.consultant_id] ?? 'Consultant'}: ${rateText(r)} (approved${r.source === 'proposal' ? ' with the accepted bid' : ' by the client'}${when})`;
        }),
        rows: exportRows(),
        totals,
        timesheets: submissions.map(s => {
          const who = byUser[s.submitted_by] ?? 'Consultant';
          const approved = s.status === 'signed' && s.signed_by_name ? ` - approved by ${s.signed_by_name}${s.signed_at ? ` on ${format(new Date(s.signed_at), 'MMM d, yyyy')}` : ''}` : '';
          return `${statusInfo(s.status).label} - ${who} - ${formatHours(s.billable_hours ?? s.total_hours)} billable, ${formatMoney(s.total_cost, s.cost_currency)} without VAT${approved}`;
        }),
      });
      toast.success('PDF downloaded');
    } catch {
      toast.error('The PDF could not be made.');
    }
  };

  const confirmDelete = async () => {
    if (!deleteEntry) return;
    setDeleting(true);
    const { data, error } = await supabase.from('ticket_work_logs').delete().eq('id', deleteEntry.id).select('id');
    setDeleting(false);
    if (error || !data || data.length === 0) {
      toast.error(error?.message || 'The entry could not be deleted.');
      return;
    }
    toast.success('Entry deleted');
    setDeleteEntry(null);
    refresh();
  };

  const canEdit = (l: WorkLogRow) => isConsultantView && l.consultant_id === myConsultantId && !isLocked(l, submissions);

  const renderEntry = (l: WorkLogRow & { consultant_name?: string }) => {
    const amount = entryAmount(l);
    const locked = isLocked(l, submissions);
    const amountText = !l.billable
      ? 'Not billable: 0.00'
      : l.hourly_rate == null
        ? 'Rate pending approval'
        : `${formatMoney(l.hourly_rate, currency)} per hour x ${formatDuration(l.hours)} = ${formatMoney(amount, currency)}`;
    return (
      <Card key={l.id} className="rounded-xl border-border/30" data-testid="timesheet-entry">
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="w-16 shrink-0 rounded-lg bg-primary/10 px-1 py-1.5 text-center text-[11px] font-bold text-primary">{formatDuration(l.hours)}</div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{l.consultant_name}</span>
                <Badge variant="secondary" className={`text-[10px] ${categoryColors[l.category] || ''}`}>{categoryLabel(l.category)}</Badge>
                {l.billable ? (
                  <Badge variant="secondary" className="bg-green-100 text-[10px] text-green-700">Billable</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Not billable</Badge>
                )}
                {locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked: part of a timesheet that was sent to the client or approved" />}
                {canEdit(l) && (
                  <span className="ms-auto flex gap-1">
                    <button type="button" onClick={() => setEditEntry(l)} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Change this entry">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => setDeleteEntry(l)} className="text-muted-foreground transition-colors hover:text-destructive" aria-label="Delete this entry">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {format(parseDay(l.work_date), 'MMM d, yyyy')} - {amountText}
              </p>
              {l.description && <p className="whitespace-pre-wrap text-xs text-foreground">{l.description}</p>}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const orderedSubmissions = [...submissions].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-4">
      <TimesheetRateCard
        ticketId={ticketId}
        currency={currency}
        rates={rates}
        consultantIds={consultantIds}
        names={byConsultant}
        myConsultantId={myConsultantId}
        suggestedRate={viewer?.profileRate ?? null}
        canApprove={canApprove}
        onChanged={refresh}
      />

      <TimesheetSummary logs={namedLogs} submissions={submissions} vatPercent={vatPercent} currency={currency} rateLabel={rateLabel} plan={plan} audience={isConsultantView ? 'consultant' : 'client'} />

      <div className="flex flex-wrap items-center gap-2">
        {isConsultantView && (
          <Button size="sm" className="h-8 gap-1.5 border-0 text-xs gradient-primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add activity
          </Button>
        )}
        {isConsultantView && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setSubmitOpen(true)} disabled={!!blockReason} title={blockReason ?? undefined}>
            <Send className="h-3.5 w-3.5" /> {resubmit ? 'Submit again' : 'Submit for approval'}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void exportPdf()}>
          <Download className="h-3.5 w-3.5" /> Export PDF
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportCsv}>
          <FileText className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>
      {isConsultantView && blockReason && <p className="text-xs text-muted-foreground">{blockReason}</p>}

      <Tabs value={tab} onValueChange={value => { setTab(value); setTabChosen(true); }} className="w-full">
        <TabsList className="grid h-9 w-full grid-cols-3">
          <TabsTrigger value="entries" className="text-xs">Activities</TabsTrigger>
          <TabsTrigger value="timesheets" className="text-xs">
            Timesheets
            {waitingForClient && <span className="ms-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" role="img" aria-label="A timesheet waits for approval" />}
          </TabsTrigger>
          <TabsTrigger value="categories" className="text-xs">By category</TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="mt-3 space-y-4">
          {namedLogs.length === 0 && (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="py-8 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No work logged yet</p>
              </CardContent>
            </Card>
          )}
          {openLogs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{isReadOnly ? 'Not sent to you yet' : 'Not submitted yet'}</p>
              {openLogs.map(renderEntry)}
            </div>
          )}
          {orderedSubmissions
            .filter(s => (bySubmission[s.id]?.length ?? 0) > 0)
            .map(s => (
              <div key={s.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={s.status} />
                  <span className="text-xs text-muted-foreground">
                    {byUser[s.submitted_by] || 'Consultant'} - {formatHours(s.total_hours)} - {formatMoney(s.total_cost, s.cost_currency)} without VAT
                  </span>
                </div>
                {bySubmission[s.id].map(renderEntry)}
              </div>
            ))}
        </TabsContent>

        <TabsContent value="timesheets" className="mt-3">
          <TimesheetSubmissions
            submissions={orderedSubmissions}
            comments={comments}
            invoices={invoices}
            entryCounts={entryCounts}
            names={byUser}
            vatPercent={vatPercent}
            canApprove={canApprove}
            isConsultantView={isConsultantView}
            viewerUserId={viewer?.userId ?? null}
            planOverBy={planOverBy}
            onChanged={refresh}
            onResubmit={() => setSubmitOpen(true)}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-3">
          <div className="space-y-2">
            {Object.entries(byCategory).map(([category, data]) => {
              const percent = totals.totalHours > 0 ? (data.hours / totals.totalHours) * 100 : 0;
              return (
                <Card key={category} className="rounded-xl border-border/30">
                  <CardContent className="p-3">
                    <div className="mb-2 flex items-center gap-3">
                      <Badge variant="secondary" className={`text-[10px] ${categoryColors[category] || ''}`}>{categoryLabel(category)}</Badge>
                      <span className="ms-auto text-sm font-semibold text-foreground">{formatHours(data.hours)}</span>
                      <span className="text-[10px] text-muted-foreground">{formatMoney(data.amount, currency)}</span>
                      <span className="text-[10px] text-muted-foreground">{percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted/30">
                      <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${percent}%` }} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {Object.keys(byCategory).length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No data</p>}
          </div>
        </TabsContent>
      </Tabs>

      <WorkLogDialog ticketId={ticketId} consultantId={myConsultantId} open={addOpen} onOpenChange={setAddOpen} rateLabel={rateLabel} onSaved={refresh} />
      <WorkLogDialog ticketId={ticketId} consultantId={myConsultantId} open={!!editEntry} onOpenChange={open => { if (!open) setEditEntry(null); }} entry={editEntry} rateLabel={rateLabel} onSaved={refresh} />
      <SubmitTimesheetDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        ticketId={ticketId}
        entries={myOpenEntries}
        vatPercent={vatPercent}
        currency={currency}
        blockReason={blockReason}
        resubmit={resubmit}
        onSubmitted={() => { refresh(); setTab('timesheets'); }}
      />
      <Dialog open={!!deleteEntry} onOpenChange={open => { if (!deleting && !open) setDeleteEntry(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              {deleteEntry ? `${formatDuration(deleteEntry.hours)} on ${format(parseDay(deleteEntry.work_date), 'MMM d, yyyy')}: ` : ''}
              {deleteEntry?.description ?? ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteEntry(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>Delete the entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
