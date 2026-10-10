import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Inbox, Loader2, Mail } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { isSlotPast } from '@/lib/demoSlots';
import { toast } from 'sonner';

type Status = 'received' | 'contacted' | 'scheduled' | 'rescheduling' | 'completed' | 'cancelled';
interface Slot { date?: string; time?: string }
interface DemoRow {
  id: string;
  request_token: string;
  demo_type: string;
  scheduling_preference: string;
  full_name: string;
  email: string;
  company: string | null;
  notes: string | null;
  status: string;
  status_note: string | null;
  created_at: string;
  scheduled_date: string | null;
  scheduled_slot: string | null;
  timezone: string | null;
  meeting_format: string | null;
  proposed_slots: Slot[] | null;
  reschedule_reason: string | null;
}

const STATUSES: Status[] = ['received', 'contacted', 'scheduled', 'rescheduling', 'completed', 'cancelled'];
const STATUS_LABEL: Record<string, string> = {
  received: 'New',
  contacted: 'Contacted',
  scheduled: 'Scheduled',
  rescheduling: 'Reschedule requested',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const DEMO_LABEL: Record<string, string> = {
  'live': 'Live platform walkthrough',
  'ai-triage': 'AI triage demo',
  'pricing-roi': 'Pricing & ROI call',
  'module-deep-dive': 'Custom module deep-dive',
};
const PREFERENCE_LABEL: Record<string, string> = {
  'asap': 'As soon as possible',
  'this-week': 'This week',
  'next-week': 'Next week',
  'flexible': 'Flexible',
};
const FILTERS = [
  { id: 'action', label: 'Needs action', statuses: ['received', 'rescheduling'] },
  { id: 'open', label: 'In progress', statuses: ['contacted', 'scheduled'] },
  { id: 'closed', label: 'Closed', statuses: ['completed', 'cancelled'] },
  { id: 'all', label: 'All', statuses: STATUSES as string[] },
] as const;

function requestedTime(r: DemoRow): string {
  if (r.scheduled_date) {
    return `${r.scheduled_date}${r.scheduled_slot ? ` ${r.scheduled_slot}` : ''}${r.timezone ? ` (${r.timezone})` : ''}`;
  }
  return PREFERENCE_LABEL[r.scheduling_preference] ?? r.scheduling_preference;
}

function timePassed(r: DemoRow): boolean {
  return !!r.scheduled_date && !!r.scheduled_slot && r.status === 'received' && isSlotPast(r.scheduled_date, r.scheduled_slot, r.timezone || 'UTC');
}

function DemoRequestDialog({ row, onClose, onSaved }: { row: DemoRow; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<string>(row.status);
  const [note, setNote] = useState(row.status_note ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const slots = (row.proposed_slots ?? []).filter((s) => s.date && s.time);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('demo_requests')
      .update({ status, status_note: note.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setSaving(false);
    if (error) { toast.error('Could not save', { description: error.message }); return; }
    toast.success('Saved');
    onSaved();
  };

  const confirmSlot = async (index: number) => {
    setConfirming(index);
    const { data, error } = await supabase.functions.invoke('admin-confirm-demo-reschedule', {
      body: { request_id: row.id, slot_index: index, note: note.trim() || undefined },
    });
    setConfirming(null);
    const message = error?.message || (data as { error?: string } | null)?.error;
    if (message) { toast.error('Could not confirm this time', { description: message }); return; }
    toast.success('Time confirmed. The requester gets an e-mail.');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.full_name}{row.company ? ` · ${row.company}` : ''}</DialogTitle>
          <DialogDescription>
            {DEMO_LABEL[row.demo_type] ?? row.demo_type} · received {new Date(row.created_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">E-mail</dt>
            <dd><a className="text-primary underline underline-offset-2 break-all" href={`mailto:${row.email}`}>{row.email}</a></dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Requested time</dt>
            <dd>{requestedTime(row)}{timePassed(row) && <span className="ms-2 text-xs text-destructive">(already passed)</span>}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Format</dt>
            <dd>{row.meeting_format ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Preference</dt>
            <dd>{PREFERENCE_LABEL[row.scheduling_preference] ?? row.scheduling_preference}</dd>
          </div>
          {row.notes && (
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Notes of the requester</dt>
              <dd className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2">{row.notes}</dd>
            </div>
          )}
        </dl>

        {slots.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><CalendarClock className="w-4 h-4 text-primary" /> Times proposed by the requester</p>
            {row.reschedule_reason && <p className="text-xs text-muted-foreground italic">"{row.reschedule_reason}"</p>}
            <ul className="space-y-1.5">
              {(row.proposed_slots ?? []).map((s, i) => {
                if (!s.date || !s.time) return null;
                const past = isSlotPast(s.date, s.time, row.timezone || 'UTC');
                return (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm">
                    <span className={past ? 'line-through text-muted-foreground' : ''}>
                      {s.date} {s.time}{row.timezone ? ` (${row.timezone})` : ''}
                    </span>
                    <Button size="sm" variant="outline" disabled={past || confirming !== null} onClick={() => confirmSlot(i)}>
                      {confirming === i && <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" />}
                      Confirm this time
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-note">Note shown to the requester</Label>
            <Textarea id="demo-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="For example: we will send the meeting link by e-mail." />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href={`/demo/confirmation/${row.request_token}`} target="_blank" rel="noopener noreferrer">
              Page of the requester <ExternalLink className="w-3.5 h-3.5 ms-1.5" />
            </a>
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>Close</Button>
          <Button onClick={save} disabled={saving || (status === row.status && (note.trim() || null) === (row.status_note ?? null))}>
            {saving && <Loader2 className="w-4 h-4 me-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DemoRequestsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('action');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['admin-demo-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('demo_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data || []) as unknown as DemoRow[];
    },
  });

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of FILTERS) map[f.id] = rows.filter((r) => (f.statuses as readonly string[]).includes(r.status)).length;
    return map;
  }, [rows]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    return rows.filter((r) => (f.statuses as readonly string[]).includes(r.status));
  }, [rows, filter]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarClock className="w-6 h-6 text-primary" /> Demo requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Requests from the website. Update the status as you follow up: the requester sees it, and the note, on the page of their request.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? 'default' : 'outline'} onClick={() => setFilter(f.id)}>
            {f.label} ({counts[f.id] ?? 0})
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : error ? (
        <p className="text-sm text-destructive">The demo requests could not be loaded: {(error as Error).message}</p>
      ) : shown.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-10 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-medium">Nothing here</p>
            <p className="text-xs text-muted-foreground mt-1">No demo requests in this list.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <Card key={r.id} className="rounded-2xl border-border/50">
              <CardContent className="p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold text-sm truncate">{r.full_name}{r.company ? <span className="font-normal text-muted-foreground"> · {r.company}</span> : null}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" /> {r.email}</p>
                </div>
                <div className="text-xs text-muted-foreground basis-48 grow">
                  <p className="text-foreground">{DEMO_LABEL[r.demo_type] ?? r.demo_type}</p>
                  <p>
                    {requestedTime(r)}
                    {timePassed(r) && <span className="ms-1 text-destructive">(passed)</span>}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                <Badge variant={r.status === 'received' || r.status === 'rescheduling' ? 'default' : 'secondary'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => setSelectedId(r.id)}>Open</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <DemoRequestDialog
          key={selected.id}
          row={selected}
          onClose={() => setSelectedId(null)}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: ['admin-demo-requests'] }); setSelectedId(null); }}
        />
      )}
    </div>
  );
}
