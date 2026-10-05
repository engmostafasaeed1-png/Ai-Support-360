import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2 } from 'lucide-react';
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

export default function SetAvailabilityDialog({ trigger }: { trigger: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState('1');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [busy, setBusy] = useState(false);

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

  const refresh = () => qc.invalidateQueries({ queryKey: ['my-availability-slots'] });

  const add = async () => {
    if (!data?.consultantId) { toast.error('Your consultant profile could not be found.'); return; }
    if (end <= start) { toast.error('The end time must be after the start time.'); return; }
    const d = Number(day);
    const overlap = data.slots.some(s => s.day_of_week === d && start < s.end_time.slice(0, 5) && end > s.start_time.slice(0, 5));
    if (overlap) { toast.error('This time overlaps a slot you already have on that day.'); return; }
    setBusy(true);
    const { error } = await supabase.from('availability_slots').insert({
      consultant_id: data.consultantId, day_of_week: d, start_time: start, end_time: end, is_recurring: true,
    });
    setBusy(false);
    if (error) { toast.error(error.message || 'Could not save the time slot'); return; }
    toast.success('Time slot added');
    refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('availability_slots').delete().eq('id', id);
    if (error) { toast.error(error.message || 'Could not remove the time slot'); return; }
    toast.success('Time slot removed');
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set availability</DialogTitle>
          <DialogDescription>Your weekly time slots. Clients can book sessions in these times.</DialogDescription>
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
        <Button onClick={add} disabled={busy || isLoading} className="w-full">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Add time slot
        </Button>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
          ) : !data?.slots.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">No time slots yet.</p>
          ) : data.slots.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2">
              <span className="text-sm">
                <span className="font-semibold">{s.day_of_week != null ? DAYS[s.day_of_week] : 'One-off'}</span>{' '}
                {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
              </span>
              <Button variant="ghost" size="icon" aria-label="Remove time slot" onClick={() => remove(s.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
