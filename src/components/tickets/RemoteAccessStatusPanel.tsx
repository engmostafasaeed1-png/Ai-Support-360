import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Server, CheckCircle2, AlertCircle, Clock, RefreshCw, ArrowUpRight,
  PauseCircle, Wrench, XCircle, Info,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  ticketId: string;
  role: 'client' | 'consultant';
}

type EnvStatus = 'active' | 'inactive' | 'maintenance' | 'hold' | 'cancelled';

const STATUS_META: Record<EnvStatus, {
  label: string;
  color: string;
  badgeClass: string;
  icon: typeof CheckCircle2;
  ready: boolean;
}> = {
  active:      { label: 'Ready',        color: 'text-emerald-600',  badgeClass: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, ready: true },
  inactive:    { label: 'Inactive',     color: 'text-muted-foreground', badgeClass: 'bg-muted text-muted-foreground', icon: PauseCircle, ready: false },
  maintenance: { label: 'Maintenance',  color: 'text-amber-600',    badgeClass: 'bg-amber-100 text-amber-700', icon: Wrench, ready: false },
  hold:        { label: 'On Hold',      color: 'text-orange-600',   badgeClass: 'bg-orange-100 text-orange-700', icon: AlertCircle, ready: false },
  cancelled:   { label: 'Cancelled',    color: 'text-red-600',      badgeClass: 'bg-red-100 text-red-700', icon: XCircle, ready: false },
};

export default function RemoteAccessStatusPanel({ ticketId, role }: Props) {
  const base = role === 'client' ? '/client' : '/consultant';

  const { data, isLoading } = useQuery({
    queryKey: ['remote-access-status', ticketId],
    queryFn: async () => {
      const { data: envs } = await supabase
        .from('remote_environments')
        .select('id, name, status, platform_type, vm_name, ip_address, updated_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });

      if (!envs || envs.length === 0) return { env: null, lastSession: null };

      const env = envs[0];
      const { data: sessions } = await supabase
        .from('environment_sessions')
        .select('connected_at, disconnected_at, duration_minutes')
        .eq('environment_id', env.id)
        .order('connected_at', { ascending: false })
        .limit(1);

      return { env, lastSession: sessions?.[0] || null };
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-32 rounded-2xl" />;
  }

  // No environment provisioned for this ticket
  if (!data?.env) {
    return (
      <Card className="rounded-2xl border-dashed border-border/60">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center shrink-0">
            <Server className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Remote Access — Not Provisioned</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              No remote environment is linked to this ticket yet.
            </p>
          </div>
          {role === 'client' && (
            <Button asChild size="sm" variant="outline" className="gap-1.5 shrink-0">
              <Link to={`${base}/remote-access?ticket=${ticketId}`}>
                <ArrowUpRight className="w-3.5 h-3.5" /> Set Up
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const { env, lastSession } = data;
  const meta = STATUS_META[env.status as EnvStatus] || STATUS_META.inactive;
  const StatusIcon = meta.icon;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Server className="w-4 h-4 text-accent" />
          Remote Access Status
          <Badge variant="secondary" className={`text-[10px] gap-1 ${meta.badgeClass}`}>
            <StatusIcon className="w-3 h-3" /> {meta.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Environment summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <Field label="Environment" value={env.name} />
          {env.platform_type && <Field label="Platform" value={env.platform_type} />}
          {env.vm_name && <Field label="VM" value={env.vm_name} />}
          {env.ip_address && <Field label="IP Address" value={env.ip_address} mono />}
          <Field
            label="Last Connected"
            value={lastSession?.connected_at
              ? formatDistanceToNow(new Date(lastSession.connected_at), { addSuffix: true })
              : 'Never'}
          />
          {lastSession?.duration_minutes != null && (
            <Field label="Last Session" value={`${lastSession.duration_minutes} min`} />
          )}
        </div>

        {/* Reconnect / troubleshooting block */}
        {!meta.ready ? (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-3 text-xs space-y-2">
            <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> How to reconnect
            </p>
            <ol className="list-decimal ms-4 space-y-1 text-amber-900/90 dark:text-amber-200/80">
              <li>Wait for the environment to leave <strong>{meta.label.toLowerCase()}</strong> state.</li>
              <li>Refresh the Remote Access page or use the reconnect button below.</li>
              <li>If the issue persists, contact your consultant or admin to restart the VM.</li>
            </ol>
          </div>
        ) : (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 p-3 text-xs">
            <p className="text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Access is ready. Click <strong>Open Remote Access</strong> to connect.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" className="gap-1.5 gradient-primary border-0">
            <Link to={`${base}/remote-access?ticket=${ticketId}&env=${env.id}`}>
              <ArrowUpRight className="w-3.5 h-3.5" /> Open Remote Access
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reconnect
          </Button>
          <span className="ms-auto text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> Updated {formatDistanceToNow(new Date(env.updated_at), { addSuffix: true })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-lg p-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-xs font-medium text-foreground truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}
