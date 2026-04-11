import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Monitor, Plus, Pencil, Trash2, Server, ChevronDown, ChevronUp, Cpu, HardDrive, Globe, Network, Users } from 'lucide-react';
import {
  useRemoteEnvironments, useCreateEnvironment, useUpdateEnvironment, useDeleteEnvironment,
  type RemoteEnvironment,
} from '@/hooks/useRemoteEnvironments';
import ConnectionsManager from '@/components/remote/ConnectionsManager';

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  inactive: 'destructive',
  maintenance: 'secondary',
  hold: 'outline',
  cancelled: 'destructive',
};

// --- Hooks for assigned consultants ---
function useEnvironmentConsultants(envId?: string) {
  return useQuery({
    queryKey: ['env-consultants', envId],
    enabled: !!envId,
    queryFn: async () => {
      const { data } = await supabase
        .from('environment_consultants')
        .select('consultant_id')
        .eq('environment_id', envId!);
      return (data || []).map(r => r.consultant_id);
    },
  });
}

function useAllEnvConsultants(envIds: string[]) {
  return useQuery({
    queryKey: ['all-env-consultants', envIds],
    enabled: envIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('environment_consultants')
        .select('environment_id, consultant_id')
        .in('environment_id', envIds);
      const map: Record<string, string[]> = {};
      (data || []).forEach(r => {
        if (!map[r.environment_id]) map[r.environment_id] = [];
        map[r.environment_id].push(r.consultant_id);
      });
      return map;
    },
  });
}

// --- Environment Form ---
function EnvironmentForm({ env, onSubmit, onCancel }: {
  env?: RemoteEnvironment;
  onSubmit: (data: any, consultantIds: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(env?.name || '');
  const [description, setDescription] = useState((env as any)?.description || '');
  const [guacamoleUrl, setGuacamoleUrl] = useState(env?.guacamole_url || '');
  const [clientId, setClientId] = useState(env?.client_id || '');
  const [selectedConsultants, setSelectedConsultants] = useState<string[]>([]);
  const [status, setStatus] = useState(env?.status || 'active');
  const [osType, setOsType] = useState(env?.os_type || 'Windows Server 2022');
  const [platformType, setPlatformType] = useState(env?.platform_type || 'vmware');
  const [vmwareHost, setVmwareHost] = useState(env?.vmware_host || '');
  const [vmName, setVmName] = useState(env?.vm_name || '');
  const [notes, setNotes] = useState(env?.notes || '');
  const [ipAddress, setIpAddress] = useState((env as any)?.ip_address || '');
  const [cpuCores, setCpuCores] = useState<string>((env as any)?.cpu_cores?.toString() || '');
  const [ramGb, setRamGb] = useState<string>((env as any)?.ram_gb?.toString() || '');
  const [diskGb, setDiskGb] = useState<string>((env as any)?.disk_gb?.toString() || '');
  const [sapSid, setSapSid] = useState((env as any)?.sap_sid || '');
  const [sapClientNumber, setSapClientNumber] = useState((env as any)?.sap_client_number || '');
  const [accessType, setAccessType] = useState((env as any)?.access_type || 'rdp');
  const [region, setRegion] = useState((env as any)?.region || '');
  const [environmentType, setEnvironmentType] = useState((env as any)?.environment_type || 'production');

  // Load existing assigned consultants for edit mode
  const { data: existingConsultants } = useEnvironmentConsultants(env?.id);
  useEffect(() => {
    if (existingConsultants) setSelectedConsultants(existingConsultants);
  }, [existingConsultants]);

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

  const toggleConsultant = (id: string) => {
    setSelectedConsultants(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleSubmit = () => {
    onSubmit({
      name,
      description: description || null,
      guacamole_url: guacamoleUrl,
      client_id: clientId,
      consultant_id: selectedConsultants[0] || null, // keep backward compat
      status,
      os_type: osType,
      platform_type: platformType,
      vmware_host: vmwareHost || null,
      vm_name: vmName || null,
      notes: notes || null,
      ip_address: ipAddress || null,
      cpu_cores: cpuCores ? parseInt(cpuCores) : null,
      ram_gb: ramGb ? parseInt(ramGb) : null,
      disk_gb: diskGb ? parseInt(diskGb) : null,
      sap_sid: sapSid || null,
      sap_client_number: sapClientNumber || null,
      access_type: accessType,
      region: region || null,
      environment_type: environmentType,
    }, selectedConsultants);
  };

  return (
    <ScrollArea className="max-h-[70vh] -mx-1 px-1">
      <div className="space-y-4 pb-2">
        {/* Basic Info */}
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.env_section_basic', 'Basic Information')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>{t('admin.env_label_name', 'Name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production Server 01" />
          </div>
          <div className="col-span-2">
            <Label>{t('admin.env_label_description', 'Description')}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this environment..." rows={2} />
          </div>
          <div>
            <Label>{t('admin.env_label_env_type', 'Environment Type')}</Label>
            <Select value={environmentType} onValueChange={setEnvironmentType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="development">Development</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="testing">Testing / QA</SelectItem>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="disaster_recovery">Disaster Recovery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('admin.env_label_status', 'Status')}</Label>
            <Select value={status} onValueChange={(v: any) => setStatus(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Infrastructure */}
        <div className="space-y-1 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.env_section_infra', 'Infrastructure')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('admin.env_label_platform', 'Platform')}</Label>
            <Select value={platformType} onValueChange={setPlatformType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vmware">VMware</SelectItem>
                <SelectItem value="hyperv">Hyper-V</SelectItem>
                <SelectItem value="citrix">Citrix</SelectItem>
                <SelectItem value="aws">AWS EC2</SelectItem>
                <SelectItem value="azure">Azure VM</SelectItem>
                <SelectItem value="gcp">GCP Compute</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('admin.env_label_os', 'OS Type')}</Label>
            <Select value={osType} onValueChange={setOsType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Windows Server 2022">Windows Server 2022</SelectItem>
                <SelectItem value="Windows Server 2019">Windows Server 2019</SelectItem>
                <SelectItem value="Windows 11">Windows 11</SelectItem>
                <SelectItem value="Windows 10">Windows 10</SelectItem>
                <SelectItem value="SUSE Linux">SUSE Linux (SAP)</SelectItem>
                <SelectItem value="Ubuntu Server">Ubuntu Server</SelectItem>
                <SelectItem value="RHEL">RHEL</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('admin.env_label_vmname', 'VM Name')}</Label>
            <Input value={vmName} onChange={(e) => setVmName(e.target.value)} placeholder="SAP-PROD-VM01" />
          </div>
          <div>
            <Label>{t('admin.env_label_ip', 'IP Address')}</Label>
            <Input value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} placeholder="192.168.1.100" />
          </div>
          <div>
            <Label>{t('admin.env_label_cpu', 'CPU Cores')}</Label>
            <Input type="number" value={cpuCores} onChange={(e) => setCpuCores(e.target.value)} placeholder="8" />
          </div>
          <div>
            <Label>{t('admin.env_label_ram', 'RAM (GB)')}</Label>
            <Input type="number" value={ramGb} onChange={(e) => setRamGb(e.target.value)} placeholder="32" />
          </div>
          <div>
            <Label>{t('admin.env_label_disk', 'Disk (GB)')}</Label>
            <Input type="number" value={diskGb} onChange={(e) => setDiskGb(e.target.value)} placeholder="500" />
          </div>
          <div>
            <Label>{t('admin.env_label_region', 'Region')}</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="ME-Central, EU-West..." />
          </div>
        </div>

        {platformType === 'vmware' && (
          <div>
            <Label>{t('admin.env_label_vmhost', 'vCenter / ESXi Host')}</Label>
            <Input value={vmwareHost} onChange={(e) => setVmwareHost(e.target.value)} placeholder="vcenter.example.com" />
          </div>
        )}

        {/* SAP Details */}
        <div className="space-y-1 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.env_section_sap', 'SAP Details')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('admin.env_label_sap_sid', 'SAP SID')}</Label>
            <Input value={sapSid} onChange={(e) => setSapSid(e.target.value.toUpperCase())} placeholder="PRD" maxLength={3} />
          </div>
          <div>
            <Label>{t('admin.env_label_sap_client', 'SAP Client Number')}</Label>
            <Input value={sapClientNumber} onChange={(e) => setSapClientNumber(e.target.value)} placeholder="100" maxLength={3} />
          </div>
        </div>

        {/* Access */}
        <div className="space-y-1 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.env_section_access', 'Remote Access')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('admin.env_label_access_type', 'Access Type')}</Label>
            <Select value={accessType} onValueChange={setAccessType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rdp">RDP</SelectItem>
                <SelectItem value="ssh">SSH</SelectItem>
                <SelectItem value="vnc">VNC</SelectItem>
                <SelectItem value="sap_gui">SAP GUI</SelectItem>
                <SelectItem value="web">Web Console</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('admin.env_label_url', 'Guacamole URL')}</Label>
            <Input value={guacamoleUrl} onChange={(e) => setGuacamoleUrl(e.target.value)} placeholder="https://guac.example.com/..." />
          </div>
        </div>

        {/* Assignment */}
        <div className="space-y-1 pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.env_section_assign', 'Assignment')}</p>
        </div>
        <div>
          <Label>{t('admin.env_label_client', 'Client')}</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger><SelectValue placeholder={t('admin.env_select_client', 'Select client...')} /></SelectTrigger>
            <SelectContent>
              {(clients || []).map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {t('admin.env_label_consultants', 'Assigned Consultants')}
          </Label>
          <p className="text-xs text-muted-foreground mb-2">{t('admin.env_consultants_hint', 'Select one or more consultants who will have access')}</p>
          <div className="border rounded-xl p-2 max-h-40 overflow-y-auto space-y-1">
            {(consultants || []).length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">No consultants found</p>
            ) : (
              (consultants || []).map(c => (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={selectedConsultants.includes(c.id)}
                    onCheckedChange={() => toggleConsultant(c.id)}
                  />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))
            )}
          </div>
          {selectedConsultants.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {selectedConsultants.length} consultant{selectedConsultants.length > 1 ? 's' : ''} selected
            </p>
          )}
        </div>

        {/* Notes */}
        <div>
          <Label>{t('admin.env_label_notes', 'Notes')}</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." rows={2} />
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button></DialogClose>
          <Button className="gradient-primary border-0" onClick={handleSubmit} disabled={!name || !clientId || !guacamoleUrl}>
            {env ? t('common.update', 'Update') : t('common.create', 'Create')}
          </Button>
        </DialogFooter>
      </div>
    </ScrollArea>
  );
}

// --- Name resolution hook ---
function useEnvironmentNames(environments: RemoteEnvironment[] | undefined) {
  const clientIds = useMemo(() => [...new Set((environments || []).map(e => e.client_id))], [environments]);
  const consultantIds = useMemo(() => {
    const ids: string[] = [];
    (environments || []).forEach(e => { if (e.consultant_id) ids.push(e.consultant_id); });
    return [...new Set(ids)];
  }, [environments]);

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

// --- Resolve all consultant names for the multi-assignment ---
function useConsultantNameMap(ids: string[]) {
  return useQuery({
    queryKey: ['consultant-name-map', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data: cons } = await supabase.from('consultants').select('id, user_id').in('id', ids);
      if (!cons?.length) return {};
      const userIds = cons.map(c => c.user_id);
      const { data: profiles } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
      const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name || 'Unknown']));
      return Object.fromEntries(cons.map(c => [c.id, profileMap[c.user_id] || c.user_id]));
    },
  });
}

// --- Main Page ---
export default function EnvironmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: environments, isLoading } = useRemoteEnvironments();
  const { clientMap, consultantMap } = useEnvironmentNames(environments);
  const createEnv = useCreateEnvironment();
  const updateEnv = useUpdateEnvironment();
  const deleteEnv = useDeleteEnvironment();
  const [editEnv, setEditEnv] = useState<RemoteEnvironment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedEnv, setExpandedEnv] = useState<string | null>(null);

  const envIds = useMemo(() => (environments || []).map(e => e.id), [environments]);
  const { data: envConsultantsMap } = useAllEnvConsultants(envIds);

  // Collect all assigned consultant IDs for name resolution
  const allConsultantIds = useMemo(() => {
    const ids = new Set<string>();
    if (envConsultantsMap) {
      Object.values(envConsultantsMap).forEach(arr => arr.forEach(id => ids.add(id)));
    }
    return [...ids];
  }, [envConsultantsMap]);
  const { data: consultantNameMap } = useConsultantNameMap(allConsultantIds);

  const saveConsultants = async (envId: string, consultantIds: string[]) => {
    // Delete existing
    await supabase.from('environment_consultants').delete().eq('environment_id', envId);
    // Insert new
    if (consultantIds.length > 0) {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('environment_consultants').insert(
        consultantIds.map(cid => ({
          environment_id: envId,
          consultant_id: cid,
          assigned_by: user?.id || null,
        }))
      );
    }
    qc.invalidateQueries({ queryKey: ['all-env-consultants'] });
    qc.invalidateQueries({ queryKey: ['env-consultants'] });
  };

  const handleCreate = async (data: any, consultantIds: string[]) => {
    const result = await createEnv.mutateAsync(data);
    if (result?.id) await saveConsultants(result.id, consultantIds);
    setCreateOpen(false);
  };

  const handleUpdate = async (envId: string, data: any, consultantIds: string[]) => {
    await updateEnv.mutateAsync({ id: envId, ...data });
    await saveConsultants(envId, consultantIds);
  };

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
            <Server className="w-6 h-6 text-primary" /> {t('admin.env_title', 'Remote Environments')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('admin.env_subtitle', 'Manage VMware/Windows environments for consultant access')}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gradient-primary border-0 gap-1.5"><Plus className="w-4 h-4" /> {t('admin.env_add', 'Add Environment')}</Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl sm:max-w-2xl">
            <DialogHeader><DialogTitle>{t('admin.env_create_title', 'Create Environment')}</DialogTitle></DialogHeader>
            <EnvironmentForm
              onSubmit={handleCreate}
              onCancel={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {(!environments || environments.length === 0) ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Monitor className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">{t('admin.env_empty', 'No remote environments configured yet')}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('admin.env_empty_hint', 'Add your first VMware/Windows environment above')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {environments.map((env) => {
            const assignedIds = envConsultantsMap?.[env.id] || [];
            const envData = env as any;
            return (
              <Card key={env.id} className="rounded-2xl border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Monitor className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-foreground">{env.name}</h3>
                          <Badge variant={statusColors[env.status]}>{env.status}</Badge>
                          {envData.environment_type && (
                            <Badge variant="outline" className="text-[10px]">{envData.environment_type}</Badge>
                          )}
                        </div>
                        {envData.description && (
                          <p className="text-xs text-muted-foreground mb-1">{envData.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{env.platform_type === 'vmware' ? 'VMware' : env.platform_type === 'hyperv' ? 'Hyper-V' : env.platform_type} · {env.os_type}</span>
                          {env.vm_name && <span className="font-mono">{env.vm_name}</span>}
                          {envData.ip_address && (
                            <span className="flex items-center gap-1"><Network className="w-3 h-3" />{envData.ip_address}</span>
                          )}
                          {envData.region && (
                            <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{envData.region}</span>
                          )}
                        </div>

                        {/* Specs row */}
                        {(envData.cpu_cores || envData.ram_gb || envData.disk_gb) && (
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            {envData.cpu_cores && <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{envData.cpu_cores} vCPU</span>}
                            {envData.ram_gb && <span>{envData.ram_gb} GB RAM</span>}
                            {envData.disk_gb && <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{envData.disk_gb} GB</span>}
                          </div>
                        )}

                        {/* SAP */}
                        {(envData.sap_sid || envData.sap_client_number) && (
                          <div className="flex items-center gap-3 mt-1 text-xs">
                            {envData.sap_sid && <Badge variant="secondary" className="text-[10px] h-5">SID: {envData.sap_sid}</Badge>}
                            {envData.sap_client_number && <Badge variant="secondary" className="text-[10px] h-5">Client: {envData.sap_client_number}</Badge>}
                          </div>
                        )}

                        {/* Assignment */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                          <span>{t('admin.env_client_label', 'Client')}: <span className="font-medium text-foreground">{clientMap[env.client_id] || '—'}</span></span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {assignedIds.length > 0 ? (
                              <span className="font-medium text-foreground">
                                {assignedIds.map(id => consultantNameMap?.[id] || consultantMap[id] || '?').join(', ')}
                              </span>
                            ) : (
                              <span>{t('admin.env_unassigned', 'Unassigned')}</span>
                            )}
                          </span>
                        </div>

                        <p className="text-xs text-muted-foreground/60 mt-1 truncate max-w-md">{env.guacamole_url}</p>
                        {env.notes && <p className="text-xs text-muted-foreground mt-2">{env.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
                        <DialogContent className="rounded-2xl sm:max-w-2xl">
                          <DialogHeader><DialogTitle>{t('admin.env_edit_title', 'Edit Environment')}</DialogTitle></DialogHeader>
                          <EnvironmentForm
                            env={env}
                            onSubmit={(data, cIds) => handleUpdate(env.id, data, cIds)}
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
                            <AlertDialogTitle>{t('admin.env_delete_title', 'Delete Environment')}</AlertDialogTitle>
                            <AlertDialogDescription>{t('admin.env_delete_desc', 'This will permanently remove "{{name}}". This action cannot be undone.', { name: env.name })}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteEnv.mutate(env.id)}>
                              {t('common.delete', 'Delete')}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
