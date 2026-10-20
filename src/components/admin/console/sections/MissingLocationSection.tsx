import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Download, MapPinOff, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionShell } from './shared';
import { DEFAULT_LOCATION_GRACE_DAYS, MAX_LOCATION_GRACE_DAYS } from '@/lib/consultantLocation';
import { missingLocationCsv, type MissingLocationRow } from '@/lib/missingLocationCsv';

const KEY = ['admin-missing-location'] as const;
const GRACE_KEY = ['admin-location-grace'] as const;

/** Loads the list through the admin-only function; before the prepared SQL is applied, falls back to a plain read without e-mail or deadlines. */
async function loadRows(): Promise<{ rows: MissingLocationRow[]; ready: boolean }> {
  const { data, error } = await (supabase as any).rpc('admin_missing_location');
  if (!error && Array.isArray(data)) return { rows: data as MissingLocationRow[], ready: true };
  const { data: cs, error: cErr } = await (supabase as any).from('consultants')
    .select('id, user_id, verification_status, created_at, country, city').order('created_at');
  if (cErr) throw cErr;
  const missing = (cs ?? []).filter((c: any) => !String(c.country ?? '').trim() || !String(c.city ?? '').trim());
  const ids = missing.map((c: any) => c.user_id);
  const { data: ps } = ids.length ? await supabase.from('profile_directory').select('user_id, display_name').in('user_id', ids) : { data: [] as any[] };
  const names = new Map((ps ?? []).map((p: any) => [p.user_id, p.display_name]));
  return {
    ready: false,
    rows: missing.map((c: any) => ({
      consultant_id: c.id, display_name: names.get(c.user_id) ?? null, email: null, verification_status: c.verification_status,
      signed_up_at: c.created_at, country: c.country, city: c.city, deadline: null, blocked: false, last_reminded_at: null,
    })),
  };
}

const MissingLocationSection = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: loadRows });
  const graceQ = useQuery({
    queryKey: GRACE_KEY,
    queryFn: async () => {
      const { data } = await supabase.from('platform_settings').select('value').eq('key', 'location_rules').maybeSingle();
      const v = (data?.value ?? null) as { grace_days?: number; grace_started_at?: string } | null;
      return v;
    },
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(String(DEFAULT_LOCATION_GRACE_DAYS));
  useEffect(() => { if (typeof graceQ.data?.grace_days === 'number') setDays(String(graceQ.data.grace_days)); }, [graceQ.data]);

  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const ready = q.data?.ready === true;
  const allChecked = rows.length > 0 && rows.every(r => selected.has(r.consultant_id));

  const remind = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await (supabase as any).rpc('admin_send_location_reminder', { _ids: ids.slice(0, 50) });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (n, ids) => {
      const skipped = Math.min(ids.length, 50) - n;
      toast.success(t('admin.missingLocation.sent', 'Reminder sent to {{n}} consultant(s).', { n }) + (skipped > 0 ? ' ' + t('admin.missingLocation.skipped', '{{n}} skipped (already reminded in the last 24 hours).', { n: skipped }) : ''));
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: any) => toast.error(e?.message || t('admin.missingLocation.sendFailed', 'Could not send the reminder. Please try again.')),
  });

  const saveGrace = useMutation({
    mutationFn: async () => {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 0 || n > MAX_LOCATION_GRACE_DAYS) throw new Error(t('admin.missingLocation.graceInvalid', 'Enter whole days between 0 and 90.'));
      const { error } = await (supabase as any).rpc('admin_set_location_grace', { _days: n });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t('admin.missingLocation.graceSaved', 'Grace period saved.')); void qc.invalidateQueries({ queryKey: GRACE_KEY }); void qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: any) => toast.error(e?.message || t('admin.missingLocation.graceFailed', 'Could not save the grace period.')),
  });

  const exportCsv = () => {
    const blob = new Blob([missingLocationCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `missing-location-${format(new Date(), 'yyyy-MM-dd')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <SectionShell
      icon={MapPinOff}
      title={t('admin.missingLocation.title', 'Who is missing location')}
      description={t('admin.missingLocation.intro', 'Consultants without a country and city. After the grace period they are hidden from search, the map and matching, and cannot place new bids or accept invitations until they add it.')}
    >
      {!ready && !q.isLoading && (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
          {t('admin.missingLocation.sqlPending', 'The location rules are not switched on yet (the prepared database update is not applied). The list below is read-only: no grace deadline, no blocking and no reminders until it is applied.')}
        </p>
      )}

      <Card className="rounded-2xl">
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin.missingLocation.graceTitle', 'Grace period')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="location-grace-days">{t('admin.missingLocation.graceDays', 'Days before blocking')}</Label>
            <Input id="location-grace-days" type="number" min={0} max={MAX_LOCATION_GRACE_DAYS} value={days} onChange={e => setDays(e.target.value)} className="w-28" disabled={!ready} />
          </div>
          <Button onClick={() => saveGrace.mutate()} disabled={!ready || saveGrace.isPending}>{t('common.save', 'Save')}</Button>
          {graceQ.data?.grace_started_at && (
            <p className="text-xs text-muted-foreground">{t('admin.missingLocation.graceFrom', 'Counted from {{date}} (or the sign-up date, if later).', { date: format(new Date(graceQ.data.grace_started_at), 'PP') })}</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">{t('admin.missingLocation.count', '{{n}} consultant(s) without a location', { n: rows.length })}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />{t('admin.missingLocation.export', 'Export CSV')}</Button>
            <Button size="sm" className="gap-1.5" disabled={!ready || !selected.size || remind.isPending} onClick={() => remind.mutate([...selected])}>
              <Send className="h-4 w-4" />{t('admin.missingLocation.sendNow', 'Send reminder now')}{selected.size ? ` (${selected.size})` : ''}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {q.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</p>
            : q.error ? <p role="alert" className="text-sm text-destructive">{(q.error as Error).message}</p>
            : !rows.length ? <p className="text-sm text-muted-foreground">{t('admin.missingLocation.none', 'Every consultant has a location.')}</p>
            : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"><Checkbox aria-label={t('admin.missingLocation.selectAll', 'Select all')} checked={allChecked} onCheckedChange={v => setSelected(v ? new Set(rows.map(r => r.consultant_id)) : new Set())} /></TableHead>
                      <TableHead>{t('admin.missingLocation.name', 'Consultant')}</TableHead>
                      <TableHead>{t('admin.missingLocation.status', 'Status')}</TableHead>
                      <TableHead>{t('admin.missingLocation.signedUp', 'Signed up')}</TableHead>
                      <TableHead>{t('admin.missingLocation.deadline', 'Deadline')}</TableHead>
                      <TableHead>{t('admin.missingLocation.lastReminder', 'Last reminder')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(r => (
                      <TableRow key={r.consultant_id} data-testid={`missing-${r.consultant_id}`}>
                        <TableCell><Checkbox aria-label={r.display_name || r.consultant_id} checked={selected.has(r.consultant_id)} onCheckedChange={() => toggle(r.consultant_id)} /></TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{r.display_name || t('admin.missingLocation.noName', 'No name')}</p>
                          {r.email && <p className="text-xs text-muted-foreground">{r.email}</p>}
                        </TableCell>
                        <TableCell className="text-xs capitalize">{r.verification_status?.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs">{r.signed_up_at ? format(new Date(r.signed_up_at), 'PP') : '-'}</TableCell>
                        <TableCell className="text-xs">
                          {r.blocked ? <Badge variant="outline" className="border-destructive/30 text-destructive">{t('admin.missingLocation.blocked', 'Hidden and blocked')}</Badge>
                            : r.deadline ? format(new Date(r.deadline), 'PP') : '-'}
                        </TableCell>
                        <TableCell className="text-xs">{r.last_reminded_at ? format(new Date(r.last_reminded_at), 'PP p') : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
        </CardContent>
      </Card>
    </SectionShell>
  );
};

export default MissingLocationSection;
