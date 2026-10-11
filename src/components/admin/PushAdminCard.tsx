import { AlertTriangle, BellRing, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGeneratePushKeys, usePushAdminStatus } from '@/hooks/usePush';

/**
 * Admin settings: phone alerts (Web Push), the second free channel of the critical request alert. One button creates the keys of the platform; the
 * consultants then turn the alerts on in their own settings, on each device. Shows how many devices get alerts and how many pushes failed.
 */
export default function PushAdminCard() {
  const statusQ = usePushAdminStatus();
  const generate = useGeneratePushKeys();
  const s = statusQ.data;

  return (
    <Card className="rounded-2xl border-border/50" data-testid="push-admin-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4" /> Phone alerts for consultants</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A free alert on the consultant's phone or computer when a critical request is opened, also when the portal is closed. It works in the browser: each consultant turns it on in their own settings, on every device. On iPhone the portal must first be added to the Home Screen.
        </p>

        {statusQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : !s ? (
          <p className="text-xs text-destructive">The state of the phone alerts could not be loaded. Please reload the page.</p>
        ) : (
          <>
            {!s.configured ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="push-keys-missing">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>The keys for phone alerts are not created yet. Press the button once: it creates the keys of the platform. Nothing else is needed.</span>
              </div>
            ) : (
              <div className="space-y-2" data-testid="push-keys-ready">
                <Badge className="gap-1 bg-green-600 text-xs text-white"><CheckCircle2 className="h-3 w-3" /> Keys created</Badge>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{s.devices === 1 ? '1 device turned on' : `${s.devices} devices turned on`}</Badge>
                  <Badge variant="outline" className="text-[10px]">{s.consultants === 1 ? '1 consultant' : `${s.consultants} consultants`}</Badge>
                  {s.failed_24h > 0 && <Badge variant="outline" className="text-[10px]">{s.failed_24h === 1 ? '1 device with a failed alert in the last 24 hours' : `${s.failed_24h} devices with a failed alert in the last 24 hours`}</Badge>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!s.configured && (
                <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending} className="gap-1.5">
                  {generate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create the keys for phone alerts
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => statusQ.refetch()} disabled={statusQ.isFetching} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

