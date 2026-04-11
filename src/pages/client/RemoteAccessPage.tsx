import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Monitor, Server, Terminal, Laptop, Plus, Pencil, Trash2, Pause, Play, XCircle,
} from 'lucide-react';
import { useRemoteEnvironments, useCreateEnvironment, useUpdateEnvironment, useDeleteEnvironment, type RemoteEnvironment } from '@/hooks/useRemoteEnvironments';
import { useEnvironmentConnections } from '@/hooks/useEnvironmentConnections';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import GuacamoleViewer from '@/components/remote/GuacamoleViewer';
import CredentialsManager from '@/components/remote/CredentialsManager';
import ConnectionsManager from '@/components/remote/ConnectionsManager';
import AnyDeskPanel from '@/components/remote/AnyDeskPanel';
import { useEnvironmentTracking } from '@/hooks/useEnvironmentTracking';

const protocolIcons: Record<string, any> = { rdp: Monitor, ssh: Terminal, vnc: Laptop };

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  active: { label: 'Active', variant: 'default' },
  inactive: { label: 'Inactive', variant: 'destructive' },
  maintenance: { label: 'Maintenance', variant: 'secondary' },
  hold: { label: 'On Hold', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

function useClientTickets() {
  return useQuery({
    queryKey: ['client-tickets-for-env'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('tickets')
        .select('id, title, sap_module')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    },
  });
}

function EnvironmentFormDialog({
  env,
  open,
  onOpenChange,
  onSubmit,
}: {
  env?: RemoteEnvironment;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: any) => void;
}) {
  const { t } = useTranslation();
  const { data: tickets } = useClientTickets();
  const [name, setName] = useState(env?.name || '');
  const [guacamoleUrl, setGuacamoleUrl] = useState(env?.guacamole_url || '');
  const [status, setStatus] = useState(env?.status || 'active');
  const [osType, setOsType] = useState(env?.os_type || 'Windows Server 2022');
  const [platformType, setPlatformType] = useState(env?.platform_type || 'vmware');
  const [vmwareHost, setVmwareHost] = useState(env?.vmware_host || '');
  const [vmName, setVmName] = useState(env?.vm_name || '');
  const [ticketId, setTicketId] = useState(env?.ticket_id || '');
  const [notes, setNotes] = useState(env?.notes || '');

  const handleSubmit = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    onSubmit({
      name,
      guacamole_url: guacamoleUrl,
      client_id: user.id,
      status,
      os_type: osType,
      platform_type: platformType,
      vmware_host: vmwareHost || null,
      vm_name: vmName || null,
      ticket_id: ticketId || null,
      notes: notes || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{env ? t('remote.edit_env', 'Edit Environment') : t('remote.add_env', 'Setup New Environment')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground">{t('remote.env_name', 'Environment Name')}</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="SAP Production Server" className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground">{t('remote.guac_url', 'Remote Access URL')}</label>
            <Input value={guacamoleUrl} onChange={e => setGuacamoleUrl(e.target.value)} placeholder="https://guac.example.com/#/client/..." className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-foreground">{t('remote.platform', 'Platform')}</label>
              <Select value={platformType} onValueChange={setPlatformType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vmware">VMware</SelectItem>
                  <SelectItem value="hyperv">Hyper-V</SelectItem>
                  <SelectItem value="citrix">Citrix</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground">{t('remote.os', 'OS Type')}</label>
              <Select value={osType} onValueChange={setOsType}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Windows Server 2022">Windows Server 2022</SelectItem>
                  <SelectItem value="Windows Server 2019">Windows Server 2019</SelectItem>
                  <SelectItem value="Windows 11">Windows 11</SelectItem>
                  <SelectItem value="Windows 10">Windows 10</SelectItem>
                  <SelectItem value="Ubuntu Server">Ubuntu Server</SelectItem>
                  <SelectItem value="RHEL">RHEL</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {platformType === 'vmware' && (
              <div>
                <label className="text-xs font-medium text-foreground">{t('remote.vcenter', 'vCenter / ESXi Host')}</label>
                <Input value={vmwareHost} onChange={e => setVmwareHost(e.target.value)} placeholder="vcenter.example.com" className="h-8 text-sm" />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-foreground">{t('remote.vm_name', 'VM Name')}</label>
              <Input value={vmName} onChange={e => setVmName(e.target.value)} placeholder="SAP-PROD-VM01" className="h-8 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground">{t('remote.linked_ticket', 'Link to Ticket (optional)')}</label>
            <Select value={ticketId || 'none'} onValueChange={v => setTicketId(v === 'none' ? '' : v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select ticket..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {(tickets || []).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.title} ({t.sap_module})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground">{t('remote.notes', 'Notes')}</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional info..." rows={2} className="text-sm" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">{t('common.cancel', 'Cancel')}</Button></DialogClose>
          <Button className="gradient-primary border-0" onClick={handleSubmit} disabled={!name}>
            {env ? t('common.update', 'Update') : t('common.create', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionPicker({ envId, envName, envUrl, onConnect }: {
  envId: string; envName: string; envUrl: string;
  onConnect: (url: string, name: string) => void;
}) {
  const { data: connections, isLoading } = useEnvironmentConnections(envId);
  if (isLoading) return <Skeleton className="h-10 rounded-xl" />;
  const conns = connections && connections.length > 0 ? connections : null;
  if (!conns) {
    return (
      <Button className="w-full gradient-primary border-0 mt-3" onClick={() => onConnect(envUrl, envName)}>
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
          <Button key={conn.id} variant="outline" size="sm" className="w-full justify-start gap-2 h-8 text-xs"
            onClick={(e) => { e.stopPropagation(); onConnect(conn.guacamole_url, `${envName} — ${conn.name}`); }}>
            <Icon className="w-3.5 h-3.5" /> {conn.name}
            <Badge variant="outline" className="text-[9px] ms-auto">{conn.protocol.toUpperCase()}</Badge>
            {conn.is_default && <Badge variant="secondary" className="text-[9px]">Default</Badge>}
          </Button>
        );
      })}
    </div>
  );
}

function useTicketNames(ticketIds: string[]) {
  return useQuery({
    queryKey: ['ticket-names', ticketIds],
    queryFn: async () => {
      if (!ticketIds.length) return {};
      const { data } = await supabase.from('tickets').select('id, title').in('id', ticketIds);
      return Object.fromEntries((data || []).map(t => [t.id, t.title]));
    },
    enabled: ticketIds.length > 0,
  });
}

export default function ClientRemoteAccessPage() {
  const { t } = useTranslation();
  const { data: environments, isLoading } = useRemoteEnvironments();
  const createEnv = useCreateEnvironment();
  const updateEnv = useUpdateEnvironment();
  const deleteEnv = useDeleteEnvironment();
  const [activeConn, setActiveConn] = useState<{ envId: string; url: string; name: string } | null>(null);
  const { trackConnect, trackDisconnect } = useEnvironmentTracking();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEnv, setEditEnv] = useState<RemoteEnvironment | null>(null);
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null);

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

  if (activeConn) {
    return (
      <div className="space-y-4">
        <button onClick={() => setActiveConn(null)} className="text-sm text-primary hover:underline">
          ← Back to environments
        </button>
        <GuacamoleViewer url={activeConn.url} name={activeConn.name} onConnect={() => trackConnect(activeConn.envId)} onDisconnect={trackDisconnect} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Server className="w-6 h-6 text-primary" /> {t('remote.my_environments', 'My Environments')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('remote.client_subtitle', 'Setup and manage remote server environments for consultant access')}</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('remote.add_env', 'Add Environment')}
        </Button>
      </div>

      <EnvironmentFormDialog open={createOpen} onOpenChange={setCreateOpen}
        onSubmit={(data) => createEnv.mutate(data)} />

      {editEnv && (
        <EnvironmentFormDialog env={editEnv} open={!!editEnv} onOpenChange={(o) => { if (!o) setEditEnv(null); }}
          onSubmit={(data) => { updateEnv.mutate({ id: editEnv.id, ...data }); setEditEnv(null); }} />
      )}

      {envs.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">{t('remote.no_envs', 'No environments set up yet')}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('remote.no_envs_hint', 'Add your first VMware/Windows environment to get started')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {envs.map((env) => {
            const sc = statusConfig[env.status] || statusConfig.active;
            return (
              <Card key={env.id} className="rounded-2xl border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Monitor className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-foreground">{env.name}</h3>
                          <Badge variant={sc.variant} className="text-[10px]">{sc.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {env.platform_type === 'vmware' ? 'VMware' : env.platform_type === 'hyperv' ? 'Hyper-V' : env.platform_type}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {env.os_type}{env.vm_name && <> · <span className="font-mono">{env.vm_name}</span></>}
                        </p>
                        {env.ticket_id && ticketNames?.[env.ticket_id] && (
                          <p className="text-xs text-primary mt-1">🎫 {ticketNames[env.ticket_id]}</p>
                        )}
                        {env.notes && <p className="text-xs text-muted-foreground mt-1">{env.notes}</p>}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Status quick actions */}
                      {env.status === 'active' && (
                        <Button variant="outline" size="icon" className="h-8 w-8" title="Put on Hold"
                          onClick={() => updateEnv.mutate({ id: env.id, status: 'hold' })}>
                          <Pause className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {env.status === 'hold' && (
                        <Button variant="outline" size="icon" className="h-8 w-8 text-green-600" title="Reactivate"
                          onClick={() => updateEnv.mutate({ id: env.id, status: 'active' })}>
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {(env.status === 'active' || env.status === 'hold') && (
                        <Button variant="outline" size="icon" className="h-8 w-8 text-amber-600" title="Cancel"
                          onClick={() => updateEnv.mutate({ id: env.id, status: 'cancelled' })}>
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setEditEnv(env)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="icon" className="h-8 w-8 text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="rounded-2xl">
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('remote.delete_env', 'Delete Environment')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('remote.delete_env_desc', 'This will permanently remove "{{name}}" and all associated credentials. This action cannot be undone.', { name: env.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground"
                              onClick={() => deleteEnv.mutate(env.id)}>
                              {t('common.delete', 'Delete')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {/* Expandable section: credentials + connections */}
                  <div className="mt-4 pt-4 border-t border-border/30 space-y-4">
                    <CredentialsManager environmentId={env.id} canEdit={true} />
                    <ConnectionsManager environmentId={env.id} />
                    {env.status === 'active' && (
                      <ConnectionPicker envId={env.id} envName={env.name} envUrl={env.guacamole_url}
                        onConnect={(url, name) => setActiveConn({ envId: env.id, url, name })} />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* AnyDesk Integration */}
      <AnyDeskPanel />
    </div>
  );
}
