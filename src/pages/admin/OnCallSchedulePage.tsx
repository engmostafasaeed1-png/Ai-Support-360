import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Phone, Plus, Calendar, Clock, Users, CheckCircle, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

type Person = { id: string; name: string };

const fmt = (iso: string) => format(new Date(iso), 'MMM d, yyyy HH:mm');

export default function OnCallSchedulePage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [shiftFor, setShiftFor] = useState<any | null>(null);

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
      const { data, error } = await (supabase.from('oncall_rotations') as any).select('*').order('start_date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // the verified consultants who can be put on call, with their names
  const { data: people = [] } = useQuery({
    queryKey: ['oncall-people'],
    queryFn: async (): Promise<Person[]> => {
      const { data: cons, error } = await supabase.from('consultants').select('id, user_id').eq('verification_status', 'verified');
      if (error) throw error;
      const userIds = (cons || []).map(c => c.user_id);
      const names: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabase.from('profile_directory').select('user_id, display_name').in('user_id', userIds);
        (profs || []).forEach((p: any) => { if (p.user_id) names[p.user_id] = p.display_name || ''; });
      }
      return (cons || [])
        .map(c => ({ id: c.id, name: names[c.user_id] || 'Consultant' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const personName = (id: string) => people.find(p => p.id === id)?.name || 'Consultant';

  const now = new Date();
  const isNow = (r: any) => new Date(r.start_date) <= now && new Date(r.end_date) > now;
  const activeSchedules = schedules.filter((s: any) => s.is_active);
  const currentOncall = rotations.filter(isNow);
  const scheduleName = (id: string) => schedules.find((s: any) => s.id === id)?.name || 'Schedule';

  const removeShift = async (id: string) => {
    if (!window.confirm('Remove this shift?')) return;
    const { error } = await (supabase.from('oncall_rotations') as any).delete().eq('id', id);
    if (error) { toast.error('Could not remove the shift'); return; }
    toast.success('Shift removed');
    queryClient.invalidateQueries({ queryKey: ['oncall-rotations'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Phone className="w-6 h-6 text-primary" /> On-Call Scheduling
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage consultant rotation schedules and on-call assignments. The consultant on call is the emergency contact of a high or critical ticket.</p>
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
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Users className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-foreground font-medium">{personName(r.consultant_id)}</span>
                  <span className="text-muted-foreground">{scheduleName(r.schedule_id)} · until {fmt(r.end_date)}</span>
                  {r.is_override && <Badge variant="secondary" className="text-[9px]">Override</Badge>}
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
          <Clock className="w-8 h-8 text-yellow-600" /><div><p className="text-2xl font-bold">{rotations.length}</p><p className="text-xs text-muted-foreground">Total Shifts</p></div>
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
          ) : schedules.map((sch: any) => {
            const shifts = rotations.filter((r: any) => r.schedule_id === sch.id);
            return (
              <Card key={sch.id} className="rounded-2xl border-border/50">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Calendar className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">{sch.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[9px]">{sch.rotation_type}</Badge>
                        {sch.sap_module && <Badge variant="secondary" className="text-[9px]">{sch.sap_module}</Badge>}
                        <span className="text-[10px] text-muted-foreground">{sch.timezone}</span>
                        <span className="text-[10px] text-muted-foreground">{shifts.length} shift{shifts.length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <Badge variant={sch.is_active ? 'default' : 'secondary'} className="text-[10px]">
                      {sch.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setShiftFor(sch)}>
                      <Plus className="w-3.5 h-3.5" /> Add shift
                    </Button>
                  </div>

                  {shifts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No shifts yet. Add a shift to put a consultant on call.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto divide-y divide-border/50 rounded-xl border border-border/50">
                      {shifts.map((r: any) => (
                        <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                          <span className="font-medium text-foreground">{personName(r.consultant_id)}</span>
                          <span className="text-xs text-muted-foreground">{fmt(r.start_date)} → {fmt(r.end_date)}</span>
                          {isNow(r) && <Badge className="text-[9px] bg-green-600 hover:bg-green-600">On call now</Badge>}
                          {r.is_override && <Badge variant="secondary" className="text-[9px]">Override{r.override_reason ? `: ${r.override_reason}` : ''}</Badge>}
                          <Button size="icon" variant="ghost" className="ms-auto h-7 w-7" aria-label="Remove shift" onClick={() => removeShift(r.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
      </div>

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => queryClient.invalidateQueries({ queryKey: ['oncall-schedules'] })} />
      <AddShiftDialog
        schedule={shiftFor}
        people={people}
        onClose={() => setShiftFor(null)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['oncall-rotations'] })}
      />
    </div>
  );
}

function AddShiftDialog({ schedule, people, onClose, onCreated }: { schedule: any | null; people: Person[]; onClose: () => void; onCreated: () => void }) {
  const [consultantId, setConsultantId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => { setConsultantId(''); setStart(''); setEnd(''); setOverride(false); setReason(''); onClose(); };

  const handleSubmit = async () => {
    if (!schedule) return;
    if (!consultantId) { toast.error('Choose the consultant who is on call'); return; }
    if (!start || !end) { toast.error('Enter the start and the end of the shift'); return; }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!(endDate.getTime() > startDate.getTime())) { toast.error('The end of the shift must be after its start'); return; }
    setSaving(true);
    const { error } = await (supabase.from('oncall_rotations') as any).insert({
      schedule_id: schedule.id,
      consultant_id: consultantId,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      is_override: override,
      override_reason: override ? (reason.trim() || null) : null,
    });
    setSaving(false);
    if (error) {
      if (error.code === '23P01') toast.error('This shift overlaps another shift of the same schedule. Change the times, or mark it as an override.');
      else if (error.code === '23514') toast.error('The end of the shift must be after its start');
      else toast.error(error.message || 'Could not save the shift');
      return;
    }
    toast.success('Shift saved');
    onCreated();
    close();
  };

  return (
    <Dialog open={!!schedule} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Add a shift{schedule ? `: ${schedule.name}` : ''}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5"><label className="text-xs font-medium">Consultant on call</label>
            <Select value={consultantId} onValueChange={setConsultantId}>
              <SelectTrigger><SelectValue placeholder="Choose a verified consultant" /></SelectTrigger>
              <SelectContent>
                {people.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><label className="text-xs font-medium">Starts</label>
              <Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div className="space-y-1.5"><label className="text-xs font-medium">Ends</label>
              <Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">Times are in your own time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}) and are stored in UTC.</p>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">Override</p>
              <p className="text-xs text-muted-foreground">Covers the regular shifts for this time (holiday, sickness). An override may overlap other shifts; two regular shifts of one schedule may not.</p>
            </div>
            <Switch checked={override} onCheckedChange={setOverride} aria-label="Override" />
          </div>
          {override && (
            <div className="space-y-1.5"><label className="text-xs font-medium">Reason (optional)</label>
              <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="e.g. Public holiday cover" /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="gradient-primary border-0">Save shift</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
