import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSignature, Loader2, MessageSquare, RotateCcw, Send } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StatusBadge, { ToneBadge } from '@/components/timesheet/StatusBadge';
import { commentLabel, formatHours, formatMoney, invoiceInfo, num, rateText, round2, type CommentRow, type InvoiceRow, type SubmissionRow } from '@/lib/timesheet';

interface Props {
  submissions: SubmissionRow[];
  comments: CommentRow[];
  invoices: InvoiceRow[];
  /** timesheet id -> number of entries in it */
  entryCounts: Record<string, number>;
  /** user id -> name */
  names: Record<string, string>;
  vatPercent: number;
  /** the client who owns the ticket: can approve and ask for changes */
  canApprove: boolean;
  isConsultantView: boolean;
  viewerUserId: string | null;
  /** hours over the approved plan (0 when the plan is not exceeded), shown to the client before approving */
  planOverBy?: number;
  onChanged: () => void;
  onResubmit: () => void;
}

/** The timesheets of the ticket: the status, the numbers, the invoice, the comments between client and consultant, and the buttons to approve, ask for changes, comment or submit again. */
export default function TimesheetSubmissions(props: Props) {
  const { submissions, comments, invoices, entryCounts, names, vatPercent, canApprove, isConsultantView, viewerUserId, planOverBy, onChanged, onResubmit } = props;
  if (submissions.length === 0) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-8 text-center">
          <FileSignature className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {isConsultantView ? 'No timesheet was submitted yet. Add your activities and press "Submit for approval".' : 'No timesheet was submitted yet. The consultant submits the hours here for your approval.'}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {submissions.map(sub => (
        <SubmissionCard
          key={sub.id}
          sub={sub}
          comments={comments.filter(c => c.submission_id === sub.id)}
          invoice={invoices.find(i => i.timesheet_id === sub.id) ?? null}
          entryCount={entryCounts[sub.id] ?? 0}
          consultantName={names[sub.submitted_by] || 'The consultant'}
          names={names}
          vatPercent={vatPercent}
          canApprove={canApprove}
          mine={isConsultantView && sub.submitted_by === viewerUserId}
          viewerUserId={viewerUserId}
          planOverBy={planOverBy ?? 0}
          onChanged={onChanged}
          onResubmit={onResubmit}
        />
      ))}
    </div>
  );
}

function SubmissionCard({ sub, comments, invoice, entryCount, consultantName, names, vatPercent, canApprove, mine, viewerUserId, planOverBy, onChanged, onResubmit }: {
  sub: SubmissionRow;
  comments: CommentRow[];
  invoice: InvoiceRow | null;
  entryCount: number;
  consultantName: string;
  names: Record<string, string>;
  vatPercent: number;
  canApprove: boolean;
  mine: boolean;
  viewerUserId: string | null;
  planOverBy: number;
  onChanged: () => void;
  onResubmit: () => void;
}) {
  const [dialog, setDialog] = useState<'approve' | 'changes' | null>(null);
  const [note, setNote] = useState('');
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);

  const cur = sub.cost_currency || 'USD';
  const approved = sub.status === 'signed';
  const subtotal = round2(num(sub.total_cost));
  const vatPct = approved && sub.vat_percent != null ? num(sub.vat_percent) : num(vatPercent);
  const vat = approved && sub.vat_amount != null ? round2(num(sub.vat_amount)) : round2((subtotal * vatPct) / 100);
  const total = approved && sub.grand_total != null ? round2(num(sub.grand_total)) : round2(subtotal + vat);
  const lastRequest = [...comments].reverse().find(c => c.kind === 'change_request') ?? null;
  const canComment = canApprove || mine;

  const closeDialog = () => {
    setDialog(null);
    setNote('');
  };

  const respond = async (approve: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc('respond_to_timesheet', { _submission_id: sub.id, _approve: approve, _note: note.trim() || undefined });
    setBusy(false);
    if (error) {
      toast.error(approve ? 'The timesheet could not be approved.' : 'The request for changes could not be sent.', { description: error.message });
      return;
    }
    toast.success(approve ? (subtotal > 0 ? 'Timesheet approved. An invoice was created.' : 'Timesheet approved.') : 'The consultant was asked to change the timesheet.');
    closeDialog();
    onChanged();
  };

  const sendComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    setBusy(true);
    const { error } = await supabase.rpc('add_timesheet_comment', { _submission_id: sub.id, _body: body });
    setBusy(false);
    if (error) {
      toast.error(error.message || 'The comment could not be sent.');
      return;
    }
    toast.success('Comment sent.');
    setCommentText('');
    onChanged();
  };

  return (
    <Card className="rounded-xl border-border/40" data-testid="timesheet-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={sub.status} />
          {num(sub.submit_count) > 1 && <span className="text-[11px] text-muted-foreground">Round {num(sub.submit_count)}</span>}
          <span className="text-sm font-semibold text-foreground">{consultantName}</span>
          <span className="ms-auto text-[11px] text-muted-foreground">
            {sub.submitted_at ? `Submitted ${format(new Date(sub.submitted_at), 'MMM d, yyyy h:mm a')}` : `Created ${format(new Date(sub.created_at), 'MMM d, yyyy h:mm a')}`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Entries</p>
            <p className="font-medium text-foreground">{entryCount || '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Hours</p>
            <p className="font-medium text-foreground">{formatHours(sub.total_hours)} ({formatHours(sub.billable_hours ?? sub.total_hours)} billable)</p>
          </div>
          <div>
            <p className="text-muted-foreground">Hourly rate</p>
            <p className="font-medium text-foreground">{sub.hourly_rate != null ? rateText({ hourly_rate: sub.hourly_rate, currency: cur }) : subtotal > 0 ? 'more than one rate' : '-'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Amount without VAT</p>
            <p className="font-medium text-foreground">{formatMoney(subtotal, cur)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">VAT {String(vatPct)}%{approved ? '' : ' (estimate)'}</p>
            <p className="font-medium text-foreground">{formatMoney(vat, cur)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total{approved ? '' : ' (estimate)'}</p>
            <p className="font-semibold text-foreground">{formatMoney(total, cur)}</p>
          </div>
        </div>

        {approved && (
          <p className="flex items-center gap-1.5 text-xs text-green-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approved{sub.signed_by_name ? ` by ${sub.signed_by_name}` : ''}{sub.signed_at ? ` on ${format(new Date(sub.signed_at), 'MMM d, yyyy')}` : ''}
          </p>
        )}
        {invoice && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="timesheet-invoice">
            Invoice {invoice.invoice_number ?? ''} {formatMoney(invoice.amount, invoice.currency || cur)}
            <ToneBadge label={invoiceInfo(invoice).label} tone={invoiceInfo(invoice).tone} />
            {invoice.status !== 'completed' && invoice.due_date && <span>due {format(new Date(invoice.due_date), 'MMM d, yyyy')}</span>}
          </p>
        )}

        {sub.status === 'changes_requested' && (
          <div className="space-y-2 rounded-lg bg-orange-50 p-3 text-xs text-orange-900" data-testid="changes-banner">
            <p className="font-semibold">{mine ? 'The client asked for changes' : 'Changes were requested'}</p>
            {lastRequest && <p className="whitespace-pre-wrap">{lastRequest.body}</p>}
            {mine && (
              <>
                <p>Correct the entries (change or delete them, or add new ones), then submit the timesheet again.</p>
                <Button size="sm" className="gap-1.5" onClick={onResubmit}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Submit again
                </Button>
              </>
            )}
          </div>
        )}

        {canApprove && sub.status === 'submitted' && (
          <div className="space-y-2">
            {planOverBy > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                The hours of this ticket are {formatHours(planOverBy)} over the approved plan.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDialog('approve')} className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog('changes')}>Request changes</Button>
            </div>
          </div>
        )}
        {mine && sub.status === 'submitted' && (
          <p className="text-xs text-muted-foreground">Waiting for the client. The entries of this timesheet can not be changed until the client answers.</p>
        )}

        {comments.length > 0 && (
          <div className="space-y-2" data-testid="timesheet-comments">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              Comments
            </p>
            {comments.map(c => {
              const author = c.author_id === viewerUserId ? 'You' : names[c.author_id] || (c.author_role === 'client' ? 'The client' : 'The consultant');
              return (
                <div key={c.id} className={`rounded-lg p-2.5 ${c.kind === 'change_request' ? 'bg-orange-50' : c.author_role === 'client' ? 'bg-blue-50' : 'bg-muted/40'}`}>
                  <p className="text-[11px] text-muted-foreground">
                    <strong className="text-foreground">{author}</strong> {commentLabel(c.kind)} - {format(new Date(c.created_at), 'MMM d, h:mm a')}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground">{c.body}</p>
                </div>
              );
            })}
          </div>
        )}

        {canComment && (
          <div className="flex items-end gap-2">
            <Textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Write a comment..."
              aria-label="Comment on this timesheet"
              className="min-h-[44px] flex-1 text-xs"
            />
            <Button size="sm" variant="outline" disabled={busy || !commentText.trim()} onClick={() => void sendComment()} className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send comment
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={dialog === 'approve'} onOpenChange={next => { if (!busy && !next) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve this timesheet?</DialogTitle>
            <DialogDescription>
              {formatHours(sub.billable_hours ?? sub.total_hours)} billable, {formatMoney(subtotal, cur)} without VAT.
              {subtotal > 0 ? ` An invoice of about ${formatMoney(total, cur)} (with VAT) is created.` : ''} The entries can not be changed afterwards.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="A note for the consultant (optional)" />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog} disabled={busy}>Cancel</Button>
            <Button onClick={() => void respond(true)} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Approve the timesheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'changes'} onOpenChange={next => { if (!busy && !next) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>The consultant gets your comment, corrects the entries and submits the timesheet again.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={e => setNote(e.target.value)} rows={4} maxLength={1000} placeholder="Tell the consultant what to change..." />
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog} disabled={busy}>Cancel</Button>
            <Button onClick={() => void respond(false)} disabled={busy || note.trim().length < 3} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Send to the consultant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
