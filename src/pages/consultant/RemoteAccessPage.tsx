import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Monitor, Server, Terminal, Laptop, ShieldAlert, FileCheck, ExternalLink, Settings, Plug, Link2, Pencil } from 'lucide-react';
import { useRemoteEnvironments, type RemoteEnvironment } from '@/hooks/useRemoteEnvironments';
import { useEnvironmentConnections, type EnvironmentConnection } from '@/hooks/useEnvironmentConnections';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import GuacamoleViewer from '@/components/remote/GuacamoleViewer';
import CredentialsManager from '@/components/remote/CredentialsManager';
import NDASigningModal from '@/components/consultant/NDASigningModal';
import { useEnvironmentTracking } from '@/hooks/useEnvironmentTracking';
import AnyDeskPanel from '@/components/remote/AnyDeskPanel';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const protocolIcons: Record<string, any> = { rdp: Monitor, ssh: Terminal, vnc: Laptop };

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { label: 'Active', variant: 'default' },
  inactive: { label: 'Inactive', variant: 'destructive' },
  maintenance: { label: 'Maintenance', variant: 'secondary' },
  hold: { label: 'On Hold', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

function ConnectionPicker({ envId, envName, envUrl, onConnect }: {
  envId: string; envName: string; envUrl: string;
  onConnect: (url: string, name: string) => void;
}) {
  const { data: connections, isLoading } = useEnvironmentConnections(envId);
  if (isLoading) return <Skeleton className="h-20 rounded-xl" />;
  const conns = connections && connections.length > 0 ? connections : null;
  if (!conns) {
    return (
      <Button className="w-full gradient-primary border-0" onClick={() => onConnect(envUrl, envName)}>
        <Monitor className="w-4 h-4 me-2" /> Open Remote Session
      </Button>
    );
  }
  return (
    <div className="space-y-2 mt-3 pt-3 border-t border-border/30">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Open Remote Session</p>
      {conns.map((conn) => {
        const Icon = protocolIcons[conn.protocol] || Monitor;
        return (
          <Button key={conn.id} variant="outline" size="sm" className="w-full justify-start gap-2 h-9 text-xs"
            onClick={(e) => { e.stopPropagation(); onConnect(conn.guacamole_url, `${envName} — ${conn.name}`); }}>
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

function useNDAStatus(clientId?: string) {
  return useQuery({
    queryKey: ['nda-status', clientId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { signed: false, consultantId: null as string | null };
      const { data: consultant } = await supabase
        .from('consultants').select('id').eq('user_id', user.id).single();
      if (!consultant) return { signed: false, consultantId: null };
      const { data: nda } = await supabase
        .from('nda_agreements').select('id')
        .eq('consultant_id', consultant.id).eq('client_id', clientId!)
        .is('revoked_at', null).limit(1).maybeSingle();
      return { signed: !!nda, consultantId: consultant.id };
    },
    enabled: !!clientId,
  });
}

function useTicketNames(ticketIds: string[]) {
  return useQuery({
    queryKey: ['ticket-names-consultant', ticketIds],
    queryFn: async () => {
      if (!ticketIds.length) return {};
      const { data } = await supabase.from('tickets').select('id, title, sap_module').in('id', ticketIds);
      return Object.fromEntries((data || []).map(t => [t.id, { title: t.title, sap_module: t.sap_module }]));
    },
    enabled: ticketIds.length > 0,
  });
}

function EnvironmentCard({ env, ticketInfo, onConnect }: {
  env: RemoteEnvironment;
  ticketInfo?: { title: string; sap_module: string };
  onConnect: (envId: string, url: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: ndaStatus, isLoading: ndaLoading } = useNDAStatus(env.client_id);
  const [ndaModalOpen, setNdaModalOpen] = useState(false);

  const hasSigned = ndaStatus?.signed ?? false;
  const consultantId = ndaStatus?.consultantId;
  const sc = statusConfig[env.status] || statusConfig.active;
  const isAccessible = env.status === 'active';

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Monitor className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground">{env.name}</h3>
              <Badge variant={sc.variant} className="text-[10px]">{sc.label}</Badge>
              <Badge variant="outline" className="text-[10px]">
                {env.platform_type === 'vmware' ? 'VMware' : env.platform_type}
              </Badge>
              <span className="text-xs text-muted-foreground">{env.os_type}</span>
            </div>
            {env.vm_name && <p className="text-xs text-muted-foreground/70 mt-1 font-mono">{env.vm_name}</p>}

            {/* Linked ticket */}
            {env.ticket_id && ticketInfo && (
              <button
                onClick={() => navigate(`/consultant/cases/${env.ticket_id}`)}
                className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                🎫 {ticketInfo.title} <span className="text-muted-foreground">({ticketInfo.sap_module})</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}

            {env.notes && <p className="text-xs text-muted-foreground mt-2">{env.notes}</p>}

            {/* Quick action buttons */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                onClick={() => navigate('/consultant/settings')}>
                <Settings className="w-3 h-3" /> {t('remote.settings', 'Settings')}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                onClick={() => navigate('/consultant/remote-access')}>
                <Link2 className="w-3 h-3" /> {t('remote.connections', 'Connections')}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                onClick={() => navigate('/client/integrations')}>
                <Plug className="w-3 h-3" /> {t('remote.integrations', 'Integrations')}
              </Button>
            </div>

            {!isAccessible ? (
              <div className="mt-3 p-3 rounded-xl border border-border/30 bg-muted/20 text-center">
                <p className="text-xs text-muted-foreground">
                  {env.status === 'hold'
                    ? t('remote.env_on_hold', 'This environment is on hold by the client.')
                    : env.status === 'cancelled'
                    ? t('remote.env_cancelled', 'This environment has been cancelled.')
                    : t('remote.env_unavailable', 'This environment is currently unavailable.')}
                </p>
              </div>
            ) : ndaLoading ? (
              <Skeleton className="h-10 mt-3 rounded-xl" />
            ) : !hasSigned ? (
              <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {t('remote.nda_required', 'NDA Required')}
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t('remote.nda_required_desc', 'You must sign a Non-Disclosure Agreement before accessing this environment.')}
                </p>
                <Button size="sm" className="w-full gradient-primary border-0 h-8 text-xs"
                  onClick={() => setNdaModalOpen(true)}>
                  <FileCheck className="w-3.5 h-3.5 me-1.5" />
                  {t('remote.sign_nda', 'Sign NDA to Continue')}
                </Button>
                {consultantId && (
                  <NDASigningModal open={ndaModalOpen} onOpenChange={setNdaModalOpen}
                    clientId={env.client_id} consultantId={consultantId} />
                )}
              </div>
            ) : (
              <>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                  <FileCheck className="w-3.5 h-3.5" />
                  {t('remote.nda_signed', 'NDA Signed — Access Authorized')}
                </div>
                <div className="mt-3 pt-3 border-t border-border/30">
                  <CredentialsManager environmentId={env.id} canEdit={false} />
                </div>
                <ConnectionPicker envId={env.id} envName={env.name} envUrl={env.guacamole_url}
                  onConnect={(url, name) => onConnect(env.id, url, name)} />
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RemoteAccessPage() {
  const { t } = useTranslation();
  const { data: environments, isLoading } = useRemoteEnvironments();
  const [activeConn, setActiveConn] = useState<{ envId: string; url: string; name: string } | null>(null);
  const { trackConnect, trackDisconnect } = useEnvironmentTracking();

  const ticketIds = [...new Set((environments || []).filter(e => e.ticket_id).map(e => e.ticket_id!))];
  const { data: ticketNames } = useTicketNames(ticketIds);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const envs = environments || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Server className="w-6 h-6 text-primary" /> Remote Access
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Connect to client VMware environments via remote desktop</p>
      </div>

      {activeConn ? (
        <div className="space-y-4">
          <button onClick={() => setActiveConn(null)} className="text-sm text-primary hover:underline">
            ← Back to environments
          </button>
          <GuacamoleViewer url={activeConn.url} name={activeConn.name}
            onConnect={() => trackConnect(activeConn.envId)} onDisconnect={trackDisconnect} />
        </div>
      ) : envs.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No environments assigned to you yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Contact admin to get access to client environments</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {envs.map((env) => (
            <EnvironmentCard key={env.id} env={env}
              ticketInfo={env.ticket_id ? ticketNames?.[env.ticket_id] : undefined}
              onConnect={(envId, url, name) => setActiveConn({ envId, url, name })} />
          ))}
        </div>
      )}
    </div>
  );
}
