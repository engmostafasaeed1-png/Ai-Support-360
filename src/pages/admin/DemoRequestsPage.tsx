import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, CalendarClock, CalendarPlus, ExternalLink, Inbox, Loader2, Mail, Settings2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { isSlotPast } from '@/lib/demoSlots';
import { downloadIcs } from '@/components/demo/DemoMeetingCard';
import {
  DEMO_ALERT_DEFAULTS, DEMO_TYPE_LABELS, FORMAT_LABELS, PREFERENCE_LABELS, buildIcs, demoSlots, dueWording, formatInZone, localDate,
  readDemoSettings, replyMailto, respondByFor, validTz, type DemoAlertSettings, type DemoRequestRow,
} from '../../../supabase/functions/_shared/demoSchedule';
import { toast } from 'sonner';

type Status = 'received' | 'contacted' | 'scheduled' | 'rescheduling' | 'completed' | 'cancelled';
type DemoRow = DemoRequestRow & { request_token: string; status: string; created_at: string };

const STATUSES: Status[] = ['received', 'contacted', 'scheduled', 'rescheduling', 'completed', 'cancelled'];
const STATUS_LABEL: Record<string, string> = {
  received: 'New', contacted: 'Contacted', scheduled: 'Scheduled', rescheduling: 'Reschedule requested', completed: 'Completed', cancelled: 'Cancelled',
};
const FILTERS = [
  { id: 'action', label: 'Needs action', statuses: ['received', 'rescheduling'] },
  { id: 'open', label: 'In progress', statuses: ['contacted', 'scheduled'] },
  { id: 'closed', label: 'Closed', statuses: ['completed', 'cancelled'] },
  { id: 'all', label: 'All', statuses: STATUSES as string[] },
] as const;
const NOT_INSTALLED = 'This starts once the database update for demo scheduling is applied.';
const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const needsAction = (r: DemoRow) => r.source !== 'contact-form' && (r.status === 'received' || r.status === 'rescheduling') && !r.meeting_at;

function requestedTime(r: DemoRow): string {
  if (r.scheduled_date) return `${r.scheduled_date}${r.scheduled_slot ? ` ${r.scheduled_slot}` : ''}${r.timezone ? ` (${r.timezone})` : ''}`;
  return PREFERENCE_LABELS.en[r.scheduling_preference ?? ''] ?? r.scheduling_preference ?? '';
}
function deadlineOf(r: DemoRow, s: DemoAlertSettings): Date {
  return r.respond_by ? new Date(r.respond_by) : respondByFor(new Date(r.created_at), s);
}
async function invokeAdmin(body: Record<string, unknown>): Promise<{ ok: boolean; message?: string; email?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-confirm-demo-reschedule', { body });
    const d = data as { error?: string; email?: string } | null;
    let msg = d?.error;
    if (!msg && error) {
      try { msg = (await (error as { context?: Response }).context?.json())?.error; } catch { /* keep generic */ }
      msg = msg || error.message;
    }
    if (msg) return { ok: false, message: msg === 'not_installed' ? NOT_INSTALLED : msg };
    return { ok: true, email: d?.email };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not reach the server' };
  }
}

function DeadlineBadge({ row, settings, now }: { row: DemoRow; settings: DemoAlertSettings; now: Date }) {
  if (!needsAction(row)) return null;
  const due = deadlineOf(row, settings);
  const w = dueWording(due, now);
  return (
    <Badge variant={w.overdue ? 'destructive' : 'outline'} className="gap-1" title={`Respond by ${formatInZone(due, HERE)}`}>
      <AlarmClock className="w-3 h-3" /> {w.text}
    </Badge>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function DemoRequestDialog({ row, settings, focus, onClose, onSaved }: {
  row: DemoRow; settings: DemoAlertSettings; focus: 'schedule' | 'propose' | null; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>(row.status);
  const [note, setNote] = useState(row.status_note ?? '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const now = new Date();
  const reqTz = validTz(row.timezone) ? row.timezone! : 'UTC';
  const slots = demoSlots(row, HERE, 'en', now);
  const firstFuture = slots.find((s) => !s.past && s.kind === 'requested');
  const mailto = replyMailto(row);
  const closed = row.status === 'completed' || row.status === 'cancelled';

  // schedule / propose form (time is entered in the chosen zone; default the requester's)
  const [tz, setTz] = useState(reqTz);
  const [date, setDate] = useState(focus === 'schedule' && firstFuture ? firstFuture.date : row.meeting_at ? localDate(new Date(row.meeting_at), reqTz) : '');
  const [time, setTime] = useState(focus === 'schedule' && firstFuture ? firstFuture.time.slice(0, 5) : row.meeting_at ? formatInZone(new Date(row.meeting_at), reqTz, 'en', false).slice(-5) : '');
  const [duration, setDuration] = useState(String(row.meeting_duration_min ?? settings.default_duration_min));
  const [link, setLink] = useState(row.meeting_link ?? '');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); }, [focus]);

  const planned = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [y, m, d] = date.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
    // same conversion as the database: wall time in the chosen zone
    const off = (dt: Date) => { const p = formatInZone(dt, tz, 'en', false); void p; return 0; };
    void off;
    return demoSlots({ ...row, scheduled_date: date, scheduled_slot: time, timezone: tz, proposed_slots: null }, HERE, 'en', now)[0] ?? (guess ? null : null);
  }, [date, time, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const durationN = Number(duration);
  const scheduleBlock = closed ? 'This demo is closed.'
    : !date || !time ? 'Pick a date and a time first.'
    : planned?.past ? 'This time has already passed.'
    : !(durationN >= 15 && durationN <= 240) ? 'Duration must be 15 to 240 minutes.'
    : link.trim() && !/^https:\/\/[^\s/@:]+\.[^\s/@:]+(\/\S*)?$/.test(link.trim()) ? 'The meeting link must be a full https:// address.'
    : null;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('demo_requests').update({ status, status_note: note.trim() || null, updated_at: new Date().toISOString() }).eq('id', row.id);
    setSaving(false);
    if (error) { toast.error('Could not save', { description: error.message }); return; }
    toast.success('Saved');
    onSaved();
  };
  const confirmSlot = async (index: number) => {
    setConfirming(index);
    const r = await invokeAdmin({ request_id: row.id, slot_index: index, note: note.trim() || undefined });
    setConfirming(null);
    if (!r.ok) { toast.error('Could not confirm this time', { description: r.message }); return; }
    toast.success('Time confirmed. The requester gets an e-mail.');
    onSaved();
  };
  const schedule = async () => {
    setScheduling(true);
    const r = await invokeAdmin({ action: 'schedule', request_id: row.id, date, time, tz, duration_min: durationN, meeting_link: link.trim() || null, note: scheduleNote.trim() || null });
    setScheduling(false);
    if (!r.ok) { toast.error('Could not schedule the demo', { description: r.message }); return; }
    toast.success(row.meeting_at ? 'New time saved' : 'Demo scheduled', { description: r.email === 'sent' ? 'The requester gets an e-mail with the time and calendar button.' : 'Saved. The e-mail to the requester was not sent.' });
    onSaved();
  };
  const cancel = async () => {
    setScheduling(true);
    const r = await invokeAdmin({ action: 'cancel', request_id: row.id, reason: cancelReason.trim() || null });
    setScheduling(false);
    if (!r.ok) { toast.error('Could not cancel the demo', { description: r.message }); return; }
    toast.success('Demo cancelled', { description: r.email === 'sent' ? 'The requester gets an e-mail.' : undefined });
    onSaved();
  };
  const tentative = (s: (typeof slots)[number], i: number) => {
    if (!s.start) return;
    downloadIcs(`demo-${row.full_name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}-${i + 1}.ics`, buildIcs({
      uid: `demo-${row.id}-slot-${i}`, start: new Date(s.start), durationMin: settings.default_duration_min, status: 'TENTATIVE',
      title: `Demo (tentative): ${row.full_name}${row.company ? ` · ${row.company}` : ''}`,
      description: `Preferred by the requester: ${s.asEntered}. Confirm on ${window.location.origin}/admin/demo-requests?request=${row.id}`,
      url: `${window.location.origin}/admin/demo-requests?request=${row.id}`,
    }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {row.full_name}{row.company ? <span className="font-normal text-muted-foreground">· {row.company}</span> : null}
            <DeadlineBadge row={row} settings={settings} now={now} />
          </DialogTitle>
          <DialogDescription>
            {DEMO_TYPE_LABELS.en[row.demo_type] ?? row.demo_type} · received {formatInZone(new Date(row.created_at), HERE)}
          </DialogDescription>
        </DialogHeader>

        {needsAction(row) && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="font-semibold">What you need to do</p>
            <p>Confirm a time within {settings.respond_business_hours} business hour{settings.respond_business_hours === 1 ? '' : 's'}: respond by {formatInZone(deadlineOf(row, settings), HERE)}.</p>
          </div>
        )}

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="E-mail"><a className="text-primary underline underline-offset-2 break-all" href={`mailto:${row.email}`}>{row.email}</a></Field>
          {row.phone && <Field label="Phone / WhatsApp">{row.phone}</Field>}
          {row.requester_role && <Field label="Role">{row.requester_role}</Field>}
          {row.sap_area && <Field label="SAP area / module">{row.sap_area}</Field>}
          <Field label="Time zone">{row.timezone ?? '—'}</Field>
          {row.language && <Field label="Language">{row.language === 'ar' ? 'Arabic' : 'English'}</Field>}
          <Field label="Format">{FORMAT_LABELS.en[row.meeting_format ?? ''] ?? row.meeting_format ?? '—'}</Field>
          <Field label="Preference">{PREFERENCE_LABELS.en[row.scheduling_preference ?? ''] ?? row.scheduling_preference ?? '—'}</Field>
          {row.source && <Field label="Source page">{row.source}</Field>}
          {row.meeting_at && <Field label={row.status === 'cancelled' ? 'Was scheduled' : 'Scheduled'} wide>{formatInZone(new Date(row.meeting_at), HERE)}{reqTz !== HERE ? ` · theirs: ${formatInZone(new Date(row.meeting_at), reqTz)}` : ''}</Field>}
          {row.notes && <Field label="What they want to see" wide><span className="block whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2">{row.notes}</span></Field>}
        </dl>

        <div className="space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5"><CalendarClock className="w-4 h-4 text-primary" /> Preferred times</p>
          {row.reschedule_reason && <p className="text-xs text-muted-foreground italic">"{row.reschedule_reason}"</p>}
          {slots.length === 0 ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">No preference: no date or time was picked ({PREFERENCE_LABELS.en[row.scheduling_preference ?? ''] ?? 'flexible'}). Propose a time below.</p>
          ) : (
            <ul className="space-y-1.5">
              {slots.map((s, i) => {
                const proposedIndex = s.kind === 'proposed' ? slots.slice(0, i).filter((x) => x.kind === 'proposed').length : -1;
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm">
                    <span className={s.past ? 'line-through text-muted-foreground' : ''}>
                      <span className="font-medium">{s.admin || s.asEntered}</span>
                      <span className="block text-xs text-muted-foreground">Theirs: {s.requester} · as entered: {s.asEntered}{s.kind === 'proposed' ? ' · proposed later' : ''}</span>
                    </span>
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="ghost" reason={(!s.start || s.past) && 'date_in_past'} onClick={() => tentative(s, i)} title="Download a tentative calendar entry">
                        <CalendarPlus className="w-3.5 h-3.5 me-1" /> .ics
                      </Button>
                      {s.kind === 'proposed' && row.status === 'rescheduling' ? (
                        <Button size="sm" variant="outline" reason={s.past && 'date_in_past'} busy={confirming !== null} onClick={() => confirmSlot(proposedIndex)}>
                          {confirming === proposedIndex && <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" />} Confirm this time
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" reason={[closed && { key: 'fix_errors_first', message: 'This demo is closed.' }, s.past && 'date_in_past']} onClick={() => { setTz(reqTz); setDate(s.date); setTime(s.time.slice(0, 5)); formRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>
                          Use this time
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div ref={formRef} className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-semibold">{row.meeting_at && row.status === 'scheduled' ? 'Move the demo' : focus === 'propose' ? 'Propose a time' : 'Schedule the demo'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label htmlFor="ds-date">Date</Label><Input id="ds-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="ds-time">Time</Label><Input id="ds-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label>Time zone of this time</Label>
              <Select value={tz} onValueChange={setTz}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={reqTz}>Theirs ({reqTz})</SelectItem>
                  {HERE !== reqTz && <SelectItem value={HERE}>Mine ({HERE})</SelectItem>}
                  {settings.admin_timezone !== reqTz && settings.admin_timezone !== HERE && <SelectItem value={settings.admin_timezone}>Team ({settings.admin_timezone})</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="ds-dur">Duration (minutes)</Label><Input id="ds-dur" type="number" min={15} max={240} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ds-link">Meeting link (optional, https)</Label><Input id="ds-link" value={link} maxLength={500} onChange={(e) => setLink(e.target.value)} placeholder="https://teams.microsoft.com/…" /></div>
          </div>
          {planned?.start && <p className="text-xs text-muted-foreground">Mine: {planned.admin} · theirs: {formatInZone(new Date(planned.start), reqTz)}</p>}
          <div className="space-y-1.5"><Label htmlFor="ds-note">Note in the e-mail (optional)</Label><Textarea id="ds-note" rows={2} maxLength={500} value={scheduleNote} onChange={(e) => setScheduleNote(e.target.value)} placeholder="For example: we will start with the FI-AA runs." /></div>
          <p className="text-xs text-muted-foreground">The requester gets an e-mail in their language with the time in their zone, an add-to-calendar button and their request page, where the meeting link is shown.</p>
          <Button onClick={schedule} busy={scheduling} reason={scheduleBlock && { key: 'fix_errors_first', message: scheduleBlock }} hint="inline">
            {scheduling && <Loader2 className="w-4 h-4 me-1.5 animate-spin" />}
            {row.meeting_at && row.status === 'scheduled' ? 'Save new time and e-mail them' : 'Confirm time and e-mail them'}
          </Button>
        </div>

        {!closed && (
          <div className="space-y-2">
            {!cancelOpen ? (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelOpen(true)}><XCircle className="w-4 h-4 me-1.5" /> Cancel this demo…</Button>
            ) : (
              <div className="space-y-2 rounded-xl border border-destructive/40 p-3">
                <Label htmlFor="ds-cancel">Reason shown to the requester (optional)</Label>
                <Textarea id="ds-cancel" rows={2} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" busy={scheduling} onClick={cancel}>Cancel demo and e-mail them</Button>
                  <Button variant="outline" size="sm" onClick={() => setCancelOpen(false)}>Keep it</Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 border-t border-border/50 pt-3">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Changing the status here sends no e-mail. Use the forms above to confirm, move or cancel.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-note">Note shown to the requester</Label>
            <Textarea id="demo-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="For example: we will send the meeting link by e-mail." />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          {mailto && <Button asChild variant="ghost" size="sm"><a href={mailto}><Mail className="w-3.5 h-3.5 me-1.5" /> Reply to requester</a></Button>}
          <Button asChild variant="ghost" size="sm">
            <a href={`/demo/confirmation/${row.request_token}`} target="_blank" rel="noopener noreferrer">Page of the requester <ExternalLink className="w-3.5 h-3.5 ms-1.5" /></a>
          </Button>
          <Button variant="outline" onClick={onClose} busy={saving}>Close</Button>
          <Button onClick={save} busy={saving} reason={(status === row.status && (note.trim() || null) === (row.status_note ?? null)) && 'nothing_changed'}>
            {saving && <Loader2 className="w-4 h-4 me-1.5 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlertSettingsCard({ settings, installed, onSaved }: { settings: DemoAlertSettings; installed: boolean; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [hours, setHours] = useState(String(settings.respond_business_hours));
  const [tz, setTz] = useState(settings.admin_timezone);
  const [daily, setDaily] = useState(String(settings.daily_reminders_max));
  const [dur, setDur] = useState(String(settings.default_duration_min));
  const [busy, setBusy] = useState(false);
  const h = Number(hours), d = Number(daily), m = Number(dur);
  const problem = !installed ? NOT_INSTALLED
    : !(h >= 0.25 && h <= 72) ? 'Response time must be 0.25 to 72 business hours.'
    : !validTz(tz) ? 'Enter a valid time zone, for example Asia/Riyadh.'
    : !(Number.isInteger(d) && d >= 0 && d <= 2) ? 'Daily reminders must be 0, 1 or 2.'
    : !(m >= 15 && m <= 240) ? 'Duration must be 15 to 240 minutes.' : null;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_demo_alert_set_settings' as never, { _enabled: enabled, _respond_business_hours: h, _admin_timezone: tz, _daily_reminders_max: d, _default_duration_min: m } as never);
    setBusy(false);
    if (error) { toast.error('Could not save the settings', { description: error.message }); return; }
    toast.success('Demo alert settings saved');
    onSaved();
  };
  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold flex items-center gap-1.5"><Settings2 className="w-4 h-4 text-primary" /> Demo alert settings</p>
            <p className="text-xs text-muted-foreground">The team gets "Demo booked: schedule needed" by e-mail and in the bell, then a reminder at the deadline and at most the daily reminders below until a time is confirmed. Business hours: Sun–Thu 08:00–18:00 ({settings.calendar.tz}).</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Send demo alerts and reminders" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5"><Label htmlFor="da-h">Confirm within (business hours)</Label><Input id="da-h" type="number" min={0.25} max={72} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="da-tz">Team time zone (e-mails)</Label><Input id="da-tz" value={tz} onChange={(e) => setTz(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="da-d">Daily reminders after the first</Label><Input id="da-d" type="number" min={0} max={2} value={daily} onChange={(e) => setDaily(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="da-m">Default length (minutes)</Label><Input id="da-m" type="number" min={15} max={240} step={15} value={dur} onChange={(e) => setDur(e.target.value)} /></div>
        </div>
        <Button size="sm" onClick={save} busy={busy} reason={problem && { key: 'fix_errors_first', message: problem }} hint="inline">Save settings</Button>
      </CardContent>
    </Card>
  );
}

export default function DemoRequestsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('action');
  const [showSettings, setShowSettings] = useState(false);
  const selectedId = params.get('request');
  const focusParam = params.get('action');
  const focus = focusParam === 'schedule' || focusParam === 'propose' ? focusParam : null;
  const select = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('request', id); else { n.delete('request'); n.delete('action'); } return n; }, { replace: true });

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['admin-demo-requests'],
    queryFn: async () => {
      const { data, error } = await supabase.from('demo_requests').select('*').order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      return (data || []) as unknown as DemoRow[];
    },
  });
  const { data: settingsRes } = useQuery({
    queryKey: ['admin-demo-alert-settings'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc('admin_demo_alert_settings' as never);
        if (error) return { installed: false, settings: DEMO_ALERT_DEFAULTS };
        return { installed: true, settings: readDemoSettings(data) };
      } catch { return { installed: false, settings: DEMO_ALERT_DEFAULTS }; }
    },
  });
  const settings = settingsRes?.settings ?? DEMO_ALERT_DEFAULTS;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);

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
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['admin-demo-requests'] }); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarClock className="w-6 h-6 text-primary" /> Demo requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Requests from the website. Confirm a time within {settings.respond_business_hours} business hour{settings.respond_business_hours === 1 ? '' : 's'}; the requester is e-mailed when you confirm, move or cancel.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)}><Settings2 className="w-4 h-4 me-1.5" /> Alert settings</Button>
      </div>

      {showSettings && <AlertSettingsCard key={JSON.stringify(settings)} settings={settings} installed={!!settingsRes?.installed} onSaved={() => void queryClient.invalidateQueries({ queryKey: ['admin-demo-alert-settings'] })} />}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? 'default' : 'outline'} onClick={() => setFilter(f.id)}>{f.label} ({counts[f.id] ?? 0})</Button>
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
                  <p className="text-foreground">{DEMO_TYPE_LABELS.en[r.demo_type] ?? r.demo_type}</p>
                  <p>
                    {r.meeting_at && r.status === 'scheduled' ? `Scheduled: ${formatInZone(new Date(r.meeting_at), HERE)}` : requestedTime(r)}
                    {!r.meeting_at && r.scheduled_date && r.scheduled_slot && r.status === 'received' && isSlotPast(r.scheduled_date, r.scheduled_slot, r.timezone || 'UTC') && <span className="ms-1 text-destructive">(passed)</span>}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                <DeadlineBadge row={r} settings={settings} now={now} />
                <Badge variant={r.status === 'received' || r.status === 'rescheduling' ? 'default' : 'secondary'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => select(r.id)}>Open</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <DemoRequestDialog
          key={selected.id}
          row={selected}
          settings={settings}
          focus={focus}
          onClose={() => select(null)}
          onSaved={() => { refresh(); select(null); }}
        />
      )}
    </div>
  );
}
