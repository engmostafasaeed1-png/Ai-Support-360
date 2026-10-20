import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { MATCH_WEIGHT_DEFAULTS, readMatchWeights, weightsVersion, type CriterionKey, type MatchWeights } from '../../../supabase/functions/_shared/ticketMatch';
import { CRITERION_LABELS } from '@/lib/matchLabels';

const KEY = 'match_weights';
const keys = Object.keys(MATCH_WEIGHT_DEFAULTS) as CriterionKey[];

/** Admin: tunable matching weights (0..50 each; only their proportions matter). Saved in platform settings. */
export default function MatchWeightsCard() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<CriterionKey, string>>(() => Object.fromEntries(keys.map((k) => [k, String(MATCH_WEIGHT_DEFAULTS[k])])) as Record<CriterionKey, string>);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['admin-match-weights'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('platform_settings').select('value').eq('key', KEY).maybeSingle();
      if (error) throw error;
      return readMatchWeights(data?.value);
    },
  });
  const runs = useQuery({
    queryKey: ['admin-match-runs-count'],
    retry: false,
    queryFn: async () => {
      const { count, error } = await (supabase as any).from('ticket_match_runs').select('id', { count: 'exact', head: true });
      return error ? null : (count as number);
    },
  });
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(keys.map((k) => [k, String(q.data[k])])) as Record<CriterionKey, string>);
  }, [q.data]);

  const parsed = readMatchWeights(Object.fromEntries(keys.map((k) => [k, draft[k]])));
  const valid = keys.every((k) => /^\d{1,2}$/.test(draft[k].trim()) && Number(draft[k]) <= 50) && keys.some((k) => Number(draft[k]) > 0);
  const save = async (weights: MatchWeights) => {
    setBusy(true);
    const { error } = await (supabase as any).from('platform_settings').upsert({ key: KEY, value: weights }, { onConflict: 'key' });
    setBusy(false);
    if (error) toast({ title: ar ? 'خطأ' : 'Error', description: error.message, variant: 'destructive' });
    else { toast({ title: ar ? 'تم الحفظ' : 'Saved' }); void qc.invalidateQueries({ queryKey: ['admin-match-weights'] }); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ar ? 'أوزان المطابقة' : 'Matching weights'}</CardTitle>
        <CardDescription>
          {ar ? 'لكل معيار وزن من 0 إلى 50؛ النسب بينها هي المهمة. القيمة 0 توقف المعيار. الشروط الإلزامية (التحقق، الحساب النشط، تداخل الوحدة، اللغة، الرد في الحالات الحرجة) لا تتأثر.'
            : 'Each criterion has a weight from 0 to 50; only their proportions matter. 0 switches a criterion off. Hard filters (verified, active, module overlap, language, can respond to critical) are not affected.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((k) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <Label htmlFor={`mw-${k}`} className="text-xs">{CRITERION_LABELS[k][ar ? 1 : 0]}</Label>
              <Input id={`mw-${k}`} inputMode="numeric" className="h-8 w-16 text-end" value={draft[k]} disabled={busy || q.isPending}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^\d]/g, '').slice(0, 2) }))} />
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {ar ? 'إصدار الأوزان' : 'Weights version'}: <span className="font-mono">{weightsVersion(parsed)}</span>
          {runs.data != null && <> · {ar ? `عمليات مطابقة مسجلة: ${runs.data}` : `Logged match runs: ${runs.data}`}</>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save(parsed)} disabled={!valid || busy || q.isPending}>{ar ? 'حفظ' : 'Save'}</Button>
          <Button variant="outline" onClick={() => save({ ...MATCH_WEIGHT_DEFAULTS })} disabled={busy || q.isPending}>{ar ? 'استعادة الافتراضي' : 'Reset to defaults'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
