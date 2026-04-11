import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Monitor, Wifi, WifiOff, Clock, ExternalLink, Search,
  Copy, RefreshCw, Shield, Users, Pencil, Loader2,
} from 'lucide-react';
import {
  useAnyDeskStatus,
  useAnyDeskClients,
  useAnyDeskSessions,
  useAnyDeskLicense,
  useAnyDeskConnectionLink,
  useAnyDeskSetAlias,
  type AnyDeskClient,
  type AnyDeskSession,
} from '@/hooks/useAnyDesk';
import { format } from 'date-fns';

export default function AnyDeskPanel() {
  const [tab, setTab] = useState('clients');
  const [search, setSearch] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const {
    data: status,
    isLoading: isStatusLoading,
    error: statusError,
    refetch: refetchStatus,
  } = useAnyDeskStatus();

  const isConfigured = status?.configured ?? false;
  const statusLabel = isStatusLoading ? 'Checking' : isConfigured ? 'Integrated' : 'Setup Required';

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Monitor className="w-4 h-4 text-red-500" />
            </div>
            AnyDesk Remote Access
          </CardTitle>
          <Badge variant="outline" className="text-[10px] gap-1">
             <Shield className="w-3 h-3" /> {statusLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
         {isStatusLoading ? (
           <div className="space-y-2">
             {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
           </div>
         ) : statusError ? (
           <div className="text-center py-8">
             <p className="text-sm text-muted-foreground mb-2">Unable to check AnyDesk status</p>
             <p className="text-xs text-destructive mb-3">{(statusError as Error).message}</p>
             <Button variant="outline" size="sm" onClick={() => refetchStatus()} className="gap-1.5">
               <RefreshCw className="w-3.5 h-3.5" /> Retry
             </Button>
           </div>
         ) : !isConfigured ? (
           <div className="text-center py-8">
             <Shield className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
             <p className="text-sm font-medium text-muted-foreground">AnyDesk Not Configured</p>
             <p className="text-xs text-muted-foreground/60 mt-1">
               This optional integration stays disabled until an administrator adds the AnyDesk API key to the backend.
             </p>
           </div>
         ) : (
           <Tabs value={tab} onValueChange={setTab}>
             <TabsList className="w-full">
               <TabsTrigger value="clients" className="flex-1 gap-1.5">
                 <Users className="w-3.5 h-3.5" /> Clients
               </TabsTrigger>
               <TabsTrigger value="sessions" className="flex-1 gap-1.5">
                 <Clock className="w-3.5 h-3.5" /> Sessions
               </TabsTrigger>
               <TabsTrigger value="license" className="flex-1 gap-1.5">
                 <Shield className="w-3.5 h-3.5" /> License
               </TabsTrigger>
             </TabsList>

             <TabsContent value="clients" className="mt-4 space-y-3">
               <div className="flex gap-2">
                 <div className="relative flex-1">
                   <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                   <Input
                     placeholder="Search clients..."
                     value={search}
                     onChange={e => setSearch(e.target.value)}
                     className="ps-9 h-8 text-sm"
                   />
                 </div>
                 <Button
                   variant={onlineOnly ? 'default' : 'outline'}
                   size="sm"
                   className="gap-1.5 h-8 text-xs"
                   onClick={() => setOnlineOnly(!onlineOnly)}
                 >
                   <Wifi className="w-3.5 h-3.5" /> Online Only
                 </Button>
               </div>
               <ClientsList search={search} onlineOnly={onlineOnly} enabled={isConfigured} />
             </TabsContent>

             <TabsContent value="sessions" className="mt-4">
               <SessionsList enabled={isConfigured} />
             </TabsContent>

             <TabsContent value="license" className="mt-4">
               <LicenseInfo enabled={isConfigured} />
             </TabsContent>
           </Tabs>
         )}
      </CardContent>
    </Card>
  );
}

function ClientsList({ search, onlineOnly, enabled }: { search: string; onlineOnly: boolean; enabled: boolean }) {
  const { data, isLoading, error, refetch } = useAnyDeskClients(onlineOnly, enabled);
  const connectionLink = useAnyDeskConnectionLink();
  const setAlias = useAnyDeskSetAlias();
  const [aliasDialog, setAliasDialog] = useState<{ clientId: string; currentAlias: string } | null>(null);
  const [newAlias, setNewAlias] = useState('');

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;

  if (error) {
    const errorMsg = (error as Error).message || '';
    const normalizedError = errorMsg.toLowerCase();
    const isNotConfigured = normalizedError.includes('not configured') || normalizedError.includes('status 503');
    if (isNotConfigured) {
      return (
        <div className="text-center py-8">
          <Shield className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-muted-foreground">AnyDesk Not Configured</p>
          <p className="text-xs text-muted-foreground/60 mt-1">API credentials need to be set up by an administrator to enable this integration.</p>
        </div>
      );
    }
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground mb-2">Unable to load AnyDesk clients</p>
        <p className="text-xs text-destructive mb-3">{errorMsg}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </Button>
      </div>
    );
  }

  const clients = (data?.clients ?? []).filter((client: AnyDeskClient) =>
    !search || client.alias?.toLowerCase().includes(search.toLowerCase()) || String(client.cid || client.id).includes(search)
  );

  const handleConnect = async (clientId: string) => {
    try {
      const result = await connectionLink.mutateAsync(clientId);
      window.open(result.uri, '_blank');
      toast.success('Opening AnyDesk connection...');
    } catch {
      toast.error('Failed to generate connection link');
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success('AnyDesk ID copied');
  };

  const handleSaveAlias = async () => {
    if (!aliasDialog) return;
    try {
      await setAlias.mutateAsync({ clientId: aliasDialog.clientId, alias: newAlias });
      toast.success('Alias updated');
      setAliasDialog(null);
    } catch {
      toast.error('Failed to update alias');
    }
  };

  return (
    <>
      {clients.length === 0 ? (
        <div className="text-center py-8">
          <Monitor className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No AnyDesk clients found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((client: AnyDeskClient) => {
            const id = client.cid || client.id || '';
            const isOnline = client.online || client.status === 'online';
            return (
              <Card key={id} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isOnline ? 'bg-green-500/10' : 'bg-muted/50'}`}>
                    {isOnline ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground truncate">
                        {client.alias || `Client ${id}`}
                      </span>
                      <Badge variant={isOnline ? 'default' : 'secondary'} className="text-[9px]">
                        {isOnline ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">ID: {id}</p>
                    {client.os && <p className="text-[10px] text-muted-foreground">{client.os}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Copy ID" onClick={() => handleCopyId(String(id))}>
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Set Alias"
                      onClick={() => { setAliasDialog({ clientId: String(id), currentAlias: client.alias || '' }); setNewAlias(client.alias || ''); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {isOnline && (
                      <Button size="sm" className="h-7 text-xs gap-1 gradient-primary border-0" onClick={() => handleConnect(String(id))}>
                        <ExternalLink className="w-3 h-3" /> Connect
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Alias Dialog */}
      <Dialog open={!!aliasDialog} onOpenChange={(v) => { if (!v) setAliasDialog(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Client Alias</DialogTitle>
          </DialogHeader>
          <Input value={newAlias} onChange={e => setNewAlias(e.target.value)} placeholder="Enter alias name..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAliasDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveAlias} disabled={setAlias.isPending} className="gradient-primary border-0 gap-1.5">
              {setAlias.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SessionsList({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useAnyDeskSessions(undefined, enabled);

  if (isLoading) return <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>;

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">Unable to load sessions</p>
        <p className="text-xs text-destructive">{(error as Error).message}</p>
      </div>
    );
  }

  const sessions = data?.sessions ?? [];

  if (sessions.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No session history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session: AnyDeskSession, idx: number) => (
        <Card key={session.sid || idx} className="rounded-xl border-border/30">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {session.source?.alias || session.source?.cid || 'Unknown'} → {session.destination?.alias || session.destination?.cid || 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {session.start && (
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(session.start), 'MMM d, yyyy HH:mm')}
                    </span>
                  )}
                  {session.duration && (
                    <Badge variant="outline" className="text-[9px]">
                      {Math.round(session.duration / 60)}min
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LicenseInfo({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useAnyDeskLicense(enabled);

  if (isLoading) return <Skeleton className="h-32 rounded-xl" />;

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">Unable to load license info</p>
        <p className="text-xs text-destructive">{(error as Error).message}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-3">
      <Card className="rounded-xl border-border/30">
        <CardContent className="p-4 space-y-2">
          {data.name && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">License</span>
              <span className="font-medium text-foreground">{data.name}</span>
            </div>
          )}
          {data.expires && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Expires</span>
              <span className="font-medium text-foreground">{format(new Date(data.expires), 'MMM d, yyyy')}</span>
            </div>
          )}
          {data.max_clients != null && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Clients</span>
              <span className="font-medium text-foreground">{data.max_clients}</span>
            </div>
          )}
          {data.max_sessions != null && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Sessions</span>
              <span className="font-medium text-foreground">{data.max_sessions}</span>
            </div>
          )}
          {data.namespaces && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Namespaces</span>
              <span className="font-medium text-foreground">{Array.isArray(data.namespaces) ? data.namespaces.join(', ') : data.namespaces}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
