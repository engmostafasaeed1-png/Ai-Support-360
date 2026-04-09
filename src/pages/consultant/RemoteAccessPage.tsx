import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Monitor, Server, Terminal, Laptop } from 'lucide-react';
import { useRemoteEnvironments, type RemoteEnvironment } from '@/hooks/useRemoteEnvironments';
import { useEnvironmentConnections, type EnvironmentConnection } from '@/hooks/useEnvironmentConnections';
import GuacamoleViewer from '@/components/remote/GuacamoleViewer';
import CredentialsManager from '@/components/remote/CredentialsManager';
import { useEnvironmentTracking } from '@/hooks/useEnvironmentTracking';
import { useState } from 'react';

const protocolIcons = { rdp: Monitor, ssh: Terminal, vnc: Laptop };

function ConnectionPicker({ envId, envName, envUrl, envOsType, onConnect }: {
  envId: string;
  envName: string;
  envUrl: string;
  envOsType: string | null;
  onConnect: (url: string, name: string) => void;
}) {
  const { data: connections, isLoading } = useEnvironmentConnections(envId);

  if (isLoading) return <Skeleton className="h-20 rounded-xl" />;

  const conns = connections && connections.length > 0 ? connections : null;

  if (!conns) {
    return (
      <Button className="w-full gradient-primary border-0" onClick={() => onConnect(envUrl, envName)}>
        <Monitor className="w-4 h-4 me-2" /> Connect
      </Button>
    );
  }

  return (
    <div className="space-y-2 mt-3 pt-3 border-t border-border/30">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Connections</p>
      {conns.map((conn) => {
        const Icon = protocolIcons[conn.protocol] || Monitor;
        return (
          <Button
            key={conn.id}
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 h-8 text-xs"
            onClick={(e) => { e.stopPropagation(); onConnect(conn.guacamole_url, `${envName} — ${conn.name}`); }}
          >
            <Icon className="w-3.5 h-3.5" />
            {conn.name}
            <Badge variant="outline" className="text-[9px] ms-auto">{conn.protocol.toUpperCase()}</Badge>
            {conn.is_default && <Badge variant="secondary" className="text-[9px]">Default</Badge>}
          </Button>
        );
      })}
    </div>
  );
}

export default function RemoteAccessPage() {
  const { t } = useTranslation();
  const { data: environments, isLoading } = useRemoteEnvironments();
  const [activeConn, setActiveConn] = useState<{ envId: string; url: string; name: string } | null>(null);
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
          <Server className="w-6 h-6 text-primary" /> Remote Access
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Connect to client environments via remote desktop</p>
      </div>

      {activeConn ? (
        <div className="space-y-4">
          <button
            onClick={() => { setActiveConn(null); }}
            className="text-sm text-primary hover:underline"
          >
            ← Back to environments
          </button>
          <GuacamoleViewer
            url={activeConn.url}
            name={activeConn.name}
            onConnect={() => trackConnect(activeConn.envId)}
            onDisconnect={trackDisconnect}
          />
        </div>
      ) : activeEnvs.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No environments assigned to you yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Contact admin to get access to client environments</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {activeEnvs.map((env) => (
            <Card key={env.id} className="rounded-2xl border-border/50">
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Monitor className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{env.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="default" className="text-[10px]">Active</Badge>
                      <Badge variant="outline" className="text-[10px]">{env.platform_type === 'vmware' ? 'VMware' : env.platform_type}</Badge>
                      <span className="text-xs text-muted-foreground">{env.os_type}</span>
                    </div>
                    {env.vm_name && <p className="text-xs text-muted-foreground/70 mt-1 font-mono">{env.vm_name}</p>}
                    {env.notes && <p className="text-xs text-muted-foreground mt-2">{env.notes}</p>}
                    <ConnectionPicker
                      envId={env.id}
                      envName={env.name}
                      envUrl={env.guacamole_url}
                      envOsType={env.os_type}
                      onConnect={(url, name) => setActiveConn({ envId: env.id, url, name })}
                    />
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
