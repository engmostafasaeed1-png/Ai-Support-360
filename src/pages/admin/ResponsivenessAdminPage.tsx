import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowDownUp, Download, Gauge, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import {
  recomputeResponsiveness, reviewDispute, useAdminResponsiveness, useAdminResponsivenessDisputes, useResponsivenessSettings,
  type AdminResponsivenessRow,
} from '@/hooks/useResponsiveness';
import { formatMinutes, LEVEL_LABEL, LEVEL_TONE } from '@/lib/responsivenessFormat';
import { responsivenessCsv, sortResponsivenessRows, type RespSortKey } from '@/lib/responsivenessAdmin';
import { RESP_DEFAULTS, respSettingsProblems, type RespLevel, type RespSettings } from '../../../supabase/functions/_shared/responsiveness';
import { cn } from '@/lib/utils';
import { SuccessAdminTab } from '@/components/admin/SuccessAdmin';

const FIELDS: Array<[keyof RespSettings, string]> = [
  ['min_sample', 'Minimum counted requests before anything is public'],
  ['rate_threshold', 'Needs improvement below this response rate (%)'],
  ['warnings', 'Friendly notices before the indicator shows (indicator from the next one)'],
  ['review_weight', 'Responsiveness share of the overall rating (%)'],
  ['excellent_median', 'Excellent: median under (minutes)'],
  ['excellent_rate', 'Excellent: rate at least (%)'],
  ['good_median', 'Good: median under (minutes)'],
  ['good_rate', 'Good: rate at least (%)'],
  ['fair_median', 'Fair: median under (minutes)'],
  ['chat_window', 'Client message counts as unanswered after (minutes)'],
  ['dispute_days', 'Days to dispute a no-response'],
  ['default_start', 'Hours without availability slots: from (HH:MM)'],
  ['default_end', 'Hours without availability slots: until (HH:MM)'],
];

function SettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { settings: flags, loading, updateSetting } = useAdminSettings();
  const current = useResponsivenessSettings();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const s = current.data ?? RESP_DEFAULTS;
    setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, String(s[k])])));
  }, [current.data]);
  const next = Object.fromEntries(FIELDS.map(([k]) => [k, k.startsWith('default_') ? draft[k] ?? '' : Number(draft[k])])) as unknown as RespSettings;
  const problems = respSettingsProblems(next);

  const save = async () => {
    if (problems.length) return;
    setSaving(true);
    const { error } = await supabase.from('platform_settings').upsert({ key: 'responsiveness_settings', value: next as never }, { onConflict: 'key' });
    setSaving(false);
    if (error) { toast.error(t('admin.resp_save_failed', 'The settings could not be saved.')); return; }
    toast.success(t('admin.resp_saved', 'Saved. Use "Recalculate now" to apply them to every consultant.'));
    qc.invalidateQueries({ queryKey: ['responsiveness-settings'] });
    qc.invalidateQueries({ queryKey: ['responsiveness-public'] });
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t('admin.resp_settings', 'Settings')}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 p-3">
          <div className="min-w-0">
            <Label htmlFor="responsiveness_public">{t('admin.resp_public', 'Show responsiveness to clients (cards, rating, ranking, critical alarms)')}</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.resp_public_hint', 'Off by default: statistics, friendly notices and disputes still run, but nothing shows on cards, the overall rating is unchanged, ranking ignores it and nobody is left out of critical alarms.')}</p>
          </div>
          {loading ? <Skeleton className="h-5 w-9 rounded-full" /> : (
            <Switch id="responsiveness_public" checked={flags.responsiveness_public === true} onCheckedChange={(v) => { void updateSetting('responsiveness_public', v); qc.invalidateQueries({ queryKey: ['responsiveness-public'] }); }} />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`resp-${k}`} className="text-xs">{t(`admin.resp_field_${k}`, label)}</Label>
              <Input id={`resp-${k}`} className="h-9" inputMode={k.startsWith('default_') ? 'text' : 'numeric'} value={draft[k] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('admin.resp_rank_hint', 'The ranking weight is "Responsiveness" in the match weights card under Settings (default 3).')}</p>
        {problems.length > 0 && <p role="alert" className="text-xs text-destructive">{t('admin.resp_problems', 'Please check: {{list}}', { list: problems.join(', ') })}</p>}
        <Button onClick={save} disabled={saving || problems.length > 0}>{saving && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" />}{t('common.save', 'Save')}</Button>
      </CardContent>
    </Card>
  );
}

function DisputesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useAdminResponsivenessDisputes();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, uphold: boolean) => {
    setBusy(id);
    try {
      await reviewDispute(id, uphold, notes[id] ?? '');
      toast.success(uphold ? t('admin.resp_voided', 'No-response removed from the statistics (audited).') : t('admin.resp_rejected', 'Dispute rejected (audited).'));
      qc.invalidateQueries({ queryKey: ['admin-responsiveness-disputes'] });
      qc.invalidateQueries({ queryKey: ['admin-responsiveness'] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <p className="text-sm text-muted-foreground">{t('admin.resp_unavailable', 'Not available until the responsiveness database update is applied.')}</p>;
  const rows = q.data ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t('admin.resp_no_disputes', 'No disputes.')}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((d) => (
        <li key={d.id} className="rounded-xl border border-border/60 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground"><bdi>{d.name || '—'}</bdi> · <bdi>{d.ticket_title || d.kind}</bdi></p>
              <p className="text-xs text-muted-foreground">{new Date(d.received_at).toLocaleString()} · {t('admin.resp_disputed', 'disputed')} {new Date(d.created_at).toLocaleString()}</p>
            </div>
            <span className={cn('rounded-full px-2 py-0.5 text-xs', d.status === 'pending' ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground')}>{d.status}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-xs"><bdi>{d.reason}</bdi></p>
          {d.status === 'pending' ? (
            <div className="mt-2 space-y-2">
              <Label htmlFor={`note-${d.id}`} className="text-xs">{t('admin.resp_note', 'Note to the consultant (optional, audited)')}</Label>
              <Textarea id={`note-${d.id}`} rows={2} maxLength={500} value={notes[d.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === d.id} onClick={() => act(d.id, true)}>{t('admin.resp_void', 'Void the no-response')}</Button>
                <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => act(d.id, false)}>{t('admin.resp_reject', 'Reject dispute')}</Button>
              </div>
            </div>
          ) : d.admin_note ? <p className="mt-1 text-xs text-muted-foreground">{d.admin_note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

const COLS: Array<[RespSortKey, string]> = [
  ['name', 'Consultant'], ['public_level', 'Level'], ['rate_90d', 'Response rate (90 d)'], ['median_90d', 'Median reply'],
  ['counted_90d', 'Counted (90 d)'], ['no_response_30d', 'No responses (30 d)'], ['warnings_sent', 'Friendly notices (90 d)'], ['disputes_open', 'Disputes'],
];

/** Admin "Consultant responsiveness": sortable table with filters and CSV, the disputes queue and the settings. */
export default function ResponsivenessAdminPage() {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'consultants';
  const q = useAdminResponsiveness();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<'all' | RespLevel>('all');
  const [onlyMissed, setOnlyMissed] = useState(false);
  const [sort, setSort] = useState<{ key: RespSortKey; asc: boolean }>({ key: 'rate_90d', asc: true });
  const [recomputing, setRecomputing] = useState(false);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (q.data ?? []).filter((r) =>
      (!s || (r.name ?? '').toLowerCase().includes(s))
      && (level === 'all' || r.public_level === level)
      && (!onlyMissed || r.no_response_30d > 0));
    return sortResponsivenessRows(list, sort.key, sort.asc);
  }, [q.data, search, level, onlyMissed, sort]);

  const exportCsv = () => {
    const blob = new Blob([responsivenessCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consultant-responsiveness-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const recompute = async () => {
    setRecomputing(true);
    try {
      const n = await recomputeResponsiveness();
      toast.success(t('admin.resp_recomputed', 'Recalculated {{n}} consultants.', { n }));
      qc.invalidateQueries({ queryKey: ['admin-responsiveness'] });
    } catch (e) { toast.error((e as Error).message); } finally { setRecomputing(false); }
  };

  const header = (key: RespSortKey, label: string) => (
    <TableHead key={key} aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {t(`admin.resp_col_${key}`, label)}<ArrowDownUp className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">{t('admin.resp_title', 'Consultant responsiveness')}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={recompute} disabled={recomputing}>
          {recomputing ? <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="me-1 h-4 w-4" aria-hidden="true" />}
          {t('admin.resp_recompute', 'Recalculate now')}
        </Button>
      </header>
      <Tabs value={tab} onValueChange={(v) => { params.set('tab', v); setParams(params, { replace: true }); }}>
        <TabsList>
          <TabsTrigger value="consultants">{t('admin.resp_tab_consultants', 'Consultants')}</TabsTrigger>
          <TabsTrigger value="disputes">{t('admin.resp_tab_disputes', 'Disputes')}</TabsTrigger>
          <TabsTrigger value="settings">{t('admin.resp_tab_settings', 'Settings')}</TabsTrigger>
          <TabsTrigger value="success">{t('admin.resp_tab_success', 'Success levels')}</TabsTrigger>
        </TabsList>
        <TabsContent value="consultants" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label htmlFor="resp-search" className="text-xs">{t('admin.resp_search', 'Search by name')}</Label>
              <Input id="resp-search" className="h-9 w-56" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs" id="resp-level-label">{t('admin.resp_level', 'Level')}</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
                <SelectTrigger className="h-9 w-48" aria-labelledby="resp-level-label"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.resp_all_levels', 'All levels')}</SelectItem>
                  {(Object.keys(LEVEL_LABEL) as RespLevel[]).map((l) => <SelectItem key={l} value={l}>{ar ? LEVEL_LABEL[l][1] : LEVEL_LABEL[l][0]}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <label className="flex items-center gap-2 pb-2 text-xs"><Switch checked={onlyMissed} onCheckedChange={setOnlyMissed} />{t('admin.resp_only_missed', 'Only with no-responses (30 d)')}</label>
            <Button variant="outline" size="sm" className="ms-auto" onClick={exportCsv} disabled={!rows.length}><Download className="me-1 h-4 w-4" aria-hidden="true" />CSV</Button>
          </div>
          {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError ? (
            <p className="text-sm text-muted-foreground">{t('admin.resp_unavailable', 'Not available until the responsiveness database update is applied.')}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader><TableRow>{COLS.map(([k, l]) => header(k, l))}</TableRow></TableHeader>
                <TableBody>
                  {rows.map((r: AdminResponsivenessRow) => (
                    <TableRow key={r.consultant_id}>
                      <TableCell className="font-medium"><bdi>{r.name || '—'}</bdi></TableCell>
                      <TableCell><span className={cn('rounded-full border px-2 py-0.5 text-xs', LEVEL_TONE[r.public_level])}>{ar ? LEVEL_LABEL[r.public_level][1] : LEVEL_LABEL[r.public_level][0]}</span></TableCell>
                      <TableCell>{r.rate_90d == null ? '–' : `${r.rate_90d}%`}</TableCell>
                      <TableCell>{formatMinutes(r.median_90d, ar)}</TableCell>
                      <TableCell>{r.counted_90d}</TableCell>
                      <TableCell>{r.no_response_30d}</TableCell>
                      <TableCell>{r.warnings_sent}</TableCell>
                      <TableCell>{r.disputes_open > 0 ? `${r.disputes_open} / ${r.disputes_total}` : r.disputes_total}</TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={COLS.length} className="text-center text-sm text-muted-foreground">{t('admin.resp_empty', 'No consultants match.')}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="disputes"><DisputesTab /></TabsContent>
        <TabsContent value="settings"><SettingsCard /></TabsContent>
        <TabsContent value="success"><SuccessAdminTab /></TabsContent>
      </Tabs>
    </div>
  );
}
