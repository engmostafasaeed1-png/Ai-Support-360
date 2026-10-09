import { useState } from 'react';
import { CheckCircle2, Clock, DollarSign, Loader2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney, rateStateFor, rateText, type RateRow, type RateState } from '@/lib/timesheet';
import { usePricingTerms } from '@/hooks/usePricingTerms';
import { formatPercent, priceBreakdown } from '@/lib/pricing';

interface Props {
  ticketId: string;
  /** the currency of the ticket, used until a rate exists */
  currency: string;
  /** the rates of the ticket that the viewer may see */
  rates: RateRow[];
  /** the consultants to show to the client (the consultant sees only their own rate) */
  consultantIds: string[];
  /** consultant id -> name */
  names: Record<string, string>;
  /** set when the viewer is a consultant of the ticket */
  myConsultantId: string | null;
  /** the rate of the profile of the consultant, offered as a start */
  suggestedRate?: number | null;
  /** the client who owns the ticket */
  canApprove: boolean;
  onChanged: () => void;
}

/** The hourly rate: the consultant proposes it, the client approves it. Every amount of the timesheet is hours x this rate. */
export default function TimesheetRateCard({ ticketId, currency, rates, consultantIds, names, myConsultantId, suggestedRate, canApprove, onChanged }: Props) {
  const ids = myConsultantId ? [myConsultantId] : consultantIds;
  return (
    <Card className="rounded-2xl border-border/50" data-testid="rate-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Hourly rate</p>
        </div>
        {ids.length === 0 && (
          <p className="text-xs text-muted-foreground">No consultant is working on this ticket yet. The hourly rate is agreed when a consultant is assigned.</p>
        )}
        {ids.map(id => {
          const state = rateStateFor(rates, id);
          return id === myConsultantId ? (
            <ConsultantRate key={id} ticketId={ticketId} state={state} currency={currency} suggestedRate={suggestedRate} onChanged={onChanged} />
          ) : (
            <ClientRate key={id} name={names[id] || 'The consultant'} state={state} canApprove={canApprove} onChanged={onChanged} />
          );
        })}
        {ids.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {myConsultantId
              ? 'The client has to approve your hourly rate. You can log your hours already: they get the approved rate. You can submit the timesheet when the rate is approved.'
              : 'Every amount in the timesheet is hours x the hourly rate that is approved here. The consultant can not type another rate.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** What one hour costs the client in total (the rate plus the service fee, the processing fee and VAT), and that the consultant receives the whole rate. */
function HourlyTotal({ rate, audience }: { rate: Pick<RateRow, 'hourly_rate' | 'currency'> | null; audience: 'client' | 'consultant' }) {
  const { data: terms } = usePricingTerms();
  if (!rate || !terms || !(Number(rate.hourly_rate) > 0)) return null;
  const b = priceBreakdown(Number(rate.hourly_rate), terms);
  const cur = rate.currency || 'USD';
  return (
    <p className="text-[11px] text-muted-foreground" data-testid="hourly-total">
      {audience === 'client' ? (
        <>With the platform service fee ({formatPercent(terms.serviceFeePercent)}), the payment processing fee ({formatPercent(terms.processingFeePercent)}) and VAT ({formatPercent(terms.vatPercent)}) one hour costs you <strong className="text-foreground">{formatMoney(b.total, cur)}</strong>.</>
      ) : (
        <>The client pays <strong className="text-foreground">{formatMoney(b.total, cur)}</strong> per hour including the platform service fee ({formatPercent(terms.serviceFeePercent)}), the payment processing fee ({formatPercent(terms.processingFeePercent)}) and VAT ({formatPercent(terms.vatPercent)}). You receive the whole {formatMoney(b.base, cur)} per hour.</>
      )}
    </p>
  );
}

function approvedNote(rate: RateRow, byYou: boolean): string {
  const source = rate.source === 'proposal' ? 'with the accepted bid' : byYou ? 'by you' : 'by the client';
  const when = rate.decided_at ? ` on ${format(new Date(rate.decided_at), 'MMM d, yyyy')}` : '';
  return `approved ${source}${when}`;
}

function ConsultantRate({ ticketId, state, currency, suggestedRate, onChanged }: { ticketId: string; state: RateState; currency: string; suggestedRate?: number | null; onChanged: () => void }) {
  const { approved, proposed, declined } = state;
  const start = suggestedRate && suggestedRate > 0 ? String(suggestedRate) : '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(start);
  const [busy, setBusy] = useState(false);
  const showForm = (!approved && !proposed) || editing;
  const cur = (proposed ?? approved)?.currency ?? currency;

  const startEditing = () => {
    const current = proposed ?? approved;
    setValue(current ? String(current.hourly_rate) : start);
    setEditing(true);
  };

  const send = async () => {
    const rate = Number(value.replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Enter your hourly rate (more than 0).');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('propose_ticket_rate', { _ticket_id: ticketId, _hourly_rate: rate });
    setBusy(false);
    if (error) {
      toast.error(error.message || 'The rate could not be sent.');
      return;
    }
    toast.success('Your hourly rate was sent to the client for approval.');
    setEditing(false);
    onChanged();
  };

  return (
    <div className="space-y-2" data-testid="consultant-rate">
      {approved && (
        <div className="flex items-start gap-2 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Approved rate: <strong>{rateText(approved)}</strong> <span className="text-xs text-muted-foreground">({approvedNote(approved, false)})</span>
          </p>
        </div>
      )}
      {proposed && (
        <div className="flex items-start gap-2 text-sm text-amber-800">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Waiting for the client to approve <strong>{rateText(proposed)}</strong>
            {approved ? ' (the approved rate above stays until then)' : ''}
          </p>
        </div>
      )}
      {declined && (
        <div className="flex items-start gap-2 text-sm text-red-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            The client declined <strong>{rateText(declined)}</strong>
            {declined.decision_note ? `: "${declined.decision_note}"` : ''}. Send another rate.
          </p>
        </div>
      )}
      <HourlyTotal rate={proposed ?? approved} audience="consultant" />
      {!showForm ? (
        <Button variant="outline" size="sm" onClick={startEditing}>
          {proposed ? 'Change the proposal' : 'Propose a different rate'}
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="timesheet-rate-input" className="text-xs">Your hourly rate ({cur})</Label>
            <Input id="timesheet-rate-input" type="number" inputMode="decimal" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)} className="w-36" />
          </div>
          <Button size="sm" onClick={() => void send()} disabled={busy} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Send to the client for approval
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          )}
        </div>
      )}
    </div>
  );
}

function ClientRate({ name, state, canApprove, onChanged }: { name: string; state: RateState; canApprove: boolean; onChanged: () => void }) {
  const { approved, proposed, declined } = state;
  const [busy, setBusy] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState('');

  const answer = async (rate: RateRow, approve: boolean, note?: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('respond_to_ticket_rate', { _rate_id: rate.id, _approve: approve, _note: note });
    setBusy(false);
    if (error) {
      toast.error(approve ? 'The rate could not be approved.' : 'The rate could not be declined.', { description: error.message });
      return;
    }
    toast.success(approve ? 'Hourly rate approved.' : 'Hourly rate declined.');
    setDeclineOpen(false);
    setReason('');
    onChanged();
  };

  return (
    <div className="space-y-2 rounded-xl border border-border/50 p-3" data-testid="client-rate">
      <p className="text-xs font-medium text-muted-foreground">{name}</p>
      {approved && (
        <div className="flex items-start gap-2 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Approved rate: <strong>{rateText(approved)}</strong> <span className="text-xs text-muted-foreground">({approvedNote(approved, canApprove)})</span>
          </p>
        </div>
      )}
      {proposed && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-2.5">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {name} proposes <strong>{rateText(proposed)}</strong>.
              {approved
                ? ` The approved rate stays ${rateText(approved)} until the new one is approved.`
                : canApprove ? ' Approve it so that the timesheet can be sent to you.' : ' The client has to approve it.'}
            </p>
          </div>
          {canApprove && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void answer(proposed, true)} className="gap-1.5">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve this rate
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclineOpen(true)}>Decline...</Button>
            </div>
          )}
        </div>
      )}
      <HourlyTotal rate={proposed ?? approved} audience="client" />
      {!approved && !proposed && !declined && (
        <p className="text-xs text-muted-foreground">No hourly rate was proposed yet. The consultant can log hours, but can not send a timesheet before the client approved a rate.</p>
      )}
      {declined && !proposed && (
        <p className="text-xs text-red-700">
          {canApprove ? 'You declined' : 'The client declined'} {rateText(declined)}
          {declined.decision_note ? `: "${declined.decision_note}"` : ''}. The consultant can send another rate.
        </p>
      )}
      <Dialog open={declineOpen} onOpenChange={next => { if (!busy) { setDeclineOpen(next); if (!next) setReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this hourly rate?</DialogTitle>
            <DialogDescription>The consultant gets your reason and can send another rate.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Tell the consultant why the rate is declined..." />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={() => proposed && void answer(proposed, false, reason.trim())}
              className="gap-1.5"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Decline the rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
