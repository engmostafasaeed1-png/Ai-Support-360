// AI Interviewer Training › Learning: the voice learning loop at a glance and under control. Suggestions from
// consultants' corrections (review queue: approve / edit / reject), automatically promoted and rejected terms, the
// versioned vocabulary with test results and one-click rollback, word error rate trend per model, the routing table,
// consented recordings, the frozen benchmark set, kill switches and the change log. Reads and writes only through the
// administrators-only database functions in docs/sql/interview-voice-learning.sql; shows a notice until it is applied.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, GraduationCap, Pencil, RotateCcw, Upload, X } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { benchmarkItemsFromCsv } from '@/lib/voice/benchmarkImport';
import { LEARNING_LIMITS, type LearningSettings } from '../../../../supabase/functions/_shared/voiceLearning';
import { VOICE_MODELS } from '../../../../supabase/functions/_shared/voiceProviders';
import QuestionQualityPanel from './QuestionQualityPanel';

interface VersionRow { version: number; status: string; kind: string; terms: number; reason: string | null; created_at: string; activated_at: string | null;
  eval: { items?: number; wer_before?: number | null; wer_after?: number | null; passed?: boolean | null; reason?: string } | null }
interface TrendRow { week: string; model: string; vocab_version: number; answers: number; words: number; errors: number }
interface RoutingRow { language: string; device: string; accent: string; current_model: string; recommended_model: string; reason: string;
  stats: Array<{ model: string; answers: number; words: number; errors: number; consultants: number }> }
interface RouteRow { language: string; device: string; accent: string; model: string; previous_model: string | null; status: string; eval: { passed?: boolean | null; reason?: string } | null }
interface Overview {
  settings: LearningSettings; default_model: string;
  week: { new_suggestions: number; auto_promoted: number; pairs: number }; queue: number; rejected: number;
  versions: VersionRow[]; active_terms: Array<{ heard: string; term: string; module?: string | null; source?: string }>;
  trend: TrendRow[]; routing: RoutingRow[]; routes: RouteRow[];
  audio: { recordings: number; bytes: number; consents: number; pending_delete: number };
  benchmark_items: number; live_items: number;
  last_run: { started_at: string; finished_at: string | null; result: Record<string, unknown> | null } | null;
  events: Array<{ at: string; action: string; target: string | null; reason: string | null; actor: string | null }>;
}
interface SuggestionRow { id: string; heard_key: string; final_term: string; module: string | null; total_count: number; consultants: number; sap_ok: boolean;
  status: string; last_seen: string | null; version_added: number | null; decision_reason: string | null }

const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)} %`);
const modelLabel = (m: string) => VOICE_MODELS[m]?.label ?? m;
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString() : '—');
const REASONS: Record<string, string> = {
  not_enough_data: 'Not enough data yet', current_not_measured: 'Current model not measured yet', keep_current: 'Current model stays (difference below the safety margin)', better: 'Better model found',
};

/** Weekly word error rate per model for the chart (exported for tests). */
export function trendSeries(rows: TrendRow[]) {
  const weeks = new Map<string, Record<string, number | string>>();
  const totals = new Map<string, { w: number; e: number }>();
  for (const r of rows) {
    const k = `${r.week}|${r.model}`;
    const t = totals.get(k) ?? { w: 0, e: 0 };
    t.w += r.words; t.e += r.errors;
    totals.set(k, t);
  }
  for (const [k, t] of totals) {
    const [week, model] = k.split('|');
    const row = weeks.get(week) ?? { week };
    row[model] = t.w ? Math.round((t.e / t.w) * 1000) / 10 : 0;
    weeks.set(week, row);
  }
  return [...weeks.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)));
}

export default function VoiceLearningPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'pending' | 'auto_promoted' | 'approved' | 'rejected'>('pending');
  const [editing, setEditing] = useState<{ id: string; term: string; module: string } | null>(null);

  const overview = useQuery({
    queryKey: ['voice-learning', 'overview'],
    queryFn: async () => {
      const { data, error } = await safeRpc<Overview>('admin_voice_learning_overview');
      if (error) return { ready: !isMissingRpc(error), data: null as Overview | null, error: isMissingRpc(error) ? null : error.message };
      return { ready: true, data, error: null };
    },
  });
  const ready = overview.data?.ready ?? false;
  const o = overview.data?.data ?? null;
  const suggestions = useQuery({
    queryKey: ['voice-learning', 'suggestions', status],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await safeRpc<SuggestionRow[]>('admin_voice_learning_suggestions', { _status: status, _limit: 200 });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const series = useMemo(() => trendSeries(o?.trend ?? []), [o?.trend]);
  const models = useMemo(() => [...new Set((o?.trend ?? []).map((r) => r.model))], [o?.trend]);

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    if (reason.trim().length < 3) { toast.error(t('voice.learnadmin.reason_needed', 'Please write a short reason first (saved with the change).')); return false; }
    setBusy(true);
    const { error } = await safeRpc(fn, { ...args, _reason: reason.trim() });
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(done);
    void qc.invalidateQueries({ queryKey: ['voice-learning'] });
    return true;
  };
  const setSetting = (patch: Partial<LearningSettings>) => run('admin_voice_learning_set_settings', { _patch: patch }, t('voice.learnadmin.saved', 'Saved'));

  const importBenchmark = async (file: File) => {
    const items = benchmarkItemsFromCsv(await file.text(), Object.keys(VOICE_MODELS));
    if (!items.length) { toast.error(t('voice.learnadmin.bench_empty', 'No usable sentences found. Use results.csv from the benchmark script.')); return; }
    await run('admin_voice_benchmark_import', { _items: items }, t('voice.learnadmin.bench_done', '{{n}} test sentences saved as the frozen set', { n: items.length }));
  };

  if (overview.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!ready || !o) {
    return (
      <Card className="rounded-2xl border-warning/40 bg-warning/5">
        <CardContent className="p-4 text-sm text-foreground">
          {overview.data?.error ?? t('voice.learnadmin.not_ready', 'The voice learning loop is prepared but not switched on yet: the database updates docs/sql/interview-voice.sql and then docs/sql/interview-voice-learning.sql have not been applied.')}
        </CardContent>
      </Card>
    );
  }
  const s = o.settings;
  const active = o.versions.find((v) => v.status === 'active');
  const candidate = o.versions.find((v) => v.status === 'candidate');

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" />{t('voice.learnadmin.title', 'Learning')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('voice.learnadmin.intro', 'The speech model itself cannot be retrained. The app learns around it: words consultants correct become suggestions, safe ones join the vocabulary after a test, and the best model can be chosen per language and device. Every change is versioned and can be undone.')}
          </p>
          <div>
            <Label htmlFor="learn-reason" className="text-xs">{t('voice.learnadmin.reason', 'Reason for your changes (required, saved in the change log)')}</Label>
            <Input id="learn-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1" placeholder={t('voice.learnadmin.reason_ph', 'e.g. owner approved on 24 Oct')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['learning', t('voice.learnadmin.sw_learning', 'Learning from corrections'), t('voice.learnadmin.sw_learning_hint', 'Off: no correction pairs are stored and nothing new is learned.')],
              ['auto_promote', t('voice.learnadmin.sw_promote', 'Automatic promotion'), t('voice.learnadmin.sw_promote_hint', 'Only words corrected by enough different consultants that look like SAP terms; still tested before use.')],
              ['auto_routing', t('voice.learnadmin.sw_routing', 'Automatic model choice'), t('voice.learnadmin.sw_routing_hint', 'Off until you enable it. A switch also needs the frozen benchmark to confirm it.')],
              ['training_audio', t('voice.learnadmin.sw_audio', 'Offer "keep my recording for 90 days"'), t('voice.learnadmin.sw_audio_hint', 'Super administrators only. Needs the private voice-training storage and an updated privacy notice. Turning it off deletes all kept recordings.')],
            ] as Array<[keyof LearningSettings, string, string]>).map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3 rounded-xl border border-border/60 p-3">
                <Switch checked={!!s[key]} disabled={busy} onCheckedChange={(v) => void setSetting({ [key]: v } as Partial<LearningSettings>)} className="mt-0.5" />
                <span><span className="block text-sm font-medium text-foreground">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="learn-n" className="text-xs">{t('voice.learnadmin.n', 'Different consultants needed for automatic promotion')}</Label>
              <Input id="learn-n" type="number" className="mt-1 w-28" min={LEARNING_LIMITS.promote_min_consultants[0]} max={LEARNING_LIMITS.promote_min_consultants[1]}
                defaultValue={s.promote_min_consultants} onBlur={(e) => { const n = Number(e.target.value); if (n !== s.promote_min_consultants) void setSetting({ promote_min_consultants: n }); }} />
            </div>
            <div>
              <Label htmlFor="learn-pin" className="text-xs">{t('voice.learnadmin.pin', 'Pin one model (super administrators)')}</Label>
              <select id="learn-pin" value={s.pinned_model ?? ''} disabled={busy} onChange={(e) => void setSetting({ pinned_model: e.target.value || null })}
                className="mt-1 block rounded-lg border border-border bg-background px-2 py-2 text-sm">
                <option value="">{t('voice.learnadmin.pin_none', 'Not pinned')}</option>
                {Object.values(VOICE_MODELS).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('voice.learnadmin.last_run', 'Last nightly run: {{at}}', { at: o.last_run?.finished_at ? new Date(o.last_run.finished_at).toLocaleString() : '—' })}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        {[
          [t('voice.learnadmin.k_new', 'New suggestions this week'), o.week.new_suggestions],
          [t('voice.learnadmin.k_auto', 'Auto-promoted this week'), o.week.auto_promoted],
          [t('voice.learnadmin.k_queue', 'Waiting for review'), o.queue],
          [t('voice.learnadmin.k_rejected', 'Rejected (never again)'), o.rejected],
          [t('voice.learnadmin.k_audio', 'Kept recordings (consented)'), `${o.audio.recordings} · ${(o.audio.bytes / 1_048_576).toFixed(1)} MB`],
          [t('voice.learnadmin.k_items', 'Test set: benchmark / answers'), `${o.benchmark_items} / ${o.live_items}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border/60 p-3 bg-card">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('voice.learnadmin.suggestions', 'Vocabulary suggestions')}</CardTitle>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label={t('voice.learnadmin.filter', 'Show')}>
            <option value="pending">{t('voice.learnadmin.f_pending', 'Waiting for review')}</option>
            <option value="auto_promoted">{t('voice.learnadmin.f_auto', 'Auto-promoted')}</option>
            <option value="approved">{t('voice.learnadmin.f_approved', 'Approved')}</option>
            <option value="rejected">{t('voice.learnadmin.f_rejected', 'Rejected')}</option>
          </select>
        </CardHeader>
        <CardContent>
          {suggestions.isLoading ? <Skeleton className="h-24 w-full" /> : !(suggestions.data ?? []).length ? (
            <p className="text-sm text-muted-foreground">{t('voice.learnadmin.none', 'Nothing here.')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pe-3">{t('voice.learnadmin.c_heard', 'Heard')}</th><th className="py-2 pe-3">{t('voice.learnadmin.c_final', 'Corrected to')}</th>
                  <th className="py-2 pe-3">{t('voice.learnadmin.c_people', 'Consultants')}</th><th className="py-2 pe-3">{t('voice.learnadmin.c_count', 'Corrections')}</th>
                  <th className="py-2 pe-3">{t('voice.learnadmin.c_sap', 'SAP check')}</th><th className="py-2" />
                </tr></thead>
                <tbody>
                  {(suggestions.data ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-border/50 align-top">
                      <td className="py-2 pe-3 text-muted-foreground" dir="auto">{r.heard_key}</td>
                      <td className="py-2 pe-3 font-medium text-foreground" dir="auto">
                        {editing?.id === r.id ? (
                          <div className="flex flex-col gap-1">
                            <Input value={editing.term} onChange={(e) => setEditing({ ...editing, term: e.target.value })} maxLength={40} aria-label={t('voice.learnadmin.c_final', 'Corrected to')} />
                            <Input value={editing.module} onChange={(e) => setEditing({ ...editing, module: e.target.value })} maxLength={40} placeholder={t('voice.learnadmin.module', 'Module (optional), e.g. MM')} />
                          </div>
                        ) : r.final_term}
                        {r.decision_reason && <div className="text-[11px] text-muted-foreground">{r.decision_reason}</div>}
                      </td>
                      <td className="py-2 pe-3">{r.consultants}</td>
                      <td className="py-2 pe-3">{r.total_count}</td>
                      <td className="py-2 pe-3">{r.sap_ok ? <Badge variant="secondary">{t('voice.learnadmin.sap_yes', 'Known')}</Badge> : <Badge variant="outline">{t('voice.learnadmin.sap_no', 'Unknown')}</Badge>}</td>
                      <td className="py-2 whitespace-nowrap text-end">
                        {r.status === 'pending' && (editing?.id === r.id ? (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => void run('admin_voice_learning_decide', { _id: r.id, _action: 'edit', _term: editing.term, _module: editing.module }, t('voice.learnadmin.approved', 'Approved: it will be tested before use')).then((ok) => ok && setEditing(null))}><Check className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label={t('common.cancel', 'Cancel')}><X className="h-4 w-4" /></Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run('admin_voice_learning_decide', { _id: r.id, _action: 'approve', _term: null, _module: null }, t('voice.learnadmin.approved', 'Approved: it will be tested before use'))}>{t('voice.learnadmin.approve', 'Approve')}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing({ id: r.id, term: r.final_term, module: r.module ?? '' })} aria-label={t('voice.learnadmin.edit', 'Edit')}><Pencil className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run('admin_voice_learning_decide', { _id: r.id, _action: 'reject', _term: null, _module: null }, t('voice.learnadmin.rejected', 'Rejected: it will never be suggested again'))}>{t('voice.learnadmin.reject', 'Reject')}</Button>
                          </>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base">{t('voice.learnadmin.versions', 'Vocabulary versions')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {candidate && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              {candidate.eval?.reason === 'not_enough_items'
                ? t('voice.learnadmin.cand_wait', 'Version {{v}} is waiting: not enough test sentences yet to prove it is not worse ({{n}} of {{min}}).', { v: candidate.version, n: candidate.eval?.items ?? 0, min: s.min_eval_items })
                : t('voice.learnadmin.cand_test', 'Version {{v}} is being tested.', { v: candidate.version })}
              {candidate.eval?.passed !== false && (
                <Button size="sm" variant="outline" className="ms-2" disabled={busy} onClick={() => void run('admin_voice_vocab_activate', { _version: candidate.version }, t('voice.learnadmin.activated', 'Activated'))}>
                  {t('voice.learnadmin.activate', 'Activate anyway')}
                </Button>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pe-3">{t('voice.learnadmin.v_version', 'Version')}</th><th className="py-2 pe-3">{t('voice.learnadmin.v_status', 'Status')}</th>
                <th className="py-2 pe-3">{t('voice.learnadmin.v_terms', 'Terms')}</th><th className="py-2 pe-3">{t('voice.learnadmin.v_test', 'Test (word error rate before → after)')}</th>
                <th className="py-2 pe-3">{t('voice.learnadmin.v_why', 'Why')}</th><th className="py-2" />
              </tr></thead>
              <tbody>
                {o.versions.map((v) => (
                  <tr key={v.version} className="border-t border-border/50">
                    <td className="py-2 pe-3">v{v.version}<div className="text-[11px] text-muted-foreground">{fmtDate(v.activated_at ?? v.created_at)}</div></td>
                    <td className="py-2 pe-3"><Badge variant={v.status === 'active' ? 'default' : v.status === 'blocked' ? 'destructive' : 'outline'}>{t(`voice.learnadmin.st_${v.status}`, v.status)}</Badge></td>
                    <td className="py-2 pe-3">{v.terms}</td>
                    <td className="py-2 pe-3">{v.eval?.items ? `${pct(v.eval.wer_before)} → ${pct(v.eval.wer_after)} · ${v.eval.items}` : '—'}</td>
                    <td className="py-2 pe-3 text-xs text-muted-foreground max-w-xs">{v.reason}</td>
                    <td className="py-2 text-end">
                      {v.status !== 'active' && v.activated_at && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run('admin_voice_vocab_rollback', { _version: v.version }, t('voice.learnadmin.rolled_back', 'Restored version {{v}}', { v: v.version }))}>
                          <RotateCcw className="h-4 w-4 me-1" />{t('voice.learnadmin.rollback', 'Restore')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!o.active_terms.length && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">{t('voice.learnadmin.active_terms', 'Active learned terms (v{{v}})', { v: active?.version ?? '—' })}</div>
              <div className="flex flex-wrap gap-2">
                {o.active_terms.map((term) => (
                  <span key={term.heard} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-xs">
                    <span className="text-muted-foreground" dir="auto">{term.heard}</span>→<span className="font-medium" dir="auto">{term.term}</span>
                    <button type="button" className="ms-1 text-muted-foreground hover:text-destructive" disabled={busy}
                      onClick={() => void run('admin_voice_vocab_remove_term', { _heard: term.heard }, t('voice.learnadmin.removed', 'Removed and blocked'))}
                      aria-label={t('voice.learnadmin.remove', 'Remove {{term}}', { term: term.term })}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base">{t('voice.learnadmin.trend', 'Word error rate per week (lower is better)')}</CardTitle></CardHeader>
        <CardContent>
          {!series.length ? <p className="text-sm text-muted-foreground">{t('voice.learnadmin.trend_empty', 'No measured answers yet.')}</p> : (
            <div className="h-64" role="img" aria-label={t('voice.learnadmin.trend', 'Word error rate per week (lower is better)')}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis unit="%" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {models.map((m, i) => <Line key={m} type="monotone" dataKey={m} name={modelLabel(m)} stroke={i ? 'hsl(var(--accent))' : 'hsl(var(--primary))'} strokeWidth={2} dot />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {t('voice.learnadmin.trend_hint', 'Measured as the difference between what each model heard and what the consultant finally sent. Vocabulary versions are listed above with their dates.')}
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base">{t('voice.learnadmin.routing', 'Model choice per language, device and accent group')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {s.pinned_model
              ? t('voice.learnadmin.routing_pinned', 'Pinned: every answer uses {{m}}.', { m: modelLabel(s.pinned_model) })
              : s.auto_routing
                ? t('voice.learnadmin.routing_on', 'Automatic: a better model is used only after it beats the current one by {{margin}} points with at least {{n}} answers, and the benchmark confirms it.', { margin: (s.routing_margin * 100).toFixed(1), n: s.routing_min_answers })
                : t('voice.learnadmin.routing_off', 'Automatic model choice is off: every answer uses {{m}}. The table shows what it would recommend.', { m: modelLabel(o.default_model) })}
          </p>
          {!o.routing.length ? <p className="text-sm text-muted-foreground">{t('voice.learnadmin.routing_empty', 'No measured answers yet.')}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pe-3">{t('voice.learnadmin.r_ctx', 'Language / device / accent')}</th><th className="py-2 pe-3">{t('voice.learnadmin.r_now', 'Now')}</th>
                  <th className="py-2 pe-3">{t('voice.learnadmin.r_rec', 'Recommended')}</th><th className="py-2 pe-3">{t('voice.learnadmin.r_stats', 'Measured')}</th><th className="py-2" />
                </tr></thead>
                <tbody>
                  {o.routing.map((r) => {
                    const live = o.routes.find((x) => x.status === 'active' && x.language === r.language && x.device === r.device && x.accent === r.accent);
                    return (
                      <tr key={`${r.language}-${r.device}-${r.accent}`} className="border-t border-border/50 align-top">
                        <td className="py-2 pe-3">{[r.language, r.device, r.accent].map((x) => (x === '*' ? t('voice.learnadmin.any', 'any') : x)).join(' / ')}</td>
                        <td className="py-2 pe-3">{modelLabel(r.current_model)}</td>
                        <td className="py-2 pe-3">{modelLabel(r.recommended_model)}<div className="text-[11px] text-muted-foreground">{t(`voice.learnadmin.why_${r.reason}`, REASONS[r.reason] ?? r.reason)}</div></td>
                        <td className="py-2 pe-3 text-xs">{r.stats.map((x) => <div key={x.model}>{modelLabel(x.model)}: {pct(x.words ? x.errors / x.words : null)} · {x.answers} · {x.consultants}</div>)}</td>
                        <td className="py-2 text-end">{live && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run('admin_voice_route_retire', { _language: r.language, _device: r.device, _accent: r.accent }, t('voice.learnadmin.route_back', 'Route undone'))}>
                            <RotateCcw className="h-4 w-4 me-1" />{t('voice.learnadmin.rollback', 'Restore')}
                          </Button>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t('voice.learnadmin.r_legend', 'Measured: word error rate · answers · different consultants (each consultant counts at most {{cap}} answers).', { cap: s.routing_user_cap })}</p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base">{t('voice.learnadmin.bench', 'Frozen benchmark (regression protection)')}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {t('voice.learnadmin.bench_hint', 'Upload results.csv from the benchmark script (the owner\'s 40 recorded sentences). Only the texts are saved. A new vocabulary or model must not be worse on this set; model changes are blocked while it is empty.')}
          </p>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBenchmark(f); }} />
            <span className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"><Upload className="h-4 w-4" />{t('voice.learnadmin.bench_upload', 'Upload results.csv')}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t('voice.learnadmin.bench_count', '{{n}} sentences in the frozen set.', { n: o.benchmark_items })}</p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader><CardTitle className="text-base">{t('voice.learnadmin.log', 'Change log')}</CardTitle></CardHeader>
        <CardContent>
          {!o.events.length ? <p className="text-sm text-muted-foreground">{t('voice.learnadmin.none', 'Nothing here.')}</p> : (
            <ul className="space-y-1 text-xs">
              {o.events.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-2"><span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span><span className="font-medium">{e.action}</span>
                  {e.target && <span dir="auto">{e.target}</span>}<span className="text-muted-foreground">{e.actor ?? t('voice.learnadmin.system', 'automatic')}</span>{e.reason && <span>· {e.reason}</span>}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <QuestionQualityPanel reason={reason} />
    </div>
  );
}
