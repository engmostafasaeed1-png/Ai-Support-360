import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Slot { id: string; day_of_week: number | null; start_time: string; end_time: string }

// A draft slot: either an existing row (has id) or a new one (id starts with "new-")
interface DraftSlot { id: string; day_of_week: number; start_time: string; end_time: string; removed?: boolean }

const fmt = (t: string) => t.slice(0, 5);

export default function SetAvailabilityDialog({ trigger }: { trigger: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('1');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftSlot[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-availability-slots'],
    enabled: open,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not signed in');
      const { data: c, error: ce } = await supabase
        .from('consultants').select('id').eq('user_id', session.user.id).maybeSingle();
      if (ce) throw ce;
      if (!c) return { consultantId: null as string | null, slots: [] as Slot[] };
      const { data: slots, error } = await supabase
        .from('availability_slots')
        .select('id, day_of_week, start_time, end_time')
        .eq('consultant_id', c.id)
        .order('day_of_week').order('start_time');
      if (error) throw error;
      return { consultantId: c.id as string | null, slots: (slots ?? []) as Slot[] };
    },
  });

  // Load the saved slots into the editable draft list when they arrive
  useEffect(() => {
    if (!data) return;
    setDrafts(data.slots.map(s => ({
      id: s.id,
      day_of_week: s.day_of_week ?? 0,
      start_time: fmt(s.start_time),
      end_time: fmt(s.end_time),
    })));
    setEditingId(null);
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['my-availability-slots'] });

  const visible = drafts.filter(d => !d.removed);
  const dirty = JSON.stringify(visible.map(({ id, day_of_week, start_time, end_time }) => ({ id, day_of_week, start_time, end_time })))
    !== JSON.stringify((data?.slots ?? []).map(s => ({ id: s.id, day_of_week: s.day_of_week ?? 0, start_time: fmt(s.start_time), end_time: fmt(s.end_time) })));

  const overlaps = (list: DraftSlot[], cand: { day_of_week: number; start_time: string; end_time: string }, ignoreId?: string) =>
    list.some(s => !s.removed && s.id !== ignoreId && s.day_of_week === cand.day_of_week
      && cand.start_time < s.end_time && cand.end_time > s.start_time);

  const addOrUpdate = () => {
    if (end <= start) { toast.error('The end time must be after the start time.'); return; }
    const d = Number(day);
    const cand = { day_of_week: d, start_time: start, end_time: end };
    if (overlaps(drafts, cand, editingId ?? undefined)) {
      toast.error('This time overlaps a slot you already have on that day.');
      return;
    }
    if (editingId) {
      setDrafts(ds => ds.map(s => s.id === editingId ? { ...s, ...cand } : s));
      setEditingId(null);
    } else {
      setDrafts(ds => [...ds, { id: `new-${Date.now()}`, ...cand }]);
    }
  };

  const startEdit = (s: DraftSlot) => {
    setEditingId(s.id);
    setDay(String(s.day_of_week));
    setStart(s.start_time);
    setEnd(s.end_time);
  };

  const removeDraft = (id: string) => {
    setDrafts(ds => ds.map(s => s.id === id ? { ...s, removed: true } : s));
    if (editingId === id) setEditingId(null);
  };

  const save = async () => {
    if (!data?.consultantId) { toast.error('Your consultant profile could not be found.'); return; }
    setBusy(true);
    try {
      const toDelete = drafts.filter(d => d.removed && !d.id.startsWith('new-'));
      const toInsert = drafts.filter(d => !d.removed && d.id.startsWith('new-'));
      const toUpdate = drafts.filter(d => !d.removed && !d.id.startsWith('new-'));

      for (const d of toDelete) {
        const { error } = await supabase.from('availability_slots').delete().eq('id', d.id);
        if (error) throw error;
      }
      for (const d of toInsert) {
        const { error } = await supabase.from('availability_slots').insert({
          consultant_id: data.consultantId, day_of_week: d.day_of_week,
          start_time: d.start_time, end_time: d.end_time, is_recurring: true,
        });
        if (error) throw error;
      }
      for (const d of toUpdate) {
        const { error } = await supabase.from('availability_slots').update({
          day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time,
        }).eq('id', d.id);
        if (error) throw error;
      }
      toast.success('Availability saved');
      refresh();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save your availability');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set availability</DialogTitle>
          <DialogDescription>Your weekly time slots. Clients can book sessions in these times. Make your changes, then press Save.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 items-end">
          <div className="space-y-1">
            <Label>Day</Label>
            <Select value={day} onValueChange={setDay}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="time" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="time" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={addOrUpdate} disabled={busy || isLoading} variant="outline" className="flex-1">
            <Plus className="w-4 h-4 mr-2" />
            {editingId ? 'Update slot' : 'Add time slot'}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel edit</Button>
          )}
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No time slots yet.</p>
          ) : visible.map(s => (
            <div key={s.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${editingId === s.id ? 'border-accent' : 'border-border/50'}`}>
              <span className="text-sm">
                <span className="font-semibold">{DAYS[s.day_of_week]}</span>{' '}
                {s.start_time} – {s.end_time}
              </span>
              <div className="flex items-center">
                <Button variant="ghost" size="icon" aria-label="Edit time slot" onClick={() => startEdit(s)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Remove time slot" onClick={() => removeDraft(s.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={save} disabled={busy || isLoading || !dirty} className="flex-1 gradient-primary border-0">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save availability
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
