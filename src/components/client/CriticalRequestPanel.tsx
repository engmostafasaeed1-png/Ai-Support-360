import { useEffect, useRef, useState } from 'react';
import { AlarmClock, CheckCircle2, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CriticalExtendDialog from '@/components/client/CriticalExtendDialog';
import { notifyCriticalByEmail, useCriticalView, useNow } from '@/hooks/useCriticalService';
import { MAX_EXTENSIONS, describeEvent, formatCountdown, formatDeadline, formatPercent, msLeft } from '@/lib/criticalService';

type Props = {
  ticketId: string;
  role: 'client' | 'consultant' | 'admin';
};

/**
 * The critical reply request of a ticket: the countdown, who replied in time, and (for the owner of the ticket and the administrators) the
 * way to give the consultants more time or a higher surcharge. Renders nothing for an ordinary ticket.
 */
export default function CriticalRequestPanel({ ticketId, role }: Props) {
  const { data: view } = useCriticalView(ticketId);
  const [extendOpen, setExtendOpen] = useState(false);
  // the clock only runs while the reply window is open
  const now = useNow(view?.critical_response && view.due_at && new Date(view.due_at).getTime() > Date.now() ? 1000 : 0);
  const mailed = useRef(false);

  // the consultants who were alerted but not e-mailed yet get their e-mail now (the server skips everybody who already got it)
  useEffect(() => {
    if (mailed.current || !view?.critical_response || !view.can_extend || view.status !== 'waiting') return;
    mailed.current = true;
    void notifyCriticalByEmail(ticketId);
  }, [ticketId, view]);

  if (!view?.critical_response) return null;

  const percent = formatPercent(view.surcharge_percent);
  const left = msLeft(view.due_at, now);
  const open = left > 0;
  const state: 'answered' | 'waiting' | 'ended' = view.status === 'answered' ? 'answered' : open ? 'waiting' : 'ended';
  const deadline = formatDeadline(view.due_at);
  const alerted = view.alerted_count ?? 0;
  const replied = view.reply_count ?? 0;
  const events = view.events ?? [];

  if (role === 'consultant') {
    const mine = view.my_reply_at;
    const inTime = !!mine && !!view.due_at && new Date(mine).getTime() <= new Date(view.due_at).getTime();
    return (
      <Card className="rounded-2xl border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20" data-testid="critical-panel">
        <CardContent className="space-y-1.5 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-400">
            <AlarmClock className="h-4 w-4" /> Critical request
          </p>
          {open ? (
            <p>{`Reply with a proposal within ${formatCountdown(left)} (until ${deadline}) and your hourly rate gets +${percent} on this ticket.`}</p>
          ) : (
            <p>The reply window of this critical request has ended. A proposal now gets your normal rate.</p>
          )}
          {mine && (
            <p className="text-xs text-muted-foreground">
              {inTime
                ? `You replied at ${formatDeadline(mine)}, in time: +${percent} applies if the client accepts you.`
                : `You replied at ${formatDeadline(mine)}, after the window: no surcharge.`}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20" data-testid="critical-panel">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
            <AlarmClock className="h-4 w-4" /> Critical reply service
          </p>
          {state === 'answered' && (
            <Badge className="gap-1 bg-green-600 text-[10px] text-white"><CheckCircle2 className="h-3 w-3" /> Answered in time</Badge>
          )}
          {state === 'waiting' && <Badge className="bg-amber-500 text-[10px] text-white">Waiting for a reply</Badge>}
          {state === 'ended' && <Badge className="bg-red-600 text-[10px] text-white">No reply in time</Badge>}
        </div>

        {open && (
          <div className="rounded-xl bg-background/70 p-3 text-center">
            <p className="font-mono text-3xl font-bold tabular-nums text-red-700 dark:text-red-400" data-testid="critical-countdown">{`${formatCountdown(left)} left`}</p>
            <p className="text-xs text-muted-foreground">{`Reply window ends at ${deadline}`}</p>
          </div>
        )}

        {state === 'waiting' && (
          <p className="text-sm">{`Consultants who reply with a proposal before ${deadline} earn +${percent} on their hourly rate if you accept them.`}</p>
        )}
        {state === 'answered' && (
          <p className="text-sm">
            {`The first reply came at ${formatDeadline(view.first_reply_at)}. Open "Bids & Proposals" to choose a consultant: +${percent} is added to the hourly rate of a consultant who replied in time.`}
          </p>
        )}
        {state === 'ended' && (
          <p className="text-sm">
            Nobody replied in time, so no surcharge applies. Consultants can still reply at their normal rate. You can give them more time or raise the surcharge to alert them again.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">{`Surcharge +${percent}`}</Badge>
          <Badge variant="outline" className="text-[10px]">{alerted === 1 ? '1 consultant alerted' : `${alerted} consultants alerted`}</Badge>
          <Badge variant="outline" className="text-[10px]">{replied === 1 ? '1 replied' : `${replied} replied`}</Badge>
          {(view.extensions ?? 0) > 0 && <Badge variant="outline" className="text-[10px]">{`Changed ${view.extensions} of ${MAX_EXTENSIONS} times`}</Badge>}
        </div>

        {events.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"><History className="h-3 w-3" /> Changes</p>
            <ul className="space-y-0.5 text-xs">
              {events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex flex-wrap gap-x-2">
                  <span>{describeEvent(e)}</span>
                  <span className="text-muted-foreground">{formatDeadline(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view.can_extend && (
          <>
            <Button size="sm" className="gap-1.5 bg-red-600 text-white hover:bg-red-700" data-testid="critical-extend-button" onClick={() => setExtendOpen(true)}>
              <AlarmClock className="h-3.5 w-3.5" /> Extend time or raise surcharge
            </Button>
            <CriticalExtendDialog ticketId={ticketId} view={view} open={extendOpen} onOpenChange={setExtendOpen} />
          </>
        )}
        {role === 'admin' && !view.can_extend && <p className="text-xs text-muted-foreground">This request can no longer be extended.</p>}
      </CardContent>
    </Card>
  );
}
