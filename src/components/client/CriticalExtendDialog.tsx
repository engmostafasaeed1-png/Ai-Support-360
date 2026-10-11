import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useExtendCritical } from '@/hooks/useCriticalService';
import {
  extendedDeadline, extensionProblem, extraMinuteOptions, formatDeadline, formatPercent, formatWindow, msLeft, percentOptions, type CriticalView,
} from '@/lib/criticalService';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Props = {
  ticketId: string;
  view: CriticalView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The client gives the consultants more time and/or a higher surcharge while nobody is assigned; the consultants are alarmed again. */
export default function CriticalExtendDialog({ ticketId, view, open, onOpenChange }: Props) {
  const extend = useExtendCritical();
  const current = Number(view.surcharge_percent ?? 0);
  const maxMinutes = Number(view.max_minutes ?? 240);
  const maxPercent = Math.max(current, Number(view.max_surcharge_percent ?? 100));
  const windowOpen = msLeft(view.due_at) > 0;
  const [extra, setExtra] = useState(Math.min(30, maxMinutes));
  const [percent, setPercent] = useState(current);

  // every time the dialog opens it starts from the request as it is now
  useEffect(() => {
    if (open) {
      setExtra(Math.min(30, maxMinutes));
      setPercent(current);
    }
  }, [open, current, maxMinutes]);

  const now = Date.now();
  const problem = extensionProblem(view, extra, percent, now);
  const newDue = extendedDeadline(view.due_at, extra, now);

  const send = () => {
    if (problem) return;
    extend.mutate(
      { ticketId, extraMinutes: extra, newPercent: percent > current ? percent : null },
      {
        onSuccess: () => {
          toast.success('The consultants are alerted again');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Extend the time or raise the surcharge</DialogTitle>
          <DialogDescription>
            Consultants who have not replied yet are alerted again. A reply that arrives inside the new window counts, also when it came after the old deadline.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="critical-extra" className="text-xs">Add time</Label>
            <select id="critical-extra" className={selectClass} value={extra} onChange={(e) => setExtra(Number(e.target.value))}>
              {windowOpen && <option value={0}>No extra time</option>}
              {extraMinuteOptions(maxMinutes).map((m) => (
                <option key={m} value={m}>{`${formatWindow(m)} more`}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="critical-boost" className="text-xs">Surcharge for the consultant</Label>
            <select id="critical-boost" className={selectClass} value={percent} onChange={(e) => setPercent(Number(e.target.value))}>
              {percentOptions(current, maxPercent).map((p) => (
                <option key={p} value={p}>{p === current ? `+${formatPercent(p)} (current)` : `+${formatPercent(p)}`}</option>
              ))}
            </select>
          </div>
          <div className="space-y-0.5 rounded-lg bg-muted/40 p-3 text-xs">
            <p>{`New deadline: ${formatDeadline(newDue)}`}</p>
            <p>{`Surcharge: +${formatPercent(percent)}`}</p>
          </div>
          {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-red-600 text-white hover:bg-red-700" disabled={!!problem || extend.isPending} onClick={send}>
            {extend.isPending ? 'Sending...' : 'Alert consultants again'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
