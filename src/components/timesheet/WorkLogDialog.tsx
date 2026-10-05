import { useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CATEGORIES, MINUTE_STEPS, durationError, splitDuration, toHours, type WorkLogRow } from '@/lib/timesheet';

interface Props {
  ticketId: string;
  consultantId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** set to change an entry that is not sent yet, empty to add a new one */
  entry?: WorkLogRow | null;
  /** "50.00 USD per hour" when a rate is approved, else null */
  rateLabel: string | null;
  onSaved: () => void;
}

const today = () => format(new Date(), 'yyyy-MM-dd');

/** One activity of the timesheet: the day, how long it took, what kind of work it was, what was done, and whether the client pays for it. The rate is never typed here: it is the rate that the client approved. */
export default function WorkLogDialog({ ticketId, consultantId, open, onOpenChange, entry, rateLabel, onSaved }: Props) {
  const [date, setDate] = useState(today());
  const [hours, setHours] = useState('1');
  const [minutes, setMinutes] = useState('0');
  const [category, setCategory] = useState('support');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      const d = splitDuration(entry.hours);
      setDate(entry.work_date);
      setHours(String(d.hours));
      setMinutes(String(d.minutes));
      setCategory(entry.category || 'support');
      setDescription(entry.description ?? '');
      setBillable(entry.billable);
    } else {
      setDate(today());
      setHours('1');
      setMinutes('0');
      setCategory('support');
      setDescription('');
      setBillable(true);
    }
  }, [open, entry]);

  const minuteOptions = Array.from(new Set([...MINUTE_STEPS, Number(minutes) || 0])).sort((a, b) => a - b);

  const save = async () => {
    const h = Number(hours || 0);
    const m = Number(minutes || 0);
    const problem = durationError(h, m);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (description.trim().length < 3) {
      toast.error('Describe what was done (at least 3 characters).');
      return;
    }
    if (!date) {
      toast.error('Choose the day of the work.');
      return;
    }
    const payload = { work_date: date, hours: toHours(h, m), description: description.trim(), category, billable };
    setSaving(true);
    let message: string | null = null;
    if (entry) {
      const { data, error } = await supabase.from('ticket_work_logs').update(payload).eq('id', entry.id).select('id');
      if (error) message = error.message || 'The entry could not be changed.';
      else if (!data || data.length === 0) message = 'The entry could not be changed.';
    } else if (!consultantId) {
      message = 'Only consultants can log work.';
    } else {
      const { error } = await supabase.from('ticket_work_logs').insert({ ticket_id: ticketId, consultant_id: consultantId, ...payload });
      if (error) message = error.message || 'The entry could not be saved.';
    }
    setSaving(false);
    if (message) {
      toast.error(message);
      return;
    }
    toast.success(entry ? 'Entry changed.' : 'Entry added.');
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            {entry ? 'Change the entry' : 'Add an activity'}
          </DialogTitle>
          <DialogDescription>What was done and how long it took. The client sees every entry.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="wl-date" className="text-xs">Day</Label>
            <Input id="wl-date" type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-hours" className="text-xs">Hours</Label>
              <Input id="wl-hours" type="number" min="0" max="24" step="1" value={hours} onChange={e => setHours(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-minutes" className="text-xs">Minutes</Label>
              <select
                id="wl-minutes"
                value={minutes}
                onChange={e => setMinutes(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {minuteOptions.map(m => (
                  <option key={m} value={String(m)}>{m} min</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kind of work</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-description" className="text-xs">What was done</Label>
            <Textarea
              id="wl-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder="For example: analysed the posting error in FB60 and checked the account determination"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="mt-0.5 rounded" />
            <span>
              Billable
              <span className="block text-xs text-muted-foreground">Hours that are not billable are listed for the client but cost nothing.</span>
            </span>
          </label>
          <p className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
            {rateLabel
              ? `Hourly rate for billable hours: ${rateLabel} (approved by the client).`
              : 'Your hourly rate is not approved yet. This entry is saved now and gets the rate when the client approves it.'}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {entry ? 'Save the entry' : 'Add the entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
