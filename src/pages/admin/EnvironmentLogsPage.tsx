import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, User, Monitor, Server, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface SessionLog {
  id: string;
  environment_id: string;
  user_id: string;
  connected_at: string;
  disconnected_at: string | null;
  duration_minutes: number | null;
  environment_name?: string;
  user_name?: string;
}

export default function EnvironmentLogsPage() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['environment-session-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('environment_sessions')
        .select('*')
        .order('connected_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Fetch environment names
      const envIds = [...new Set(data.map((s: any) => s.environment_id))];
      const { data: envs } = await supabase
        .from('remote_environments')
        .select('id, name')
        .in('id', envIds);
      const envMap = Object.fromEntries((envs || []).map(e => [e.id, e.name]));

      // Fetch user names
      const userIds = [...new Set(data.map((s: any) => s.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const userMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name]));

      return data.map((s: any) => ({
        ...s,
        environment_name: envMap[s.environment_id] || 'Unknown',
        user_name: userMap[s.user_id] || s.user_id,
      })) as SessionLog[];
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Clock className="w-6 h-6 text-primary" /> Session Logs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Track who connected to remote environments, when, and for how long</p>
      </div>

      {(!logs || logs.length === 0) ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Clock className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No session logs yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Logs will appear when users connect to remote environments</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => {
            const isActive = !log.disconnected_at;
            return (
              <Card key={log.id} className="rounded-2xl border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{log.user_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Monitor className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{log.environment_name}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(log.connected_at), 'PPp')}
                      </div>
                      {log.duration_minutes != null ? (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Clock className="w-2.5 h-2.5" /> {log.duration_minutes} min
                        </Badge>
                      ) : null}
                      {isActive ? (
                        <Badge variant="default" className="text-[10px] gap-1">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                          </span>
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">Ended</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
