import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CalendarClock, Download, PauseCircle, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionShell } from './shared';
import { toLocalInput } from '@/components/consultant/HoldDialog';
import { ADMIN_REMINDER_BATCH, missingAvailabilityCsv, remindable, type AdminHoldRow, type MissingAvailabilityRow } from '@/lib/availabilityAdmin';
import { AVAILABILITY_GRACE_MAX, HOLD_MAX_DAYS_LIMIT } from '@/lib/availabilityRules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const KEY = ['admin-availability'] as const;

interface Counts {
  consultants: number; missing: number; blocked: number; on_hold: number; upcoming_holds: number; reminders_today: number;
  required: boolean; grace_days: number; grace_started_at: string | null; hold_max_days: number; hold_directory: 'label' | 'hide';
}

async function load(): Promise<{ ready: boolean; counts: Counts | null; rows: MissingAvailabilityRow[]; holds: AdminHoldRow[] }> {
  const c = await db.rpc('admin_availability_counts');
  if (c.error) return { ready: false, counts: null, rows: [], holds: [] };
  const [m, h] = await Promise.all([db.rpc('admin_missing_availability'), db.rpc('admin_holds')]);
  if (m.error) throw m.error;
  if (h.error) throw h.error;
  return { ready: true, counts: c.data as Counts, rows: (m.data ?? []) as MissingAvailabilityRow[], holds: (h.data ?? []) as AdminHoldRow[] };
}

/** Feature Y admin page: who is missing weekly availability, reminders, settings and all current/upcoming holds. */
export default function AvailabilityAdminSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: load });
  const data = q.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grace, setGrace] = useState('7');
  const [maxDays, setMaxDays] = useState('90');
  const [mode, setMode] = useState<'label' | 'hide'>('label');
  const [required, setRequired] = useState(true);
  const [clearing, setClearing] = useState<AdminHoldRow | null>(null);
  const [clearReason, setClearReason] = useState('');
  const [setFor, setSetFor] = useState<{ id: string; name: string } | null>(null);
  const [holdEnd, setHoldEnd] = useState('');
  const [holdReason, setHoldReason] = useState('');

  useEffect(() => {
    const c = data?.counts;
    if (!c) return;
    setGrace(String(c.grace_days)); setMaxDays(String(c.hold_max_days)); setMode(c.hold_directory); setRequired(c.required);
  }, [data?.counts]);

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const remind = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data: n, error } = await db.rpc('admin_send_availability_reminder', { _ids: ids.slice(0, ADMIN_REMINDER_BATCH) });
      if (error) throw error;
      return Number(n ?? 0);
    },
    onSuccess: (n, ids) => {
      const skipped = Math.min(ids.length, ADMIN_REMINDER_BATCH) - n;
      toast.success(t('admin.availability.sent', 'Reminder sent to {{n}} consultant(s).', { n }) + (skipped > 0 ? ' ' + t('admin.availability.skipped', '{{n}} skipped (on hold or reminded in the last 24 hours).', { n: skipped }) : ''));
      setSelected(new Set()); void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const g = Number(grace), m = Number(maxDays);
      if (!Number.isInteger(g) || g < 0 || g > AVAILABILITY_GRACE_MAX) throw new Error(t('admin.availability.graceInvalid', 'Enter whole days between 0 and 90.'));
      if (!Number.isInteger(m) || m < 1 || m > HOLD_MAX_DAYS_LIMIT) throw new Error(t('admin.availability.maxInvalid', 'Enter whole days between 1 and 365.'));
      const { error } = await db.rpc('admin_set_availability_settings', { _grace_days: g, _hold_max_days: m, _hold_directory: mode, _required: required });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t('admin.availability.saved', 'Settings saved.')); void refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc('admin_clear_hold', { _cid: clearing!.consultant_id, _reason: clearReason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t('admin.availability.cleared', 'Hold cleared (recorded in the audit log).')); setClearing(null); setClearReason(''); void refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setHold = useMutation({
    mutationFn: async () => {
      if (!holdEnd) throw new Error(t('admin.availability.endRequired', 'Choose when the hold ends.'));
      const { error } = await db.rpc('admin_set_hold', { _cid: setFor!.id, _starts_at: null, _ends_at: new Date(holdEnd).toISOString(), _reason: holdReason.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t('admin.availability.holdSet', 'Hold set (recorded in the audit log).')); setSetFor(null); setHoldEnd(''); setHoldReason(''); void refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    const blob = new Blob([missingAvailabilityCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `missing-availability-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.consultant_id));
  const c = data?.counts;

  return (
    <SectionShell icon={CalendarClock} title={t('admin.availability.title', 'Availability')}
      description={t('admin.availability.intro', 'Weekly availability is a required profile item. After the grace period, consultants without it are left out of new matching, critical alerts and the directory; sign-in and existing work are never blocked. Holds pause new requests between two dates.')}>
      {!q.isLoading && data && !data.ready && (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
          {t('admin.availability.sqlPending', 'The availability rules and holds are not switched on yet (the prepared database update is not applied). Nothing is sent or hidden until it is applied.')}
        </p>
      )}
      {q.error && <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>}

      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="availability-counts">
          {[
            [t('admin.availability.missing', 'Missing weekly availability'), `${c.missing} / ${c.consultants}`],
            [t('admin.availability.blocked', 'Left out of new matching'), c.blocked],
            [t('admin.availability.onHold', 'On hold now'), c.on_hold],
            [t('admin.availability.upcoming', 'Holds coming up'), c.upcoming_holds],
            [t('admin.availability.today', 'Reminders today'), c.reminders_today],
          ].map(([label, value]) => (
            <Card key={String(label)} className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></CardContent></Card>
          ))}
        </div>
      )}

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin.availability.settings', 'Settings')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="availability-grace">{t('admin.availability.graceDays', 'Grace period (days)')}</Label>
            <Input id="availability-grace" type="number" min={0} max={AVAILABILITY_GRACE_MAX} value={grace} onChange={(e) => setGrace(e.target.value)} className="w-28" disabled={!data?.ready} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hold-max">{t('admin.availability.holdMax', 'Longest hold (days)')}</Label>
            <Input id="hold-max" type="number" min={1} max={HOLD_MAX_DAYS_LIMIT} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} className="w-28" disabled={!data?.ready} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hold-mode">{t('admin.availability.holdMode', 'Consultants on hold in the directory')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'label' | 'hide')} disabled={!data?.ready}>
              <SelectTrigger id="hold-mode" className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="label">{t('admin.availability.modeLabel', 'Show with "On hold until" (not selectable)')}</SelectItem>
                <SelectItem value="hide">{t('admin.availability.modeHide', 'Hide while on hold')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={required} onCheckedChange={setRequired} disabled={!data?.ready} aria-label={t('admin.availability.required', 'Weekly availability is required')} />
            {t('admin.availability.required', 'Weekly availability is required')}
          </label>
          <Button onClick={() => save.mutate()} disabled={!data?.ready || save.isPending}>{t('common.save', 'Save')}</Button>
          {c?.grace_started_at && <p className="basis-full text-xs text-muted-foreground">{t('admin.availability.graceFrom', 'Counted from {{date}} (or the sign-up date, if later). Every change is recorded in the audit log.', { date: format(new Date(c.grace_started_at), 'PP') })}</p>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">{t('admin.availability.listTitle', '{{n}} consultant(s) without weekly availability', { n: rows.length })}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" aria-hidden="true" />{t('admin.availability.export', 'Export CSV')}</Button>
            <Button size="sm" className="gap-1.5" disabled={!data?.ready || !selected.size || remind.isPending} onClick={() => remind.mutate([...selected])}>
              <Send className="h-4 w-4" aria-hidden="true" />{t('admin.availability.sendNow', 'Send reminder now')}{selected.size ? ` (${Math.min(selected.size, ADMIN_REMINDER_BATCH)})` : ''}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {q.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</p>
            : !rows.length ? <p className="text-sm text-muted-foreground">{data?.ready ? t('admin.availability.none', 'Every consultant has weekly availability.') : '-'}</p>
            : (
              <div className="overflow-x-auto">
                <p className="mb-2 text-xs text-muted-foreground">{t('admin.availability.batch', 'At most {{n}} per click; each consultant at most once per 24 hours. {{r}} can be reminded now.', { n: ADMIN_REMINDER_BATCH, r: remindable(rows).length })}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"><Checkbox aria-label={t('admin.availability.selectAll', 'Select all')} checked={allChecked} onCheckedChange={(v) => setSelected(v ? new Set(remindable(rows).slice(0, ADMIN_REMINDER_BATCH).map((r) => r.consultant_id)) : new Set())} /></TableHead>
                      <TableHead>{t('admin.availability.name', 'Consultant')}</TableHead>
                      <TableHead>{t('admin.availability.days', 'Days since sign-up')}</TableHead>
                      <TableHead>{t('admin.availability.deadline', 'Grace deadline')}</TableHead>
                      <TableHead>{t('admin.availability.lastReminder', 'Last reminder')}</TableHead>
                      <TableHead>{t('admin.availability.actions', 'Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.consultant_id} data-testid={`missing-availability-${r.consultant_id}`}>
                        <TableCell><Checkbox aria-label={r.display_name || r.consultant_id} checked={selected.has(r.consultant_id)} onCheckedChange={() => toggle(r.consultant_id)} /></TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{r.display_name || t('admin.availability.noName', 'No name')}</p>
                          {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
                        </TableCell>
                        <TableCell className="text-xs">{r.days_since_signup ?? '-'}</TableCell>
                        <TableCell className="text-xs">
                          {r.on_hold ? <Badge variant="outline">{t('admin.availability.isOnHold', 'On hold')}</Badge>
                            : r.blocked ? <Badge variant="outline" className="border-destructive/30 text-destructive">{t('admin.availability.isBlocked', 'Left out of new matching')}</Badge>
                            : r.deadline ? format(new Date(r.deadline), 'PP') : '-'}
                        </TableCell>
                        <TableCell className="text-xs">{r.last_reminded_at ? `${format(new Date(r.last_reminded_at), 'PP p')} (${r.reminders})` : '-'}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => setSetFor({ id: r.consultant_id, name: r.display_name || r.consultant_id })} disabled={r.on_hold}><PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />{t('admin.availability.setHold', 'Set hold')}</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin.availability.holdsTitle', 'Current and upcoming holds')}</CardTitle></CardHeader>
        <CardContent>
          {!(data?.holds.length) ? <p className="text-sm text-muted-foreground">{t('admin.availability.noHolds', 'No consultant is on hold.')}</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.availability.name', 'Consultant')}</TableHead>
                    <TableHead>{t('admin.availability.period', 'Period')}</TableHead>
                    <TableHead>{t('admin.availability.reason', 'Reason')}</TableHead>
                    <TableHead>{t('admin.availability.actions', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.holds.map((h) => (
                    <TableRow key={h.hold_id} data-testid={`hold-${h.hold_id}`}>
                      <TableCell className="text-sm font-medium">{h.display_name || h.consultant_id}<Badge variant="outline" className="ms-2">{h.state === 'current' ? t('admin.availability.current', 'Now') : t('admin.availability.upcomingOne', 'Upcoming')}</Badge></TableCell>
                      <TableCell className="text-xs">{format(new Date(h.starts_at), 'PP p')} – {format(new Date(h.ends_at), 'PP p')}</TableCell>
                      <TableCell className="max-w-64 text-xs">{h.set_by_admin ? `${t('admin.availability.byAdmin', 'Administrator')}: ${h.admin_reason ?? ''}` : (h.reason || '-')}</TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => setClearing(h)}>{t('admin.availability.clear', 'Clear hold')}</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!clearing} onOpenChange={(v) => { if (!v) setClearing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.availability.clearTitle', 'Clear this hold')}</DialogTitle>
            <DialogDescription>{t('admin.availability.clearText', 'The consultant comes back at once (or the planned hold is cancelled) and is told. The reason is recorded in the audit log.')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="clear-reason">{t('admin.availability.reasonRequired', 'Reason (required)')}</Label>
          <Textarea id="clear-reason" rows={2} maxLength={500} value={clearReason} onChange={(e) => setClearReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearing(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={() => clear.mutate()} disabled={clearReason.trim().length < 3 || clear.isPending}>{t('admin.availability.clear', 'Clear hold')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!setFor} onOpenChange={(v) => { if (!v) setSetFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.availability.setTitle', 'Set {{name}} on hold', { name: setFor?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('admin.availability.setText', 'Starts now. No new requests, invitations or critical alerts until the end; current work continues and clients of active tickets get a short notice. Recorded in the audit log.')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="admin-hold-end">{t('admin.availability.ends', 'Ends (required)')}</Label>
              <Input id="admin-hold-end" type="datetime-local" min={toLocalInput(new Date())} value={holdEnd} onChange={(e) => setHoldEnd(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="admin-hold-reason">{t('admin.availability.reasonRequired', 'Reason (required)')}</Label>
              <Textarea id="admin-hold-reason" rows={2} maxLength={500} value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetFor(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={() => setHold.mutate()} disabled={!holdEnd || holdReason.trim().length < 3 || setHold.isPending}>{t('admin.availability.setHold', 'Set hold')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}
