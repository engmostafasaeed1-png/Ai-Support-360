import { Link } from 'react-router-dom';
import { AlarmClock, ChevronRight, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import SubmitProposalModal from '@/components/consultant/SubmitProposalModal';
import { useCriticalMyAlerts, useDismissCriticalAlert, useNow } from '@/hooks/useCriticalService';
import { formatCountdown, formatPercent, isOpenAlert, msLeft, openAlerts } from '@/lib/criticalService';

/**
 * The notice on the consultant dashboard: every critical request that this consultant can still answer, with its countdown.
 * The alarm window (CriticalAlarm) can be closed with "Remind me later"; this notice stays until the request is answered, dismissed or over.
 * The realtime channel belongs to the alarm in the layout, so this one only reads the same list.
 */
export default function CriticalDashboardNotice() {
  const alertsQ = useCriticalMyAlerts({ realtime: false });
  const dismiss = useDismissCriticalAlert();
  const alerts = alertsQ.data ?? [];
  const now = useNow(alerts.some((a) => isOpenAlert(a)) ? 1000 : 0);
  const open = openAlerts(alerts, now);
  if (open.length === 0) return null;

  return (
    <Card data-testid="critical-dashboard-notice" className="rounded-2xl border-2 border-red-400 bg-red-50/70 dark:border-red-800 dark:bg-red-950/20">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-red-600 text-white">
            <AlarmClock className="h-4 w-4" />
          </span>
          <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-400">
            {open.length === 1 ? '1 critical request is waiting for your reply' : `${open.length} critical requests are waiting for your reply`}
          </p>
        </div>

        <ul className="space-y-2">
          {open.map((a) => (
            <li
              key={a.ticket_id}
              data-testid="critical-dashboard-item"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-200 bg-background p-3 dark:border-red-900/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {a.areas.slice(0, 3).map((area) => (
                    <Badge key={area} variant="secondary" className="text-[10px]">{area}</Badge>
                  ))}
                  <Badge className="bg-red-600 text-[10px] text-white">{`+${formatPercent(a.surcharge_percent)} for you`}</Badge>
                  <span className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">{`${formatCountdown(msLeft(a.due_at, now))} left`}</span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <SubmitProposalModal
                  ticketId={a.ticket_id}
                  ticketTitle={a.title}
                  criticalPercent={a.surcharge_percent}
                  criticalDueAt={a.due_at}
                  trigger={
                    <Button size="sm" className="gap-1.5 bg-red-600 text-white hover:bg-red-700">
                      <Send className="h-3.5 w-3.5" /> Reply now
                    </Button>
                  }
                />
                <Button asChild variant="outline" size="sm">
                  <Link to={`/consultant/tickets/${a.ticket_id}`}>Open the ticket</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => dismiss.mutate(a.ticket_id)} disabled={dismiss.isPending}>Not for me</Button>
              </div>
            </li>
          ))}
        </ul>

        <Link to="/consultant/open-tickets" className="inline-flex items-center gap-1 text-xs font-medium text-red-700 underline dark:text-red-400">
          See all open tickets <ChevronRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
