import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { friendlyErrorMessage } from '@/lib/friendlyError';

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeKey = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  scheduledAt: string;
  /** Called after the new time was saved. */
  onDone: () => void;
}

/** The consultant moves a session to another day or time. The database tells the other person ("Session Rescheduled") and refuses a time at which the consultant is already booked. */
export default function RescheduleSessionDialog({ open, onOpenChange, sessionId, scheduledAt, onDone }: Props) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const start = new Date(scheduledAt);
    setDate(dateKey(start));
    setTime(timeKey(start));
  }, [open, scheduledAt]);

  const save = async () => {
    const next = new Date(`${date}T${time}:00`);
    if (!date || !time || Number.isNaN(next.getTime()) || next.getTime() <= Date.now()) {
      toast.error('Choose a day and a time in the future.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('sessions').update({ scheduled_at: next.toISOString() }).eq('id', sessionId);
      if (error) throw error;
      toast.success('The session was moved. The other person is told.');
      onDone();
      onOpenChange(false);
    } catch (err) {
      toast.error('The session could not be moved', { description: friendlyErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reschedule session</DialogTitle>
          <DialogDescription>Pick the new day and time. The other person gets a notice.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="reschedule-date">Day</Label>
            <Input id="reschedule-date" type="date" value={date} min={dateKey(new Date())} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reschedule-time">Time</Label>
            <Input id="reschedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gradient-primary border-0">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move the session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
