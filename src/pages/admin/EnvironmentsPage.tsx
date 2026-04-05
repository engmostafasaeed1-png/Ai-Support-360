import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Monitor, Plus, Pencil, Trash2, Server, ChevronDown, ChevronUp } from 'lucide-react';
import {
  useRemoteEnvironments, useCreateEnvironment, useUpdateEnvironment, useDeleteEnvironment,
  type RemoteEnvironment,
} from '@/hooks/useRemoteEnvironments';
import ConnectionsManager from '@/components/remote/ConnectionsManager';

const statusColors: Record<string, 'default' | 'secondary' | 'destructive'> = {
  active: 'default',
  inactive: 'destructive',
  maintenance: 'secondary',
};

function EnvironmentForm({ env, onSubmit, onCancel }: {
  env?: RemoteEnvironment;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(env?.name || '');
  const [guacamoleUrl, setGuacamoleUrl] = useState(env?.guacamole_url || '');
  const [clientId, setClientId] = useState(env?.client_id || '');
  const [consultantId, setConsultantId] = useState(env?.consultant_id || '');
  const [status, setStatus] = useState(env?.status || 'active');
  const [osType, setOsType] = useState(env?.os_type || 'Windows Server 2022');
  const [notes, setNotes] = useState(env?.notes || '');

  // Fetch clients (users with client role)
  const { data: clients } = useQuery({
    queryKey: ['admin-clients-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'client');
      if (error) throw error;
      const userIds = (data || []).map(r => r.user_id);
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      return (profiles || []).map(p => ({ id: p.user_id, name: p.display_name || p.user_id }));
    },
  });

  // Fetch consultants
  const { data: consultants } = useQuery({
    queryKey: ['admin-consultants-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultants')
        .select('id, user_id');
      if (error) throw error;
      const userIds = (data || []).map(c => c.user_id);
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name]));
      return (data || []).map(c => ({ id: c.id, name: profileMap[c.user_id] || c.user_id }));
    },
  });

  const handleSubmit = () => {
    onSubmit({
      name,
      guacamole_url: guacamoleUrl,
      client_id: clientId,
      consultant_id: consultantId || null,
      status,
      os_type: osType,
      notes: notes || null,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-foreground">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production Server 01" />
      </div>
      <div>
        <label className="text-sm font-medium text-foreground">Guacamole URL</label>
        <Input value={guacamoleUrl} onChange={(e) => setGuacamoleUrl(e.target.value)} placeholder="https://guac.example.com/#/client/..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">Client</label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger><SelectValue placeholder="Select client..." /></SelectTrigger>
            <SelectContent>
              {(clients || []).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">Consultant (optional)</label>
          <Select value={consultantId || 'none'} onValueChange={(v) => setConsultantId(v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Select consultant..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {(consultants || []).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-foreground">Status</label>
          <Select value={status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">OS Type</label>
          <Input value={osType} onChange={(e) => setOsType(e.target.value)} placeholder="Windows Server 2022" />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-foreground">Notes</label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." rows={2} />
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline" onClick={onCancel}>Cancel</Button></DialogClose>
        <Button className="gradient-primary border-0" onClick={handleSubmit}>
          {env ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </div>
  );
}

function useEnvironmentNames(environments: RemoteEnvironment[] | undefined) {
  const clientIds = useMemo(() => [...new Set((environments || []).map(e => e.client_id))], [environments]);
  const consultantIds = useMemo(() => [...new Set((environments || []).filter(e => e.consultant_id).map(e => e.consultant_id!))], [environments]);

  const { data: clientProfiles } = useQuery({
    queryKey: ['env-client-names', clientIds],
    queryFn: async () => {
      if (clientIds.length === 0) return [];
      const { data } = await supabase.from('profiles').select('user_id, display_name').in('user_id', clientIds);
      return data || [];
    },
    enabled: clientIds.length > 0,
  });

  const { data: consultantProfiles } = useQuery({
    queryKey: ['env-consultant-names', consultantIds],
    queryFn: async () => {
      if (consultantIds.length === 0) return [];
      const { data: cons } = await supabase.from('consultants').select('id, user_id').in('id', consultantIds);
      if (!cons?.length) return [];
      const userIds = cons.map(c => c.user_id);
      const { data: profiles } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name]));
      return cons.map(c => ({ consultant_id: c.id, name: profileMap[c.user_id] || c.user_id }));
    },
    enabled: consultantIds.length > 0,
  });

  const clientMap = useMemo(() => Object.fromEntries((clientProfiles || []).map(p => [p.user_id, p.display_name || 'Unnamed'])), [clientProfiles]);
  const consultantMap = useMemo(() => Object.fromEntries((consultantProfiles || []).map(p => [p.consultant_id, p.name])), [consultantProfiles]);

  return { clientMap, consultantMap };
}

export default function EnvironmentsPage() {
  const { t } = useTranslation();
  const { data: environments, isLoading } = useRemoteEnvironments();
  const { clientMap, consultantMap } = useEnvironmentNames(environments);
  const createEnv = useCreateEnvironment();
  const updateEnv = useUpdateEnvironment();
  const deleteEnv = useDeleteEnvironment();
  const [editEnv, setEditEnv] = useState<RemoteEnvironment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Server className="w-6 h-6 text-primary" /> Remote Environments
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage VMware/Windows environments for consultant access</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-primary border-0 gap-1.5"><Plus className="w-4 h-4" /> Add Environment</Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader><DialogTitle>Create Environment</DialogTitle></DialogHeader>
            <EnvironmentForm
              onSubmit={(data) => { createEnv.mutate(data); setCreateOpen(false); }}
              onCancel={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {(!environments || environments.length === 0) ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No remote environments configured yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add your first VMware/Windows environment above</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {environments.map((env) => (
            <Card key={env.id} className="rounded-2xl border-border/50">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Monitor className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{env.name}</h3>
                        <Badge variant={statusColors[env.status]}>{env.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{env.os_type}</p>
                      <p className="text-xs text-muted-foreground/60 mt-1 truncate max-w-md">{env.guacamole_url}</p>
                      {env.notes && <p className="text-xs text-muted-foreground mt-2">{env.notes}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setExpandedEnv(expandedEnv === env.id ? null : env.id)}
                    >
                      {expandedEnv === env.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="icon" onClick={() => setEditEnv(env)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="rounded-2xl">
                        <DialogHeader><DialogTitle>Edit Environment</DialogTitle></DialogHeader>
                        <EnvironmentForm
                          env={env}
                          onSubmit={(data) => updateEnv.mutate({ id: env.id, ...data })}
                          onCancel={() => setEditEnv(null)}
                        />
                      </DialogContent>
                    </Dialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="icon" className="text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-2xl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Environment</AlertDialogTitle>
                          <AlertDialogDescription>This will permanently remove "{env.name}". This action cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteEnv.mutate(env.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                {expandedEnv === env.id && (
                  <div className="mt-4 pt-4 border-t border-border/30">
                    <ConnectionsManager environmentId={env.id} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
