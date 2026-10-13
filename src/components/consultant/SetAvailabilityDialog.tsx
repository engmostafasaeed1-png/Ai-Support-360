import { useEffect, useRef, useState } from 'react';
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
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { localDateKey } from '@/lib/bookableTimes';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Slot { id: string; day_of_week: number | null; specific_date: string | null; start_time: string; end_time: string }

// A draft slot: either an existing row (has the id of the row) or a new one (id starts with "new-").
// A weekly slot has a weekday and no date; a one-date slot has a date and no weekday.
interface DraftSlot { id: string; day_of_week: number | null; specific_date: string | null; start_time: string; end_time: string; removed?: boolean }
type Where = Pick<DraftSlot, 'day_of_week' | 'specific_date'>;

const fmt = (t: string) => t.slice(0, 5);
const toDraft = (s: Slot): DraftSlot => ({
  id: s.id,
  day_of_week: s.specific_date ? null : (s.day_of_week ?? 0),
  specific_date: s.specific_date,
  start_time: fmt(s.start_time),
  end_time: fmt(s.end_time),
});
const sameDay = (a: Where, b: Where) => (a.specific_date ? a.specific_date === b.specific_date : !b.specific_date && a.day_of_week === b.day_of_week);
const snapshot = (list: DraftSlot[]) =>
  JSON.stringify(list.map(({ id, day_of_week, specific_date, start_time, end_time }) => ({ id, day_of_week, specific_date, start_time, end_time })));
const dateLabel = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export default function SetAvailabilityDialog({ trigger, onSaved }: { trigger: React.ReactNode; onSaved?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'weekly' | 'date'>('weekly');
  const [day, setDay] = useState('1');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftSlot[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const today = localDateKey(new Date());

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
        .select('id, day_of_week, specific_date, start_time, end_time')
        .eq('consultant_id', c.id)
        .order('day_of_week').order('specific_date').order('start_time');
      if (error) throw error;
      return { consultantId: c.id as string | null, slots: (slots ?? []) as Slot[] };
    },
  });

  // Load the saved slots into the editable draft list when they arrive
  // Load the saved slots only while the list has no unsaved changes, so a refetch does not drop them.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const fresh = data.slots.map(toDraft);
    const untouched = applied.current === null || snapshot(drafts.filter(d => !d.removed)) === applied.current;
    applied.current = snapshot(fresh);
    if (!untouched) return;
    setDrafts(fresh);
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the saved slots change
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['my-availability-slots'] });

  const visible = drafts.filter(d => !d.removed);
  const dirty = snapshot(visible) !== snapshot((data?.slots ?? []).map(toDraft));

  const overlaps = (list: DraftSlot[], cand: Omit<DraftSlot, 'id'>, ignoreId?: string) =>
    list.some(s => !s.removed && s.id !== ignoreId && sameDay(s, cand)
      && cand.start_time < s.end_time && cand.end_time > s.start_time);

  const addOrUpdate = () => {
    if (end <= start) { toast.error('The end time must be after the start time.'); return; }
    let cand: Omit<DraftSlot, 'id'>;
    if (mode === 'date') {
      if (!date) { toast.error('Choose the date.'); return; }
      if (date < today) { toast.error('Choose a date that is today or later.'); return; }
      cand = { day_of_week: null, specific_date: date, start_time: start, end_time: end };
    } else {
      cand = { day_of_week: Number(day), specific_date: null, start_time: start, end_time: end };
    }
    if (overlaps(drafts, cand, editingId ?? undefined)) {
      toast.error(mode === 'date' ? 'This time overlaps a slot you already have on that date.' : 'This time overlaps a slot you already have on that day.');
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
    setMode(s.specific_date ? 'date' : 'weekly');
    setDay(String(s.day_of_week ?? 1));
    setDate(s.specific_date ?? '');
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
          consultant_id: data.consultantId, day_of_week: d.day_of_week, specific_date: d.specific_date,
          start_time: d.start_time, end_time: d.end_time, is_recurring: !d.specific_date,
        });
        if (error) throw error;
      }
      for (const d of toUpdate) {
        const { error } = await supabase.from('availability_slots').update({
          day_of_week: d.day_of_week, specific_date: d.specific_date,
          start_time: d.start_time, end_time: d.end_time, is_recurring: !d.specific_date,
        }).eq('id', d.id);
        if (error) throw error;
      }
      toast.success('Availability saved');
      applied.current = null;
      refresh();
      setOpen(false);
      onSaved?.();
    } catch (e) {
      toast.error(friendlyErrorMessage(e, 'Could not save your availability'));
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
          <DialogDescription>Your weekly time slots, or a time on one date only. Clients can book sessions in these times. Make your changes, then press Save.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2" role="group" aria-label="Kind of time slot">
          <Button type="button" size="sm" variant={mode === 'weekly' ? 'default' : 'outline'} aria-pressed={mode === 'weekly'} data-testid="availability-mode-weekly" onClick={() => setMode('weekly')}>
            Every week
          </Button>
          <Button type="button" size="sm" variant={mode === 'date' ? 'default' : 'outline'} aria-pressed={mode === 'date'} data-testid="availability-mode-date" onClick={() => setMode('date')}>
            One date only
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2 items-end">
          {mode === 'weekly' ? (
            <div className="space-y-1">
              <Label>Day</Label>
              <Select value={day} onValueChange={setDay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="availability-date">Date</Label>
              <Input id="availability-date" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="availability-from">From</Label>
            <Input id="availability-from" type="time" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="availability-to">To</Label>
            <Input id="availability-to" type="time" value={end} onChange={e => setEnd(e.target.value)} />
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
                <span className="font-semibold">{s.specific_date ? dateLabel(s.specific_date) : DAYS[s.day_of_week ?? 0]}</span>{' '}
                {s.start_time} – {s.end_time}
                {s.specific_date && (
                  <span className="ms-1 text-[10px] text-muted-foreground">{s.specific_date < today ? '(one date, past)' : '(one date)'}</span>
                )}
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
