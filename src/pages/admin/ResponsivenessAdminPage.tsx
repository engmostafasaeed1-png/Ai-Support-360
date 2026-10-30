import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowDown, ArrowDownUp, ArrowUp, CheckCircle2, Clock, Download, Eye, EyeOff, Gauge, Inbox, Loader2,
  MessageSquareWarning, RefreshCw, Scale, Search, SlidersHorizontal, Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import AdminEmailChoice from '@/components/admin/AdminEmailChoice';
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
import { responsivenessCsv, responsivenessSummary, sortResponsivenessRows, type RespSortKey } from '@/lib/responsivenessAdmin';
import { LEVEL_ORDER, RESP_DEFAULTS, respSettingsProblems, type RespLevel, type RespSettings } from '../../../supabase/functions/_shared/responsiveness';
import { cn } from '@/lib/utils';
import { SuccessAdminTab } from '@/components/admin/SuccessAdmin';

type Unit = 'min' | 'pct' | 'days' | 'count' | 'time';
type Field = [keyof RespSettings, string, Unit];

/** Settings grouped into sections; keys and validation are unchanged. */
const SECTIONS: Array<{ id: string; title: string; hint: string; fields: Field[] }> = [
  {
    id: 'counting', title: 'Counting rules', hint: 'What counts as a request and when the numbers become public.',
    fields: [
      ['min_sample', 'Minimum counted requests before anything is public', 'count'],
      ['chat_window', 'Client message counts as unanswered after (minutes)', 'min'],
      ['dispute_days', 'Days to dispute a no-response', 'days'],
      ['warnings', 'Friendly notices before the indicator shows (indicator from the next one)', 'count'],
    ],
  },
  {
    id: 'levels', title: 'Level thresholds', hint: 'Median reply time and response rate needed for each level.',
    fields: [
      ['excellent_median', 'Excellent: median under (minutes)', 'min'],
      ['excellent_rate', 'Excellent: rate at least (%)', 'pct'],
      ['good_median', 'Good: median under (minutes)', 'min'],
      ['good_rate', 'Good: rate at least (%)', 'pct'],
      ['fair_median', 'Fair: median under (minutes)', 'min'],
      ['rate_threshold', 'Needs improvement below this response rate (%)', 'pct'],
    ],
  },
  {
    id: 'rating', title: 'Rating', hint: 'How much responsiveness weighs in the overall rating clients see.',
    fields: [['review_weight', 'Responsiveness share of the overall rating (%)', 'pct']],
  },
  {
    id: 'hours', title: 'Default working hours', hint: 'Used for consultants who have not set availability slots.',
    fields: [
      ['default_start', 'Hours without availability slots: from (HH:MM)', 'time'],
      ['default_end', 'Hours without availability slots: until (HH:MM)', 'time'],
    ],
  },
];
const FIELDS: Field[] = SECTIONS.flatMap((s) => s.fields);

const UNIT_LABEL: Record<Unit, [string, string] | null> = {
  min: ['min', 'دقيقة'], pct: ['%', '%'], days: ['days', 'أيام'], count: null, time: null,
};

/** Solid fill per level for bars and dots (semantic tokens only). */
const LEVEL_FILL: Record<RespLevel, string> = {
  excellent: 'bg-success', good: 'bg-info', fair: 'bg-warning', needs_improvement: 'bg-destructive', new: 'bg-muted-foreground/30',
};

const levelName = (l: RespLevel, ar: boolean) => (ar ? LEVEL_LABEL[l][1] : LEVEL_LABEL[l][0]);

function initials(name: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function LevelPill({ level, ar }: { level: RespLevel; ar: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium', LEVEL_TONE[level])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', LEVEL_FILL[level])} aria-hidden="true" />
      {levelName(level, ar)}
    </span>
  );
}

function StatTile({ icon, label, value, sub, tone = 'default' }: {
  icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const toneCls = {
    default: 'bg-accent/10 text-accent', success: 'bg-success/10 text-success',
    warning: 'bg-warning/15 text-warning-foreground', destructive: 'bg-destructive/10 text-destructive',
  }[tone];
  return (
    <Card className="card-interactive p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', toneCls)} aria-hidden="true">{icon}</span>
      </div>
    </Card>
  );
}

function SettingsCard({ flags, loading, updateSetting }: {
  flags: Record<string, unknown>; loading: boolean; updateSetting: (key: string, value: boolean) => unknown;
}) {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const qc = useQueryClient();
  const current = useResponsivenessSettings();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const baseline = useMemo(() => {
    const s = current.data ?? RESP_DEFAULTS;
    return Object.fromEntries(FIELDS.map(([k]) => [k, String(s[k])])) as Record<string, string>;
  }, [current.data]);
  useEffect(() => { setDraft(baseline); }, [baseline]);
  const next = Object.fromEntries(FIELDS.map(([k]) => [k, k.startsWith('default_') ? draft[k] ?? '' : Number(draft[k])])) as unknown as RespSettings;
  const problems = respSettingsProblems(next);
  const dirty = FIELDS.some(([k]) => (draft[k] ?? '') !== (baseline[k] ?? ''));
  const isPublic = flags.responsiveness_public === true;

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
    <div className="space-y-5">
      <Card className={cn('relative overflow-hidden p-5', isPublic && 'border-success/40')}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', isPublic ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')} aria-hidden="true">
              {isPublic ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <Label htmlFor="responsiveness_public" className="text-sm font-semibold">{t('admin.resp_public', 'Show responsiveness to clients (cards, rating, ranking, critical alarms)')}</Label>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('admin.resp_public_hint', 'Off by default: statistics, friendly notices and disputes still run, but nothing shows on cards, the overall rating is unchanged, ranking ignores it and nobody is left out of critical alarms.')}</p>
            </div>
          </div>
          {loading ? <Skeleton className="h-5 w-9 rounded-full" /> : (
            <Switch id="responsiveness_public" checked={isPublic} onCheckedChange={(v) => { void updateSetting('responsiveness_public', v); qc.invalidateQueries({ queryKey: ['responsiveness-public'] }); }} />
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="divide-y divide-border/60">
          {SECTIONS.map((sec) => (
            <section key={sec.id} aria-labelledby={`resp-sec-${sec.id}`} className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,15rem)_1fr] lg:gap-8">
              <div>
                <h3 id={`resp-sec-${sec.id}`} className="text-sm font-semibold text-foreground">{t(`admin.resp_sec_${sec.id}`, sec.title)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(`admin.resp_sec_${sec.id}_hint`, sec.hint)}</p>
                {sec.id === 'rating' && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('admin.resp_rank_hint', 'The ranking weight is "Responsiveness" in the match weights card under Settings (default 3).')}</p>}
              </div>
              <div className="grid items-end gap-4 sm:grid-cols-2">
                {sec.fields.map(([k, label, unit]) => {
                  const u = UNIT_LABEL[unit];
                  return (
                    <div key={k} className="space-y-1.5">
                      <Label htmlFor={`resp-${k}`} className="text-xs font-medium leading-snug text-foreground/80">{t(`admin.resp_field_${k}`, label)}</Label>
                      <div className="relative">
                        <Input id={`resp-${k}`} className={cn('h-10 tabular-nums', u && 'pe-14')} inputMode={k.startsWith('default_') ? 'text' : 'numeric'} value={draft[k] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
                        {u && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground" aria-hidden="true">{ar ? u[1] : u[0]}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-card/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="min-w-0 text-xs">
            {problems.length > 0 ? (
              <p role="alert" className="flex items-center gap-1.5 text-destructive"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('admin.resp_problems', 'Please check: {{list}}', { list: problems.join(', ') })}</p>
            ) : dirty ? (
              <p className="flex items-center gap-1.5 text-warning-foreground"><span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />{t('admin.resp_unsaved', 'You have unsaved changes')}</p>
            ) : (
              <p className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />{t('admin.resp_all_saved', 'All changes saved')}</p>
            )}
          </div>
          <div className="flex gap-2">
            {dirty && <Button variant="ghost" onClick={() => setDraft(baseline)}>{t('admin.resp_reset', 'Discard changes')}</Button>}
            <Button onClick={save} busy={saving} reason={problems.length > 0 && 'fix_errors_first'}>{saving && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" />}{t('common.save', 'Save')}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

const DISPUTE_TONE: Record<string, string> = {
  pending: 'border-warning/40 bg-warning/15 text-warning-foreground',
  upheld: 'border-success/30 bg-success/10 text-success',
  rejected: 'border-border bg-muted text-muted-foreground',
};

function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent" aria-hidden="true">{icon}</span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
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
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-32 w-full rounded-2xl" /><Skeleton className="h-32 w-full rounded-2xl" /></div>;
  if (q.isError) return <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title={t('admin.resp_unavailable', 'Not available until the responsiveness database update is applied.')} />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState icon={<Inbox className="h-6 w-6" />} title={t('admin.resp_no_disputes', 'No disputes.')} hint={t('admin.resp_no_disputes_hint', 'When a consultant disputes a no-response, it appears here for your review.')} />;
  return (
    <ul className="space-y-3">
      {rows.map((d) => (
        <li key={d.id}>
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{initials(d.name)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground"><bdi>{d.name || '—'}</bdi></p>
                  <p className="truncate text-xs text-muted-foreground"><bdi>{d.ticket_title || d.kind}</bdi></p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />{new Date(d.received_at).toLocaleString()}</span>
                    <span>{t('admin.resp_disputed', 'disputed')} {new Date(d.created_at).toLocaleString()}</span>
                  </p>
                </div>
              </div>
              <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', DISPUTE_TONE[d.status] ?? DISPUTE_TONE.rejected)}>{t(`admin.resp_status_${d.status}`, d.status)}</span>
            </div>
            <blockquote className="mt-3 whitespace-pre-wrap rounded-xl border-s-2 border-accent/60 bg-muted/40 px-3 py-2 text-sm text-foreground/90"><bdi>{d.reason}</bdi></blockquote>
            {d.status === 'pending' ? (
              <div className="mt-4 space-y-2">
                <Label htmlFor={`note-${d.id}`} className="text-xs">{t('admin.resp_note', 'Note to the consultant (optional, audited)')}</Label>
                <Textarea id={`note-${d.id}`} rows={2} maxLength={500} value={notes[d.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} />
                <AdminEmailChoice type="responsiveness" />
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" busy={busy === d.id} onClick={() => act(d.id, false)}>{t('admin.resp_reject', 'Reject dispute')}</Button>
                  <Button size="sm" busy={busy === d.id} onClick={() => act(d.id, true)}>{t('admin.resp_void', 'Void the no-response')}</Button>
                </div>
              </div>
            ) : d.admin_note ? <p className="mt-3 text-xs text-muted-foreground">{d.admin_note}</p> : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

const COLS: Array<[RespSortKey, string, boolean]> = [
  ['name', 'Consultant', false], ['public_level', 'Level', false], ['rate_90d', 'Response rate (90 d)', false], ['median_90d', 'Median reply', true],
  ['counted_90d', 'Counted (90 d)', true], ['no_response_30d', 'No responses (30 d)', true], ['warnings_sent', 'Friendly notices (90 d)', true], ['disputes_open', 'Disputes', true],
];

const tabTrigger = 'relative h-11 gap-2 rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-2 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none';

/** Admin "Consultant responsiveness": overview figures, sortable table with filters and CSV, the disputes queue and the settings. */
export default function ResponsivenessAdminPage() {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'consultants';
  const q = useAdminResponsiveness();
  const disputesQ = useAdminResponsivenessDisputes();
  const { settings: flags, loading: flagsLoading, updateSetting } = useAdminSettings();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<'all' | RespLevel>('all');
  const [onlyMissed, setOnlyMissed] = useState(false);
  const [sort, setSort] = useState<{ key: RespSortKey; asc: boolean }>({ key: 'rate_90d', asc: true });
  const [recomputing, setRecomputing] = useState(false);

  const all = useMemo(() => q.data ?? [], [q.data]);
  const summary = useMemo(() => responsivenessSummary(all), [all]);
  const pendingDisputes = (disputesQ.data ?? []).filter((d) => d.status === 'pending').length;
  const isPublic = flags.responsiveness_public === true;

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = all.filter((r) =>
      (!s || (r.name ?? '').toLowerCase().includes(s))
      && (level === 'all' || r.public_level === level)
      && (!onlyMissed || r.no_response_30d > 0));
    return sortResponsivenessRows(list, sort.key, sort.asc);
  }, [all, search, level, onlyMissed, sort]);

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

  const header = (key: RespSortKey, label: string, numeric: boolean) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowDownUp : sort.asc ? ArrowUp : ArrowDown;
    return (
      <TableHead key={key} aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'} className={cn('h-11 whitespace-nowrap bg-muted/40 text-xs font-semibold text-muted-foreground', numeric && 'text-end')}>
        <button type="button" className={cn('inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground', active && 'text-foreground')} onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
          {t(`admin.resp_col_${key}`, label)}<Icon className={cn('h-3 w-3', !active && 'opacity-50')} aria-hidden="true" />
        </button>
      </TableHead>
    );
  };

  const filtersActive = !!search.trim() || level !== 'all' || onlyMissed;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5 shadow-premium sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 end-1/3 h-56 w-56 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span className="gradient-primary grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-primary-foreground shadow-glow" aria-hidden="true">
              <Gauge className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-accent rtl:normal-case rtl:tracking-normal">{t('admin.resp_eyebrow', 'Quality & trust')}</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t('admin.resp_title', 'Consultant responsiveness')}</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{t('admin.resp_subtitle', 'See how quickly consultants answer clients, review disputed no-responses and tune the rules behind each level.')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!flagsLoading && (
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', isPublic ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground')}>
                {isPublic ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
                {isPublic ? t('admin.resp_visible', 'Visible to clients') : t('admin.resp_hidden', 'Hidden from clients')}
              </span>
            )}
            <Button variant="outline" onClick={recompute} busy={recomputing}>
              {recomputing ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="me-1.5 h-4 w-4" aria-hidden="true" />}
              {t('admin.resp_recompute', 'Recalculate now')}
            </Button>
          </div>
        </div>
      </section>

      {/* Overview figures */}
      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : !q.isError && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={<Users className="h-5 w-5" />} label={t('admin.resp_kpi_tracked', 'Consultants tracked')} value={summary.total}
              sub={t('admin.resp_kpi_rated', '{{n}} with enough data for a level', { n: summary.rated })} />
            <StatTile icon={<Gauge className="h-5 w-5" />} tone="success" label={t('admin.resp_kpi_rate', 'Overall response rate (90 d)')}
              value={summary.overallRate == null ? '–' : `${summary.overallRate}%`} sub={t('admin.resp_kpi_rate_sub', 'Across all counted requests')} />
            <StatTile icon={<MessageSquareWarning className="h-5 w-5" />} tone={summary.noResponses30d > 0 ? 'destructive' : 'default'}
              label={t('admin.resp_kpi_missed', 'No-responses (30 d)')} value={summary.noResponses30d} sub={t('admin.resp_kpi_missed_sub', 'Requests left unanswered')} />
            <StatTile icon={<Scale className="h-5 w-5" />} tone={summary.disputesOpen > 0 ? 'warning' : 'default'}
              label={t('admin.resp_kpi_disputes', 'Open disputes')} value={summary.disputesOpen} sub={t('admin.resp_kpi_disputes_sub', 'Waiting for your review')} />
          </div>

          {summary.total > 0 && (
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{t('admin.resp_distribution', 'Level distribution')}</p>
                <p className="text-xs text-muted-foreground">{t('admin.resp_distribution_hint', 'Select a level to filter the table')}</p>
              </div>
              <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={t('admin.resp_distribution', 'Level distribution')}>
                {LEVEL_ORDER.map((l) => summary.byLevel[l] > 0 && (
                  <span key={l} className={cn('h-full transition-all', LEVEL_FILL[l])} style={{ width: `${(summary.byLevel[l] / summary.total) * 100}%` }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {LEVEL_ORDER.map((l) => (
                  <button key={l} type="button" aria-pressed={level === l}
                    onClick={() => { setLevel(level === l ? 'all' : l); params.set('tab', 'consultants'); setParams(params, { replace: true }); }}
                    className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
                      level === l ? 'border-accent bg-accent/10 text-foreground' : 'border-border/60 text-muted-foreground hover:border-accent/40 hover:text-foreground')}>
                    <span className={cn('h-2 w-2 rounded-full', LEVEL_FILL[l])} aria-hidden="true" />
                    {levelName(l, ar)}
                    <span className="font-semibold tabular-nums text-foreground">{summary.byLevel[l]}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => { params.set('tab', v); setParams(params, { replace: true }); }} className="space-y-5">
        <TabsList className="h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border/60 bg-transparent p-0">
          <TabsTrigger value="consultants" className={tabTrigger}><Users className="h-4 w-4" aria-hidden="true" />{t('admin.resp_tab_consultants', 'Consultants')}</TabsTrigger>
          <TabsTrigger value="disputes" className={tabTrigger}>
            <Scale className="h-4 w-4" aria-hidden="true" />{t('admin.resp_tab_disputes', 'Disputes')}
            {pendingDisputes > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-warning-foreground">{pendingDisputes}</span>}
          </TabsTrigger>
          <TabsTrigger value="settings" className={tabTrigger}><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />{t('admin.resp_tab_settings', 'Settings')}</TabsTrigger>
          <TabsTrigger value="success" className={tabTrigger}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('admin.resp_tab_success', 'Success levels')}</TabsTrigger>
        </TabsList>

        <TabsContent value="consultants" className="mt-0">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end gap-3 border-b border-border/60 p-4">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Label htmlFor="resp-search" className="sr-only">{t('admin.resp_search', 'Search by name')}</Label>
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="resp-search" className="h-10 ps-9" placeholder={t('admin.resp_search', 'Search by name')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div>
                <Label className="sr-only" id="resp-level-label">{t('admin.resp_level', 'Level')}</Label>
                <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
                  <SelectTrigger className="h-10 w-48" aria-labelledby="resp-level-label"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('admin.resp_all_levels', 'All levels')}</SelectItem>
                    {(Object.keys(LEVEL_LABEL) as RespLevel[]).map((l) => <SelectItem key={l} value={l}>{levelName(l, ar)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex h-10 items-center gap-2 rounded-xl border border-border/60 px-3 text-xs text-foreground/80">
                <Switch checked={onlyMissed} onCheckedChange={setOnlyMissed} />{t('admin.resp_only_missed', 'Only with no-responses (30 d)')}
              </label>
              <div className="ms-auto flex items-center gap-3">
                {!q.isLoading && !q.isError && (
                  <span className="text-xs text-muted-foreground tabular-nums">{t('admin.resp_showing', '{{n}} of {{total}}', { n: rows.length, total: all.length })}</span>
                )}
                <Button variant="outline" onClick={exportCsv} reason={!rows.length && 'nothing_to_export'}><Download className="me-1.5 h-4 w-4" aria-hidden="true" />CSV</Button>
              </div>
            </div>
            {q.isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
            ) : q.isError ? (
              <div className="p-4"><EmptyState icon={<AlertTriangle className="h-6 w-6" />} title={t('admin.resp_unavailable', 'Not available until the responsiveness database update is applied.')} /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow className="hover:bg-transparent">{COLS.map(([k, l, n]) => header(k, l, n))}</TableRow></TableHeader>
                  <TableBody>
                    {rows.map((r: AdminResponsivenessRow) => (
                      <TableRow key={r.consultant_id} className="transition-colors hover:bg-accent/5">
                        <TableCell className="min-w-[220px] py-3">
                          <div className="flex items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">{initials(r.name)}</span>
                            <span className="font-medium leading-snug text-foreground"><bdi>{r.name || '—'}</bdi></span>
                          </div>
                        </TableCell>
                        <TableCell><LevelPill level={r.public_level} ar={ar} /></TableCell>
                        <TableCell className="min-w-[150px]">
                          {r.rate_90d == null ? <span className="text-muted-foreground">–</span> : (
                            <div className="flex items-center gap-2.5">
                              <span className="w-10 text-sm font-medium tabular-nums text-foreground">{r.rate_90d}%</span>
                              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                                <span className={cn('block h-full rounded-full', LEVEL_FILL[r.public_level === 'new' ? 'good' : r.public_level])} style={{ width: `${Math.max(0, Math.min(100, r.rate_90d))}%` }} />
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-end tabular-nums">{r.median_90d == null ? <span className="text-muted-foreground">–</span> : formatMinutes(r.median_90d, ar)}</TableCell>
                        <TableCell className={cn('text-end tabular-nums', r.counted_90d === 0 && 'text-muted-foreground')}>{r.counted_90d}</TableCell>
                        <TableCell className={cn('text-end tabular-nums', r.no_response_30d > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{r.no_response_30d}</TableCell>
                        <TableCell className={cn('text-end tabular-nums', r.warnings_sent === 0 && 'text-muted-foreground')}>{r.warnings_sent}</TableCell>
                        <TableCell className="text-end tabular-nums">
                          {r.disputes_open > 0
                            ? <span className="inline-flex rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">{r.disputes_open} / {r.disputes_total}</span>
                            : <span className={cn(r.disputes_total === 0 && 'text-muted-foreground')}>{r.disputes_total}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={COLS.length} className="py-10">
                          <EmptyState icon={<Search className="h-6 w-6" />} title={t('admin.resp_empty', 'No consultants match.')}
                            hint={filtersActive ? t('admin.resp_empty_hint', 'Try clearing the search or level filter.') : undefined} />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="disputes" className="mt-0"><DisputesTab /></TabsContent>
        <TabsContent value="settings" className="mt-0"><SettingsCard flags={flags as Record<string, unknown>} loading={flagsLoading} updateSetting={updateSetting} /></TabsContent>
        <TabsContent value="success" className="mt-0"><SuccessAdminTab /></TabsContent>
      </Tabs>
    </div>
  );
}
