import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Monitor, Server } from 'lucide-react';
import { useRemoteEnvironments, type RemoteEnvironment } from '@/hooks/useRemoteEnvironments';
import GuacamoleViewer from '@/components/remote/GuacamoleViewer';
import { useEnvironmentTracking } from '@/hooks/useEnvironmentTracking';
import { useState } from 'react';

export default function ClientRemoteAccessPage() {
  const { data: environments, isLoading } = useRemoteEnvironments();
  const [selectedEnv, setSelectedEnv] = useState<RemoteEnvironment | null>(null);
  const { trackConnect, trackDisconnect } = useEnvironmentTracking();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const activeEnvs = (environments || []).filter(e => e.status === 'active');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Server className="w-6 h-6 text-primary" /> My Environments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">View your remote desktop environments</p>
      </div>

      {selectedEnv ? (
        <div className="space-y-4">
          <button onClick={() => setSelectedEnv(null)} className="text-sm text-primary hover:underline">
            ← Back to environments
          </button>
          <GuacamoleViewer url={selectedEnv.guacamole_url} name={selectedEnv.name} osType={selectedEnv.os_type} onConnect={() => trackConnect(selectedEnv.id)} onDisconnect={trackDisconnect} />
        </div>
      ) : activeEnvs.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No environments set up yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {activeEnvs.map((env) => (
            <Card key={env.id} className="rounded-2xl border-border/50 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setSelectedEnv(env)}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Monitor className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{env.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="default" className="text-[10px]">Active</Badge>
                      <span className="text-xs text-muted-foreground">{env.os_type}</span>
                    </div>
                    {env.notes && <p className="text-xs text-muted-foreground mt-2">{env.notes}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
