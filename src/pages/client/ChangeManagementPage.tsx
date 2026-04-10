import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { GitBranch, Plus, Clock, AlertTriangle, CheckCircle, XCircle, Shield, ArrowRight, Calendar } from 'lucide-react';

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  submitted: 'bg-blue-100 text-blue-700',
  cab_review: 'bg-purple-100 text-purple-700',
  approved: 'bg-green-100 text-green-700',
  scheduled: 'bg-indigo-100 text-indigo-700',
  implementing: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
};

const riskColors: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export default function ChangeManagementPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState('all');

  const { data: changes = [], isLoading } = useQuery({
    queryKey: ['change-requests'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('change_requests') as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = filter === 'all' ? changes : changes.filter((c: any) => c.status === filter);

  const stats = {
    total: changes.length,
    pending: changes.filter((c: any) => ['submitted', 'cab_review'].includes(c.status)).length,
    approved: changes.filter((c: any) => c.status === 'approved').length,
    implementing: changes.filter((c: any) => c.status === 'implementing').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-primary" /> Change Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage change requests with risk assessment and CAB approval workflows.</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Change Request
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Changes', value: stats.total, icon: GitBranch, color: 'text-primary' },
          { label: 'Pending Review', value: stats.pending, icon: Clock, color: 'text-yellow-600' },
          { label: 'Approved', value: stats.approved, icon: CheckCircle, color: 'text-green-600' },
          { label: 'Implementing', value: stats.implementing, icon: ArrowRight, color: 'text-blue-600' },
        ].map(s => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 ${s.color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 flex-wrap">
        {['all', 'draft', 'submitted', 'cab_review', 'approved', 'implementing', 'completed'].map(s => (
          <Button key={s} size="sm" variant={filter === s ? 'default' : 'outline'}
            className={`text-xs rounded-full h-8 ${filter === s ? 'gradient-primary border-0' : ''}`}
            onClick={() => setFilter(s)}>
            {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
          </Button>
        ))}
      </div>

      {/* Change List */}
      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl"><CardContent className="py-12 text-center">
            <GitBranch className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No change requests found.</p>
          </CardContent></Card>
        ) : (
          filtered.map((cr: any) => (
            <Card key={cr.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{cr.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cr.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Badge variant="secondary" className={`text-[10px] ${statusColors[cr.status]}`}>{cr.status.replace(/_/g, ' ')}</Badge>
                      <Badge variant="secondary" className={`text-[10px] ${riskColors[cr.risk_level]}`}>Risk: {cr.risk_level}</Badge>
                      <Badge variant="outline" className="text-[10px]">{cr.change_type}</Badge>
                      {cr.scheduled_start && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {new Date(cr.scheduled_start).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {cr.cab_required && (
                    <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-700 shrink-0">
                      <Shield className="w-3 h-3 me-1" /> CAB Required
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <CreateChangeDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ['change-requests'] })} />
    </div>
  );
}

function CreateChangeDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', change_type: 'normal', risk_level: 'medium', rollback_plan: '', implementation_plan: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.title) { toast.error('Title required'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase.from('change_requests') as any).insert({
        ...form,
        requested_by: user.id,
      });
      if (error) throw error;
      toast.success('Change request created');
      onOpenChange(false);
      onCreated();
      setForm({ title: '', description: '', change_type: 'normal', risk_level: 'medium', rollback_plan: '', implementation_plan: '' });
    } catch { toast.error('Failed to create'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-primary" /> New Change Request</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Title</label>
            <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Change request title..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Type</label>
              <Select value={form.change_type} onValueChange={v => setForm(p => ({ ...p, change_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Risk Level</label>
              <Select value={form.risk_level} onValueChange={v => setForm(p => ({ ...p, risk_level: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Rollback Plan</label>
            <Textarea value={form.rollback_plan} onChange={e => setForm(p => ({ ...p, rollback_plan: e.target.value }))} rows={2} placeholder="Steps to rollback if change fails..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Implementation Plan</label>
            <Textarea value={form.implementation_plan} onChange={e => setForm(p => ({ ...p, implementation_plan: e.target.value }))} rows={2} placeholder="Step-by-step implementation plan..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="gradient-primary border-0">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
