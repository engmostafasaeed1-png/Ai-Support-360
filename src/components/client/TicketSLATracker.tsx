import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, AlertTriangle, CheckCircle2, Timer } from 'lucide-react';
import { formatDistanceToNow, differenceInMinutes, addMinutes } from 'date-fns';

interface Props {
  ticketId: string;
  urgency: string;
  status: string;
  createdAt: string;
  slaDeadline: string | null;
  firstResponseAt: string | null;
  slaBreach: boolean;
}

export default function TicketSLATracker({ ticketId, urgency, status, createdAt, slaDeadline, firstResponseAt, slaBreach }: Props) {
  const { data: policy } = useQuery({
    queryKey: ['sla-policy', urgency],
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_sla_policies')
        .select('*')
        .eq('urgency', urgency)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const isResolved = ['resolved', 'closed'].includes(status);
  const now = new Date();
  const created = new Date(createdAt);

  // Calculate SLA times
  const responseDeadline = policy
    ? addMinutes(created, policy.response_time_minutes)
    : slaDeadline ? new Date(slaDeadline) : null;
  const resolutionDeadline = policy
    ? addMinutes(created, policy.resolution_time_minutes)
    : null;

  const responseBreached = responseDeadline && !firstResponseAt && now > responseDeadline;
  const resolutionBreached = resolutionDeadline && !isResolved && now > resolutionDeadline;
  const isBreached = slaBreach || responseBreached || resolutionBreached;

  const responseMinutesLeft = responseDeadline && !firstResponseAt
    ? differenceInMinutes(responseDeadline, now)
    : null;
  const resolutionMinutesLeft = resolutionDeadline && !isResolved
    ? differenceInMinutes(resolutionDeadline, now)
    : null;

  return (
    <Card className={`rounded-2xl overflow-hidden ${
      isBreached ? 'border-red-300 bg-red-50/30' :
      (responseMinutesLeft !== null && responseMinutesLeft < 30) || (resolutionMinutesLeft !== null && resolutionMinutesLeft < 60)
        ? 'border-amber-300 bg-amber-50/30'
        : 'border-border/50'
    }`}>
      {/* Header */}
      <div className={`px-4 py-2.5 flex items-center gap-2 text-sm font-semibold ${
        isBreached ? 'bg-red-100 text-red-700' :
        isResolved ? 'bg-green-100 text-green-700' :
        'bg-muted/30 text-foreground'
      }`}>
        {isBreached ? <AlertTriangle className="w-4 h-4" /> :
         isResolved ? <CheckCircle2 className="w-4 h-4" /> :
         <Timer className="w-4 h-4" />}
        {isBreached ? 'SLA Breached' : isResolved ? 'SLA Met' : 'SLA Tracking'}
        {policy && (
          <Badge variant="secondary" className="text-[10px] ms-auto">{policy.name}</Badge>
        )}
      </div>

      <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-3">
          {/* Response Time */}
          <div className="p-3 rounded-xl bg-muted/20 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">First Response</p>
            {firstResponseAt ? (
              <div>
                <p className="text-sm font-bold text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Responded
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(firstResponseAt), { addSuffix: true })}
                </p>
              </div>
            ) : responseDeadline ? (
              <div>
                <p className={`text-sm font-bold flex items-center gap-1 ${
                  responseBreached ? 'text-red-600' :
                  responseMinutesLeft !== null && responseMinutesLeft < 30 ? 'text-amber-600' :
                  'text-foreground'
                }`}>
                  {responseBreached ? (
                    <><AlertTriangle className="w-3.5 h-3.5" /> Overdue</>
                  ) : (
                    <><Clock className="w-3.5 h-3.5" /> {formatTimeLeft(responseMinutesLeft)}</>
                  )}
                </p>
                {policy && (
                  <p className="text-[10px] text-muted-foreground">Target: {policy.response_time_minutes}min</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No SLA set</p>
            )}
          </div>

          {/* Resolution Time */}
          <div className="p-3 rounded-xl bg-muted/20 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Resolution</p>
            {isResolved ? (
              <div>
                <p className="text-sm font-bold text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Resolved
                </p>
              </div>
            ) : resolutionDeadline ? (
              <div>
                <p className={`text-sm font-bold flex items-center gap-1 ${
                  resolutionBreached ? 'text-red-600' :
                  resolutionMinutesLeft !== null && resolutionMinutesLeft < 60 ? 'text-amber-600' :
                  'text-foreground'
                }`}>
                  {resolutionBreached ? (
                    <><AlertTriangle className="w-3.5 h-3.5" /> Overdue</>
                  ) : (
                    <><Clock className="w-3.5 h-3.5" /> {formatTimeLeft(resolutionMinutesLeft)}</>
                  )}
                </p>
                {policy && (
                  <p className="text-[10px] text-muted-foreground">Target: {formatTimeLeft(policy.resolution_time_minutes)}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No SLA set</p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {resolutionDeadline && !isResolved && resolutionMinutesLeft !== null && (
          <div className="mt-3">
            <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  resolutionBreached ? 'bg-red-500' :
                  resolutionMinutesLeft < 60 ? 'bg-amber-500' :
                  'bg-primary/60'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(0,
                    ((policy?.resolution_time_minutes || 1440) - (resolutionMinutesLeft || 0)) /
                    (policy?.resolution_time_minutes || 1440) * 100
                  ))}%`
                }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatTimeLeft(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 0) return 'Overdue';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
