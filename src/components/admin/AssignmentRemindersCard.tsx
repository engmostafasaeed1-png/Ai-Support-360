import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellRing, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import { useAssignmentPolicy } from '@/hooks/useAssignmentPolicy';
import {
  policyText, timingsProblems, type PolicyMinutes,
} from '../../../supabase/functions/_shared/assignmentPolicy';

type Stats = {
  last_run: string | null;
  sent_today: number;
  waiting: number;
  no_response_30d: number;
  lowest: Array<{ consultant_id: string; name: string | null; answered: number; no_response: number; rate: number | null }>;
};

type RpcResult = { data: unknown; error: { message: string } | null };
// Called as a method: supabase.rpc reads `this`, so a detached reference throws.
const rpc = (fn: string): Promise<RpcResult> => (supabase as unknown as { rpc: (f: string) => Promise<RpcResult> }).rpc(fn);

/** Fields of the form: normal timings in hours, Critical timings in minutes. */
const HOUR_FIELDS = [
  ['r1', 'Reminder 1 after (hours)'],
  ['r2', 'Reminder 2 after (hours)'],
  ['r3', 'Reminder 3 after (hours)'],
  ['expire', 'No response after (hours)'],
  ['extend', '"Wait longer" adds (hours)'],
] as const;
const MINUTE_FIELDS = [
  ['critical_r1', 'Critical reminder 1 (minutes)'],
  ['critical_r2', 'Critical reminder 2 (minutes)'],
  ['critical_r3', 'Critical reminder 3 (minutes)'],
  ['critical_expire', 'Critical No response (minutes)'],
  ['hourly_limit', 'Most reminders per consultant per hour'],
] as const;

type Draft = Record<keyof PolicyMinutes, string>;

const toDraft = (m: PolicyMinutes): Draft => {
  const d = {} as Draft;
  (Object.keys(m) as Array<keyof PolicyMinutes>).forEach((k) => {
    const hours = HOUR_FIELDS.some(([f]) => f === k);
    d[k] = String(hours ? Math.round((m[k] / 60) * 100) / 100 : m[k]);
  });
  return d;
};

const fromDraft = (d: Draft): PolicyMinutes => {
  const m = {} as PolicyMinutes;
  (Object.keys(d) as Array<keyof PolicyMinutes>).forEach((k) => {
    const n = Number(d[k]);
    const hours = HOUR_FIELDS.some(([f]) => f === k);
    m[k] = Number.isFinite(n) ? Math.round(hours ? n * 60 : n) : NaN;
  });
  return m;
};

/** Admin switch, timings and statistics of the assignment response policy (Feature L). */
export default function AssignmentRemindersCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const queryClient = useQueryClient();
  const { settings, loading, updateSetting } = useAdminSettings();
  const policy = useAssignmentPolicy();
  const [draft, setDraft] = useState<Draft>(() => toDraft(policy));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!dirty) setDraft(toDraft(policy)); }, [policy, dirty]);

  const stats = useQuery({
    queryKey: ['admin-assignment-reminder-stats'],
    queryFn: async () => {
      const { data, error } = await rpc('admin_assignment_reminder_stats');
      if (error) throw error;
      return data as Stats;
    },
    retry: false,
  });

  const next = fromDraft(draft);
  const problems = timingsProblems(next);

  const save = async () => {
    if (problems.length > 0) return;
    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'assignment_reminder_minutes', value: next as never }, { onConflict: 'key' });
    setSaving(false);
    if (error) {
      toast.error(t('admin.assignment_save_failed', 'The timings could not be saved. Please try again.'));
      return;
    }
    setDirty(false);
    toast.success(t('admin.assignment_saved', 'Timings saved. New requests use them.'));
    queryClient.invalidateQueries({ queryKey: ['assignment-policy-minutes'] });
  };

  const field = (key: keyof PolicyMinutes, label: string) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={`assign-${key}`} className="text-xs">{t(`admin.assignment_field_${key}`, label)}</Label>
      <Input
        id={`assign-${key}`}
        inputMode="decimal"
        value={draft[key]}
        onChange={(e) => { setDraft((d) => ({ ...d, [key]: e.target.value })); setDirty(true); }}
        className="h-9"
      />
    </div>
  );

  const flagOn = settings.assignment_reminders === undefined ? true : settings.assignment_reminders;

  return (
    <Card id="assignment-reminders">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <BellRing className="h-5 w-5 text-primary" aria-hidden="true" />
        <CardTitle className="text-base">{t('admin.assignment_title', 'Assignment request reminders')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="assignment_reminders">{t('admin.assignment_switch', 'Send reminders and No response notices')}</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('admin.assignment_switch_hint', 'Off: consultants still get the first request message, but no reminders, and requests are not marked No response.')}
            </p>
          </div>
          {loading ? <Skeleton className="h-5 w-9 shrink-0 rounded-full" /> : (
            <Switch id="assignment_reminders" className="shrink-0" checked={flagOn} onCheckedChange={(v) => void updateSetting('assignment_reminders', v)} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {HOUR_FIELDS.map(([k, label]) => field(k, label))}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {MINUTE_FIELDS.map(([k, label]) => field(k, label))}
        </div>
        {problems.length > 0 && (
          <ul className="space-y-1 text-xs text-destructive" role="alert">
            {problems.includes('range') && <li>{t('admin.assignment_problem_range', 'Every value must be a whole number of minutes between 1 minute and 7 days (at most 60 reminders per hour).')}</li>}
            {problems.includes('order') && <li>{t('admin.assignment_problem_order', 'Reminders must come in order (1, then 2, then 3) and not after the No response time.')}</li>}
            {problems.includes('critical_order') && <li>{t('admin.assignment_problem_critical', 'Critical reminders must come in order and not after the Critical No response time.')}</li>}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving || problems.length > 0} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('admin.assignment_save', 'Save timings')}
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => { setDraft(toDraft(policy)); setDirty(false); }}>
              {t('admin.assignment_reset', 'Undo changes')}
            </Button>
          )}
        </div>

        <div className="rounded-xl bg-muted/60 p-3">
          <p className="text-[11px] font-medium text-foreground">{t('admin.assignment_policy_preview', 'Policy shown to consultants')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{policyText(problems.length ? policy : next, lang)}</p>
        </div>

        <div className="space-y-2">
          {stats.isPending && <Skeleton className="h-16 w-full" />}
          {stats.isError && (
            <p className="text-xs text-muted-foreground">
              {t('admin.assignment_stats_unavailable', 'Statistics are unavailable until the assignment-response SQL is applied.')}
            </p>
          )}
          {stats.data && (
            <>
              {([
                [t('admin.assignment_last_run', 'Last check'), stats.data.last_run ? new Date(stats.data.last_run).toLocaleString() : '—'],
                [t('admin.assignment_sent_today', 'Reminders sent today'), String(stats.data.sent_today ?? 0)],
                [t('admin.assignment_waiting', 'Requests waiting for a reply'), String(stats.data.waiting ?? 0)],
                [t('admin.assignment_no_response', 'No response in the last 30 days'), String(stats.data.no_response_30d ?? 0)],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground">{value}</span>
                </div>
              ))}
              {(stats.data.lowest ?? []).length > 0 && (
                <div className="pt-2">
                  <p className="text-xs font-medium text-foreground">{t('admin.assignment_lowest', 'Lowest response rates (administrators only)')}</p>
                  <ul className="mt-1 space-y-1">
                    {stats.data.lowest.map((r) => (
                      <li key={r.consultant_id} className="flex items-center justify-between text-xs">
                        <span className="truncate text-muted-foreground">{r.name || t('admin.assignment_consultant', 'Consultant')}</span>
                        <span className="shrink-0 font-medium text-foreground">
                          {r.rate == null ? '—' : `${Math.round(Number(r.rate) * 100)} %`} · {t('admin.assignment_missed', '{{count}} without reply', { count: r.no_response })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
