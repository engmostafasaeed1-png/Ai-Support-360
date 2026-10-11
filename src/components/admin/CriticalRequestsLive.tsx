import { Link } from 'react-router-dom';
import { AlarmClock, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminCriticalRequests, useNow } from '@/hooks/useCriticalService';
import { adminAttention, adminCriticalState, adminCriticalSummary, isStillOpen } from '@/lib/criticalAdmin';
import { MAX_EXTENSIONS, formatCountdown, formatPercent, msLeft } from '@/lib/criticalService';

/**
 * Admin: the critical requests of the last days with their alarm: how long the reply window still runs, how many consultants were alerted and
 * how many replied. A notice on top says what needs the administrator (a request that waits, a request nobody could be alerted for, a window that
 * ended without a reply). It sits next to the settings of the service and refreshes every 15 seconds.
 */
export default function CriticalRequestsLive() {
  const listQ = useAdminCriticalRequests();
  const rows = listQ.data ?? [];
  const now = useNow(rows.some((r) => adminCriticalState(r) === 'waiting') ? 1000 : 0);
  const summary = adminCriticalSummary(rows, now);

  return (
    <Card className="rounded-2xl border-border/50" data-testid="critical-requests-live">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><AlarmClock className="h-4 w-4" /> Critical requests right now</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary.waiting > 0 && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" data-testid="critical-live-waiting">
            <span className="flex h-6 w-6 shrink-0 animate-pulse items-center justify-center rounded-full bg-red-600 text-white"><AlarmClock className="h-3.5 w-3.5" /></span>
            {summary.waiting === 1 ? '1 critical request is waiting for a reply right now' : `${summary.waiting} critical requests are waiting for a reply right now`}
          </div>
        )}
        {summary.needAttention > 0 && (
          <div role="alert" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="critical-live-attention">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {summary.needAttention === 1 ? '1 critical request needs your attention' : `${summary.needAttention} critical requests need your attention`}
          </div>
        )}

        {listQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : listQ.isError && rows.length === 0 ? (
          <p className="text-xs text-destructive">The critical requests could not be loaded. Please reload the page.</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No critical request yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const state = adminCriticalState(r, now);
              const note = adminAttention(r, now);
              return (
                <li key={r.id} data-testid="critical-live-row" className="space-y-1.5 rounded-xl border border-border/60 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link to={`/admin/tickets/${r.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline">{r.title}</Link>
                    {state === 'waiting' && isStillOpen(r) && (
                      <span className="font-mono text-xs font-semibold tabular-nums text-red-700 dark:text-red-400">{`${formatCountdown(msLeft(r.due_at, now))} left`}</span>
                    )}
                    {state === 'waiting' && isStillOpen(r) && <Badge className="bg-amber-500 text-[10px] text-white">Waiting for a reply</Badge>}
                    {state === 'answered' && <Badge className="bg-green-600 text-[10px] text-white">Answered in time</Badge>}
                    {state === 'ended' && <Badge className="bg-red-600 text-[10px] text-white">No reply in time</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{`Surcharge +${formatPercent(r.surcharge_percent)}`}</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.alerted === 1 ? '1 consultant alerted' : `${r.alerted} consultants alerted`}</Badge>
                    <Badge variant="outline" className="text-[10px]">{r.replied === 1 ? '1 replied' : `${r.replied} replied`}</Badge>
                    {r.extensions > 0 && <Badge variant="outline" className="text-[10px]">{`Changed ${r.extensions} of ${MAX_EXTENSIONS} times`}</Badge>}
                  </div>
                  {note && <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{note}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
