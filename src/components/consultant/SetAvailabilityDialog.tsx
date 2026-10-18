import { useSectionAutosave } from '@/hooks/useSectionAutosave';
import { useProfileAutosaveReady } from '@/hooks/useProfileAutosaveReady';
import SectionSaveControls from './saving/SectionSaveControls';
import { useProfileSavePrompt } from './saving/ProfileImportance';
import { useSessionReady } from '@/hooks/useSessionReady';
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
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [mode, setMode] = useState<'weekly' | 'date'>('weekly');
  const [day, setDay] = useState('1');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftSlot[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const today = localDateKey(new Date());

  const signedIn = useSessionReady().signedIn;
  const { data, isLoading } = useQuery({
    queryKey: ['my-availability-slots'],
    enabled: signedIn && (open),
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      // The session may still be restoring: answer "no slots"; useRefetchOnSignIn reloads this once signed in.
      if (!session?.user) return { consultantId: null as string | null, slots: [] as Slot[] };
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
    setDraftLoaded(true);
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

  const insertedSlots = useRef(new Map<string, string>());
  const automatic = useProfileAutosaveReady();
  const beforeManual = useProfileSavePrompt();
  const state = useSectionAutosave({ values: { slots: drafts }, ready: open && !isLoading && !!data?.consultantId && draftLoaded && applied.current !== null, resetKey: open ? 'open' : 'closed', automatic: automatic.data === true, beforeManual,
    validate: () => visible.some(slot => slot.end_time <= slot.start_time || overlaps(visible, slot, slot.id)) ? 'Check your time slots for overlaps and invalid times.' : null,
    persist: async patch => {
      if (!data?.consultantId) throw new Error('Your consultant profile could not be found.');
      const sent = patch.slots as DraftSlot[];
      for (const slot of sent) {
        const resolved = insertedSlots.current.get(slot.id); if (resolved) slot.id = resolved;
        if (slot.removed) {
          if (!slot.id.startsWith('new-')) { const { error } = await supabase.from('availability_slots').delete().eq('id', slot.id).eq('consultant_id', data.consultantId); if (error) throw error; }
          continue;
        }
        const values = { day_of_week: slot.day_of_week, specific_date: slot.specific_date, start_time: slot.start_time, end_time: slot.end_time, is_recurring: !slot.specific_date };
        if (slot.id.startsWith('new-')) {
          const { data: inserted, error } = await supabase.from('availability_slots').insert({ ...values, consultant_id: data.consultantId }).select('id').single();
          if (error || !inserted) throw error ?? new Error('Could not save your availability');
          const localId = slot.id; insertedSlots.current.set(localId, inserted.id); slot.id = inserted.id;
          setDrafts(current => current.map(item => item.id === localId ? { ...item, id: inserted.id } : item));
        } else {
          const original = data.slots.find(s => s.id === slot.id);
          const before = original ? { ...toDraft(original), is_recurring: !original.specific_date } : {};
          const delta = Object.fromEntries(Object.entries(values).filter(([key, value]) => (before as Record<string, unknown>)[key] !== value));
          if (Object.keys(delta).length) { const { error } = await supabase.from('availability_slots').update(delta).eq('id', slot.id).eq('consultant_id', data.consultantId); if (error) throw error; }
        }
      }
      onSaved?.();
      void qc.invalidateQueries({ queryKey: ['availability-slots'] });
    },
  });
  const close = async () => {
    if (state.dirty) { await state.flush(); return; }
    setOpen(false); setDraftLoaded(false); applied.current = null; void refresh();
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else void close(); }}>
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
          <SectionSaveControls state={state} disabled={isLoading} />
          <Button variant="outline" onClick={() => void close()} disabled={state.saving}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
