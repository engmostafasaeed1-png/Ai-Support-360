import { useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatHours, formatMoney, summarise, type WorkLogRow } from '@/lib/timesheet';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  /** the entries that go into the timesheet */
  entries: WorkLogRow[];
  vatPercent: number;
  currency: string;
  /** why the timesheet can not be submitted now, else null */
  blockReason: string | null;
  /** true when the client sent the timesheet back and it is submitted again */
  resubmit: boolean;
  onSubmitted: () => void;
}

/** The consultant sends the entries that are not billed yet to the client for approval. The client approves it in the app. */
export default function SubmitTimesheetDialog({ open, onOpenChange, ticketId, entries, vatPercent, currency, blockReason, resubmit, onSubmitted }: Props) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const s = summarise(entries, vatPercent);

  useEffect(() => {
    if (open) setMessage('');
  }, [open]);

  const submit = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('submit_timesheet', { _ticket_id: ticketId, _message: message.trim() || undefined });
    setBusy(false);
    if (error) {
      toast.error(error.message || 'The timesheet could not be submitted.');
      return;
    }
    toast.success(resubmit ? 'The timesheet was submitted again.' : 'The timesheet was sent to the client for approval.');
    onOpenChange(false);
    onSubmitted();
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            {resubmit ? 'Submit the timesheet again' : 'Submit for approval'}
          </DialogTitle>
          <DialogDescription>The client approves the timesheet here in the app and gets an invoice for the approved amount. Approved entries can not be changed any more.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-xl border border-border/50 p-3 text-sm" data-testid="submit-totals">
            <span className="text-muted-foreground">Entries</span>
            <span className="text-right">{s.entries}</span>
            <span className="text-muted-foreground">Hours</span>
            <span className="text-right">{formatHours(s.totalHours)} ({formatHours(s.billableHours)} billable)</span>
            <span className="text-muted-foreground">Amount without VAT</span>
            <span className="text-right">{formatMoney(s.subtotal, currency)}</span>
            <span className="text-muted-foreground">VAT {String(Number(vatPercent) || 0)}% (estimate)</span>
            <span className="text-right">{formatMoney(s.vat, currency)}</span>
            <span className="font-semibold">Total</span>
            <span className="text-right font-semibold">{formatMoney(s.total, currency)}</span>
          </div>
          {blockReason && (
            <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900" role="alert">{blockReason}</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="submit-message" className="text-xs">{resubmit ? 'What did you change? (optional)' : 'Message to the client (optional)'}</Label>
            <Textarea
              id="submit-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={resubmit ? 'For example: the hours are split per day now' : 'For example: the work of the first week'}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !!blockReason} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {resubmit ? 'Submit again' : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
