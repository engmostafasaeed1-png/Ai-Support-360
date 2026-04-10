import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Phone, Plus, Calendar, Clock, Users, CheckCircle } from 'lucide-react';

export default function OnCallSchedulePage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['oncall-schedules'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('oncall_schedules') as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: rotations = [] } = useQuery({
    queryKey: ['oncall-rotations'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('oncall_rotations') as any).select('*, consultants(user_id)').order('start_date');
      if (error) throw error;
      return data || [];
    },
  });

  const activeSchedules = schedules.filter((s: any) => s.is_active);
  const currentOncall = rotations.filter((r: any) => {
    const now = new Date();
    return new Date(r.start_date) <= now && new Date(r.end_date) >= now;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Phone className="w-6 h-6 text-primary" /> On-Call Scheduling
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage consultant rotation schedules and on-call assignments.</p>
        </div>
        <Button className="gradient-primary border-0 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Schedule
        </Button>
      </div>

      {/* Current On-Call */}
      {currentOncall.length > 0 && (
        <Card className="rounded-2xl border-green-200 bg-green-50 dark:bg-green-900/10">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" /> Currently On-Call
            </h3>
            <div className="space-y-1.5">
              {currentOncall.map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 text-sm">
                  <Users className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-foreground">Consultant</span>
                  <span className="text-muted-foreground">until {new Date(r.end_date).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="rounded-2xl border-border/50"><CardContent className="p-4 flex items-center gap-3">
          <Calendar className="w-8 h-8 text-primary" /><div><p className="text-2xl font-bold">{activeSchedules.length}</p><p className="text-xs text-muted-foreground">Active Schedules</p></div>
        </CardContent></Card>
        <Card className="rounded-2xl border-border/50"><CardContent className="p-4 flex items-center gap-3">
          <Users className="w-8 h-8 text-blue-600" /><div><p className="text-2xl font-bold">{currentOncall.length}</p><p className="text-xs text-muted-foreground">On-Call Now</p></div>
        </CardContent></Card>
        <Card className="rounded-2xl border-border/50"><CardContent className="p-4 flex items-center gap-3">
          <Clock className="w-8 h-8 text-yellow-600" /><div><p className="text-2xl font-bold">{rotations.length}</p><p className="text-xs text-muted-foreground">Total Rotations</p></div>
        </CardContent></Card>
      </div>

      {/* Schedule List */}
      <div className="space-y-3">
        {isLoading ? [1, 2].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />) :
          schedules.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="py-12 text-center">
              <Phone className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No schedules created yet.</p>
            </CardContent></Card>
          ) : schedules.map((sch: any) => (
            <Card key={sch.id} className="rounded-2xl border-border/50">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground">{sch.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[9px]">{sch.rotation_type}</Badge>
                    {sch.sap_module && <Badge variant="secondary" className="text-[9px]">{sch.sap_module}</Badge>}
                    <span className="text-[10px] text-muted-foreground">{sch.timezone}</span>
                  </div>
                </div>
                <Badge variant={sch.is_active ? 'default' : 'secondary'} className="text-[10px]">
                  {sch.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </CardContent>
            </Card>
          ))}
      </div>

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ['oncall-schedules'] })} />
    </div>
  );
}

function CreateScheduleDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', rotation_type: 'weekly', sap_module: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase.from('oncall_schedules') as any).insert({ ...form, created_by: user?.id });
      if (error) throw error;
      toast.success('Schedule created');
      onOpenChange(false);
      onCreated();
    } catch { toast.error('Failed'); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> New On-Call Schedule</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><label className="text-xs font-medium">Name</label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. FI/CO Weekend Coverage" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-xs font-medium">Rotation Type</label>
              <Select value={form.rotation_type} onValueChange={v => setForm(p => ({ ...p, rotation_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem><SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select></div>
            <div className="space-y-1.5"><label className="text-xs font-medium">SAP Module</label>
              <Input value={form.sap_module} onChange={e => setForm(p => ({ ...p, sap_module: e.target.value }))} placeholder="Optional" /></div>
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
