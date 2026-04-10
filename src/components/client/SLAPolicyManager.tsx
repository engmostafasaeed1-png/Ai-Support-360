import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Shield, Plus, Pencil, Trash2, Clock, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const URGENCY_OPTIONS = ['critical', 'high', 'medium', 'low'];

interface PolicyForm {
  name: string;
  urgency: string;
  response_time_minutes: number;
  resolution_time_minutes: number;
  description: string;
  business_hours_only: boolean;
  sap_module: string;
  is_active: boolean;
}

const emptyForm: PolicyForm = {
  name: '',
  urgency: 'medium',
  response_time_minutes: 120,
  resolution_time_minutes: 1440,
  description: '',
  business_hours_only: false,
  sap_module: '',
  is_active: true,
};

function formatMinutes(m: number) {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const urgencyColors: Record<string, string> = {
  critical: 'bg-destructive/10 text-destructive',
  high: 'bg-amber-500/10 text-amber-600',
  medium: 'bg-blue-500/10 text-blue-600',
  low: 'bg-muted text-muted-foreground',
};

export default function SLAPolicyManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm);

  const { data: userId } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  const { data: policies, isLoading } = useQuery({
    queryKey: ['client-sla-policies', userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase
        .from('ticket_sla_policies')
        .select('*')
        .eq('client_id', userId)
        .order('urgency');
      return data ?? [];
    },
    enabled: !!userId,
  });

  const { data: systemPolicies } = useQuery({
    queryKey: ['system-sla-policies'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_sla_policies')
        .select('*')
        .is('client_id', null)
        .eq('is_active', true)
        .order('urgency');
      return data ?? [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: PolicyForm & { id?: string }) => {
      if (!userId) throw new Error('Not authenticated');
      const payload = { ...data, client_id: userId };
      if (data.id) {
        const { error } = await supabase.from('ticket_sla_policies').update(payload).eq('id', data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ticket_sla_policies').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-sla-policies'] });
      toast.success(editId ? 'Policy updated' : 'Policy created');
      setOpen(false);
      setEditId(null);
      setForm(emptyForm);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ticket_sla_policies').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-sla-policies'] });
      toast.success('Policy deleted');
    },
  });

  const openEdit = (p: any) => {
    setEditId(p.id);
    setForm({
      name: p.name,
      urgency: p.urgency,
      response_time_minutes: p.response_time_minutes,
      resolution_time_minutes: p.resolution_time_minutes,
      description: p.description ?? '',
      business_hours_only: p.business_hours_only ?? false,
      sap_module: p.sap_module ?? '',
      is_active: p.is_active ?? true,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            My SLA Policies
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure custom response & resolution targets per urgency level
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" /> Add Policy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editId ? 'Edit' : 'Create'} SLA Policy</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Policy Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Critical - 4h Response" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Urgency Level</Label>
                  <Select value={form.urgency} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {URGENCY_OPTIONS.map(u => <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>SAP Module (optional)</Label>
                  <Input value={form.sap_module} onChange={e => setForm(f => ({ ...f, sap_module: e.target.value }))} placeholder="e.g. FI, MM" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Response Time (min)</Label>
                  <Input type="number" min={1} value={form.response_time_minutes} onChange={e => setForm(f => ({ ...f, response_time_minutes: +e.target.value }))} />
                  <p className="text-[10px] text-muted-foreground">= {formatMinutes(form.response_time_minutes)}</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Resolution Time (min)</Label>
                  <Input type="number" min={1} value={form.resolution_time_minutes} onChange={e => setForm(f => ({ ...f, resolution_time_minutes: +e.target.value }))} />
                  <p className="text-[10px] text-muted-foreground">= {formatMinutes(form.resolution_time_minutes)}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Optional notes…" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Business Hours Only</Label>
                <Switch checked={form.business_hours_only} onCheckedChange={v => setForm(f => ({ ...f, business_hours_only: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              </div>
              <Button
                className="w-full"
                disabled={!form.name || saveMutation.isPending}
                onClick={() => saveMutation.mutate({ ...form, id: editId ?? undefined })}
              >
                {saveMutation.isPending ? 'Saving…' : editId ? 'Update Policy' : 'Create Policy'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Client policies */}
      {isLoading ? (
        <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : policies && policies.length > 0 ? (
        <div className="grid gap-3">
          {policies.map(p => (
            <Card key={p.id} className={`rounded-xl ${!p.is_active ? 'opacity-50' : ''}`}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{p.name}</p>
                    <Badge variant="outline" className={`text-[10px] capitalize ${urgencyColors[p.urgency] || ''}`}>{p.urgency}</Badge>
                    {p.sap_module && <Badge variant="secondary" className="text-[10px]">{p.sap_module}</Badge>}
                    {!p.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </div>
                  <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Response: {formatMinutes(p.response_time_minutes)}</span>
                    <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Resolution: {formatMinutes(p.resolution_time_minutes)}</span>
                    {p.business_hours_only && <span>🏢 Business hrs</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(p.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-xl border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No custom SLA policies yet.</p>
            <p className="text-xs mt-1">System defaults will be used until you create your own.</p>
          </CardContent>
        </Card>
      )}

      {/* System defaults reference */}
      {systemPolicies && systemPolicies.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">System Default Policies</h3>
          <div className="grid gap-2">
            {systemPolicies.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/20 text-xs">
                <Badge variant="outline" className={`text-[10px] capitalize ${urgencyColors[p.urgency] || ''}`}>{p.urgency}</Badge>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground ms-auto">
                  Response: {formatMinutes(p.response_time_minutes)} · Resolution: {formatMinutes(p.resolution_time_minutes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
