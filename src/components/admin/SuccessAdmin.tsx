import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import { useSuccessConfig } from '@/hooks/useSuccessStats';
import {
  OUTCOME_LABEL, REASON_LABEL, recomputeSuccess, reviewSuccessDispute, setSuccessOverride, useAdminSuccessBreakdown, useAdminSuccessDisputes,
  type SuccessEngagement,
} from '@/hooks/useSuccessAdmin';
import { LevelStars } from '@/components/consultant/SuccessStars';
import { successLabel, successLevelOf, successPct, successSettingsProblems, SUCCESS_DEFAULTS, type SuccessSettings } from '@/lib/successLevel';
import { cn } from '@/lib/utils';

const useAr = () => {
  const { i18n } = useTranslation();
  return !!i18n?.language?.startsWith('ar');
};

/** Admin consultant view: full breakdown incl. excluded counts, every engagement, void/restore with a reason (audited). */
export function SuccessBreakdown({ consultantId }: { consultantId: string }) {
  const ar = useAr();
  const qc = useQueryClient();
  const q = useAdminSuccessBreakdown(consultantId);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError || !q.data) {
    return <p className="text-sm text-muted-foreground">{ar ? 'تظهر إحصاءات النجاح بعد تطبيق تحديث قاعدة البيانات الخاص بها.' : 'Success statistics appear once their database update is applied.'}</p>;
  }
  const { stats, engagements, settings } = q.data;
  const total = stats?.requests_total ?? 0, solved = stats?.solved ?? 0;
  const lv = successLevelOf(total, solved, settings);
  const ex = stats?.excluded ?? {};
  const act = async (e: SuccessEngagement, action: 'void' | 'clear') => {
    const why = (reason[e.ticket_id] ?? '').trim();
    if (why.length < 3) { toast.error(ar ? 'يرجى كتابة سبب (3 أحرف على الأقل).' : 'Please give a reason (at least 3 characters).'); return; }
    setBusy(e.ticket_id);
    try {
      await setSuccessOverride(consultantId, e.ticket_id, action, why);
      toast.success(action === 'void' ? (ar ? 'تم استبعاد الطلب من الإحصاءات (مسجل في السجل).' : 'Removed from the statistics (audited).') : (ar ? 'تمت إعادة الطلب إلى الإحصاءات (مسجل).' : 'Back in the statistics (audited).'));
      qc.invalidateQueries({ queryKey: ['admin-success', consultantId] });
      qc.invalidateQueries({ queryKey: ['success-stat', consultantId] });
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(null); }
  };
  const cells: Array<[string, ReactNode]> = [
    [ar ? 'الطلبات' : 'Requests', total], [ar ? 'المحلولة' : 'Solved', solved], [ar ? 'غير المحلولة' : 'Not solved', stats?.not_solved ?? 0],
    [ar ? 'نسبة النجاح' : 'Success rate', total ? `${successPct(total, solved)} %` : '–'],
    [ar ? 'المستوى' : 'Level', (
      <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="admin-success-level">
        <LevelStars level={lv === 'new' || lv === 'none' ? null : lv} size={13} />
        {lv === 'new' ? (ar ? 'جديد' : 'New') : lv === 'none' ? (ar ? 'بدون مستوى' : 'No level') : successLabel(lv, ar ? 'ar' : 'en')}
      </span>
    )],
    [ar ? 'آخر 12 شهرًا' : 'Last 12 months', `${stats?.solved_12m ?? 0} / ${stats?.requests_12m ?? 0}`],
    [ar ? 'قيد التنفيذ' : 'In progress', stats?.open_count ?? 0], [ar ? 'بانتظار التأكيد' : 'Awaiting confirmation', stats?.awaiting_confirmation ?? 0],
    [ar ? 'لم يبدأ' : 'Never started', ex.never_started ?? 0], [ar ? 'ملغاة' : 'Voided', ex.voided ?? 0],
    [ar ? 'مكررة' : 'Merged', ex.merged ?? 0], [ar ? 'تجريبية' : 'Test data', ex.test ?? 0],
  ];
  return (
    <section className="space-y-3" data-testid="admin-success-breakdown">
      <h3 className="flex items-center gap-2 font-semibold"><Trophy className="h-4 w-4" aria-hidden="true" />{ar ? 'الطلبات والنجاح (كامل)' : 'Requests and success (full breakdown)'}</h3>
      {!q.data.public && <p className="text-xs text-muted-foreground">{ar ? 'العرض العام متوقف حاليًا.' : 'The public display is switched off.'}</p>}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map(([l, v]) => <div key={l}><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-sm font-semibold">{v}</dd></div>)}
      </dl>
      <ul className="space-y-2">
        {engagements.map((e) => (
          <li key={e.ticket_id} className="rounded-xl border border-border/60 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-medium"><bdi>{e.title || e.ticket_id}</bdi></p>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', e.outcome === 'solved' ? 'bg-success/10 text-success' : e.outcome === 'not_solved' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
                {OUTCOME_LABEL[e.outcome][ar ? 1 : 0]}
              </span>
            </div>
            {(e.reason || e.override) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {e.reason && REASON_LABEL[e.reason] ? REASON_LABEL[e.reason][ar ? 1 : 0] : null}
                {e.override ? ` · ${e.override.reason}` : null}
              </p>
            )}
            {!['excluded_merged', 'excluded_test', 'excluded_never_started'].includes(e.outcome) && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Input className="h-8 max-w-xs text-xs" aria-label={ar ? 'السبب' : 'Reason'} placeholder={ar ? 'السبب (إلزامي، مسجل)' : 'Reason (required, audited)'} maxLength={500}
                  value={reason[e.ticket_id] ?? ''} onChange={(ev) => setReason((r) => ({ ...r, [e.ticket_id]: ev.target.value }))} />
                {e.outcome === 'excluded_voided'
                  ? <Button size="sm" variant="outline" disabled={busy === e.ticket_id} onClick={() => act(e, 'clear')}>{ar ? 'إعادة إلى الإحصاءات' : 'Restore'}</Button>
                  : <Button size="sm" variant="outline" disabled={busy === e.ticket_id} onClick={() => act(e, 'void')}>{ar ? 'استبعاد من الإحصاءات' : 'Void from statistics'}</Button>}
              </div>
            )}
          </li>
        ))}
        {!engagements.length && <li className="text-sm text-muted-foreground">{ar ? 'لا توجد طلبات بعد.' : 'No engagements yet.'}</li>}
      </ul>
    </section>
  );
}

const FIELDS: Array<[keyof SuccessSettings, string, string]> = [
  ['bronze', 'Success: Bronze from (%)', 'النجاح: برونزي من (٪)'],
  ['silver', 'Success: Silver from (%)', 'النجاح: فضي من (٪)'],
  ['gold', 'Success: Gold from (%)', 'النجاح: ذهبي من (٪)'],
  ['platinum', 'Success: Platinum at (%)', 'النجاح: بلاتيني عند (٪)'],
  ['min_requests', 'Finished requests before a level shows', 'عدد الطلبات المنتهية قبل ظهور المستوى'],
];

/** Admin "Success" tab: public switch, thresholds, recalculation and the review queue. */
export function SuccessAdminTab() {
  const ar = useAr();
  const qc = useQueryClient();
  const cfg = useSuccessConfig();
  const { settings: flags, loading, updateSetting } = useAdminSettings();
  const disputes = useAdminSuccessDisputes();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, String(cfg.settings[k])]))); }, [cfg.settings]);
  const next = Object.fromEntries(FIELDS.map(([k]) => [k, Number(draft[k])])) as unknown as SuccessSettings;
  const problems = successSettingsProblems(next);
  const refresh = () => {
    ['success-public-config', 'success-stat', 'success-stats-map', 'admin-success', 'admin-success-disputes'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const save = async () => {
    if (problems.length) return;
    setSaving(true);
    const { error } = await supabase.from('platform_settings').upsert([
      { key: 'success_levels', value: next as never }, { key: 'success_min_requests', value: next.min_requests as never },
    ], { onConflict: 'key' });
    setSaving(false);
    if (error) { toast.error(ar ? 'تعذر حفظ الإعدادات.' : 'The settings could not be saved.'); return; }
    toast.success(ar ? 'تم الحفظ. تنطبق المستويات فورًا.' : 'Saved. Levels follow the new thresholds right away.');
    refresh();
  };
  const recompute = async () => {
    setRecomputing(true);
    try { const n = await recomputeSuccess(); toast.success(ar ? `أُعيد حساب ${n} مستشار.` : `Recalculated ${n} consultants.`); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setRecomputing(false); }
  };
  const decide = async (id: string, decision: 'void' | 'solved' | 'reject') => {
    setBusy(id);
    try { await reviewSuccessDispute(id, decision, notes[id] ?? ''); toast.success(ar ? 'تم القرار (مسجل في السجل).' : 'Decided (audited).'); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  if (!cfg.available) {
    return <p className="text-sm text-muted-foreground">{ar ? 'غير متاح حتى يتم تطبيق تحديث قاعدة البيانات الخاص بإحصاءات النجاح.' : 'Not available until the success statistics database update is applied.'}</p>;
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-base">{ar ? 'مستويات النجاح' : 'Success levels'}</CardTitle>
          <Button variant="outline" size="sm" onClick={recompute} disabled={recomputing}>
            {recomputing ? <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="me-1 h-4 w-4" aria-hidden="true" />}
            {ar ? 'أعد الحساب الآن' : 'Recalculate now'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 p-3">
            <div className="min-w-0">
              <Label htmlFor="success_public">{ar ? 'عرض الطلبات والنجاح للجميع' : 'Show requests and success to everyone'}</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{ar ? 'مفعّل افتراضيًا. عند الإيقاف لا يظهر شيء على الحلقات والبطاقات والخريطة؛ تبقى الإحصاءات تُحسب.' : 'On by default. When off, nothing shows on rings, cards or the map; the statistics keep being calculated.'}</p>
            </div>
            {loading ? <Skeleton className="h-5 w-9 rounded-full" /> : (
              <Switch id="success_public" checked={flags.success_public !== false} onCheckedChange={(v) => { void Promise.resolve(updateSetting('success_public', v)).then(refresh); }} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, en, arl]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`success-${k}`} className="text-xs">{ar ? arl : en}</Label>
                <Input id={`success-${k}`} className="h-9" inputMode="numeric" value={draft[k] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{ar ? `الافتراضي: ${SUCCESS_DEFAULTS.bronze} / ${SUCCESS_DEFAULTS.silver} / ${SUCCESS_DEFAULTS.gold} / ${SUCCESS_DEFAULTS.platinum} ٪، والحد الأدنى ${SUCCESS_DEFAULTS.min_requests} طلبات. يجب أن تتزايد القيم.` : `Defaults: ${SUCCESS_DEFAULTS.bronze} / ${SUCCESS_DEFAULTS.silver} / ${SUCCESS_DEFAULTS.gold} / ${SUCCESS_DEFAULTS.platinum} %, minimum ${SUCCESS_DEFAULTS.min_requests} requests. Each level must be higher than the one before.`}</p>
          {problems.length > 0 && <p role="alert" className="text-xs text-destructive">{ar ? 'يرجى مراجعة القيم.' : 'Please check the values.'}</p>}
          <Button onClick={save} disabled={saving || problems.length > 0}>{saving && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden="true" />}{ar ? 'حفظ' : 'Save'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{ar ? 'طلبات المراجعة' : 'Review requests'}</CardTitle></CardHeader>
        <CardContent>
          {disputes.isLoading ? <Skeleton className="h-24 w-full" /> : !(disputes.data ?? []).length ? (
            <p className="text-sm text-muted-foreground">{ar ? 'لا توجد طلبات مراجعة.' : 'No review requests.'}</p>
          ) : (
            <ul className="space-y-3">
              {(disputes.data ?? []).map((d) => (
                <li key={d.id} className="rounded-xl border border-border/60 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 font-medium"><bdi>{d.name || '—'}</bdi> · <bdi>{d.ticket_title || d.ticket_id}</bdi></p>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs', d.status === 'pending' ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground')}>{d.status}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-xs"><bdi>{d.reason}</bdi></p>
                  {d.status === 'pending' ? (
                    <div className="mt-2 space-y-2">
                      <Label htmlFor={`snote-${d.id}`} className="text-xs">{ar ? 'ملاحظة للمستشار (اختيارية، مسجلة)' : 'Note to the consultant (optional, audited)'}</Label>
                      <Textarea id={`snote-${d.id}`} rows={2} maxLength={500} value={notes[d.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [d.id]: e.target.value }))} />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={busy === d.id} onClick={() => decide(d.id, 'solved')}>{ar ? 'احتسابه محلولًا' : 'Count as solved'}</Button>
                        <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => decide(d.id, 'void')}>{ar ? 'استبعاده من الإحصاءات' : 'Remove from statistics'}</Button>
                        <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => decide(d.id, 'reject')}>{ar ? 'إبقاؤه غير محلول' : 'Keep as not solved'}</Button>
                      </div>
                    </div>
                  ) : d.admin_note ? <p className="mt-1 text-xs text-muted-foreground">{d.admin_note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
