import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Bug, Plus, Search, AlertCircle, CheckCircle, Eye, Lightbulb } from 'lucide-react';

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  investigating: 'bg-yellow-100 text-yellow-700',
  root_cause_identified: 'bg-orange-100 text-orange-700',
  known_error: 'bg-red-100 text-red-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

export default function ProblemManagementPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');

  const { data: problems = [], isLoading } = useQuery({
    queryKey: ['problems'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('problems') as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = problems
    .filter((p: any) => tab === 'all' || (tab === 'known_errors' ? p.is_known_error : p.status === tab))
    .filter((p: any) => !search || p.title.toLowerCase().includes(search.toLowerCase()));

  const knownErrors = problems.filter((p: any) => p.is_known_error);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bug className="w-6 h-6 text-primary" /> Problem Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track root causes, known errors, and workarounds across incidents.</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Problem
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Open Problems', value: problems.filter((p: any) => !['resolved', 'closed'].includes(p.status)).length, icon: Bug, color: 'text-red-600' },
          { label: 'Known Errors', value: knownErrors.length, icon: AlertCircle, color: 'text-orange-600' },
          { label: 'With Workaround', value: problems.filter((p: any) => p.workaround).length, icon: Lightbulb, color: 'text-yellow-600' },
          { label: 'Resolved', value: problems.filter((p: any) => p.status === 'resolved').length, icon: CheckCircle, color: 'text-green-600' },
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

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search problems..." value={search} onChange={e => setSearch(e.target.value)} className="ps-9 rounded-xl" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'new', 'investigating', 'known_errors', 'resolved'].map(s => (
            <Button key={s} size="sm" variant={tab === s ? 'default' : 'outline'}
              className={`text-xs rounded-full h-8 ${tab === s ? 'gradient-primary border-0' : ''}`}
              onClick={() => setTab(s)}>
              {s === 'all' ? 'All' : s === 'known_errors' ? 'Known Errors' : s.replace(/_/g, ' ')}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : filtered.length === 0 ? (
          <Card className="rounded-2xl"><CardContent className="py-12 text-center">
            <Bug className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No problems found.</p>
          </CardContent></Card>
        ) : (
          filtered.map((problem: any) => (
            <Card key={problem.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{problem.title}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{problem.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Badge variant="secondary" className={`text-[10px] ${statusColors[problem.status]}`}>{problem.status.replace(/_/g, ' ')}</Badge>
                      {problem.is_known_error && <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-700">Known Error</Badge>}
                      {problem.sap_module && <Badge variant="outline" className="text-[10px]">{problem.sap_module}</Badge>}
                      <span className="text-[10px] text-muted-foreground">{problem.incident_count} linked incidents</span>
                    </div>
                    {problem.workaround && (
                      <div className="mt-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200/50">
                        <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Workaround: {problem.workaround}</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <CreateProblemDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ['problems'] })} />
    </div>
  );
}

function CreateProblemDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', sap_module: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.title) { toast.error('Title required'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase.from('problems') as any).insert({ ...form, created_by: user.id });
      if (error) throw error;
      toast.success('Problem created');
      onOpenChange(false);
      onCreated();
    } catch { toast.error('Failed'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Bug className="w-4 h-4 text-primary" /> New Problem Record</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><label className="text-xs font-medium">Title</label>
            <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div className="space-y-1.5"><label className="text-xs font-medium">Description</label>
            <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-xs font-medium">Priority</label>
              <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="space-y-1.5"><label className="text-xs font-medium">SAP Module</label>
              <Input value={form.sap_module} onChange={e => setForm(p => ({ ...p, sap_module: e.target.value }))} placeholder="e.g. FI/CO" /></div>
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
