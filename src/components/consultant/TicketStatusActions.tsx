import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, Clock, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type NextStatus = 'in_progress' | 'waiting_for_client' | 'resolved';

interface Props {
  ticketId: string;
  status: string | null;
}

// the summary the client reads when the case is resolved
const MIN_SUMMARY = 20;

const actions: Record<string, { to: NextStatus; label: string; icon: typeof Play; variant: 'default' | 'outline' }[]> = {
  matched: [{ to: 'in_progress', label: 'Start work', icon: Play, variant: 'default' }],
  in_progress: [
    { to: 'waiting_for_client', label: 'Hand back to client', icon: Clock, variant: 'outline' },
    { to: 'resolved', label: 'Mark as resolved', icon: CheckCircle2, variant: 'default' },
  ],
  waiting_for_client: [
    { to: 'in_progress', label: 'Resume work', icon: Play, variant: 'default' },
    { to: 'resolved', label: 'Mark as resolved', icon: CheckCircle2, variant: 'outline' },
  ],
};

const doneMessages: Record<NextStatus, string> = {
  in_progress: 'Work started. The client has been notified.',
  waiting_for_client: 'Handed back to the client. They have been notified.',
  resolved: 'Marked as resolved. The client has been notified.',
};

export default function TicketStatusActions({ ticketId, status }: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<NextStatus | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [summary, setSummary] = useState('');
  // the button that opened the dialog: the focus goes back to it when the dialog closes
  const opener = useRef<HTMLElement | null>(null);
  const available = actions[status || ''] ?? [];

  if (available.length === 0) return null;

  const change = async (to: NextStatus, resolution?: string): Promise<boolean> => {
    setBusy(to);
    const { error } = await supabase.rpc('consultant_set_ticket_status', {
      _ticket_id: ticketId,
      _status: to,
      ...(resolution ? { _resolution: resolution } : {}),
    });
    setBusy(null);
    if (error) {
      toast.error(error.message || 'The status could not be changed');
      return false;
    }
    toast.success(doneMessages[to]);
    queryClient.invalidateQueries({ queryKey: ['case-detail', ticketId] });
    queryClient.invalidateQueries({ queryKey: ['consultant-cases'] });
    queryClient.invalidateQueries({ queryKey: ['ticket-detail'] });
    queryClient.invalidateQueries({ queryKey: ['ticket-timeline', ticketId] });
    return true;
  };

  const onAction = (to: NextStatus, e: React.MouseEvent<HTMLButtonElement>) => {
    if (to === 'resolved') {
      opener.current = e.currentTarget;
      setSummary('');
      setResolveOpen(true);
      return;
    }
    void change(to);
  };

  const submitResolution = async () => {
    const text = summary.trim();
    if (text.length < MIN_SUMMARY) {
      toast.error(`Please describe how the issue was resolved (at least ${MIN_SUMMARY} characters).`);
      return;
    }
    if (await change('resolved', text)) setResolveOpen(false);
  };

  return (
    <>
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold flex-1 min-w-[160px]">Case status</p>
          {available.map((a) => {
            const Icon = a.icon;
            return (
              <Button key={a.to} size="sm" variant={a.variant} className="gap-1.5 text-xs" disabled={busy !== null} onClick={(e) => onAction(a.to, e)}>
                {busy === a.to && a.to !== 'resolved' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                {a.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={resolveOpen} onOpenChange={(open) => { if (busy === null) setResolveOpen(open); }}>
        <DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>Mark the case as resolved</DialogTitle>
            <DialogDescription>
              Tell the client what was wrong and what you did. The summary is saved with the ticket and the client can read it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="resolution-summary">Resolution summary</Label>
            <Textarea
              id="resolution-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={5}
              maxLength={10000}
              placeholder="Root cause, the fix or the answer, and anything the client should check."
            />
            <p className="text-[11px] text-muted-foreground">{summary.trim().length} characters (at least {MIN_SUMMARY})</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)} disabled={busy !== null}>Cancel</Button>
            <Button onClick={submitResolution} disabled={busy !== null} className="gradient-primary border-0">
              {busy === 'resolved' && <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" />}
              Mark as resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
