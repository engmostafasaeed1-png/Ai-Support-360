import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCriticalTerms, useSaveCriticalService } from '@/hooks/useCriticalService';
import { termsProblem, type CriticalTerms } from '@/lib/criticalService';

type Form = { enabled: boolean; minutes: string; percent: string; maxMinutes: string; maxPercent: string };

const toForm = (t: CriticalTerms): Form => ({
  enabled: t.enabled,
  minutes: String(t.minutes),
  percent: String(t.surcharge_percent),
  maxMinutes: String(t.max_minutes),
  maxPercent: String(t.max_surcharge_percent),
});

const toTerms = (f: Form): CriticalTerms => ({
  enabled: f.enabled,
  minutes: f.minutes.trim() === '' ? Number.NaN : Number(f.minutes),
  surcharge_percent: f.percent.trim() === '' ? Number.NaN : Number(f.percent),
  max_minutes: f.maxMinutes.trim() === '' ? Number.NaN : Number(f.maxMinutes),
  max_surcharge_percent: f.maxPercent.trim() === '' ? Number.NaN : Number(f.maxPercent),
});

/**
 * Admin: the critical reply service. Clients can ask for a fast reply on a Critical ticket; the consultants who cover the SAP area are alarmed,
 * and the consultant who replies in time earns the surcharge on the approved hourly rate. Running requests keep the numbers they started with.
 */
export default function CriticalServiceSettingsCard() {
  const termsQ = useCriticalTerms();
  const save = useSaveCriticalService();
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (termsQ.data) setForm(toForm(termsQ.data));
  }, [termsQ.data]);

  const set = (patch: Partial<Form>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  const terms = form ? toTerms(form) : null;
  const problem = terms ? termsProblem(terms) : null;
  const changed = !!termsQ.data && !!form && JSON.stringify(toForm(termsQ.data)) !== JSON.stringify(form);

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><AlarmClock className="h-4 w-4" /> Critical reply service</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A client can ask for a fast reply on a Critical ticket. Every verified consultant who covers the SAP area gets an alarm, and a consultant who replies with a proposal inside the reply window earns the surcharge on the approved hourly rate. If nobody replies in time, no surcharge applies. Requests that are already running keep the numbers they started with.
        </p>

        {termsQ.isLoading || !form ? (
          termsQ.isError ? <p className="text-xs text-destructive">The settings could not be loaded. Please reload the page.</p> : <Skeleton className="h-24 rounded-lg" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="critical-enabled">Critical reply service is on</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">Off: clients do not see the option and no new critical request can be made.</p>
              </div>
              <Switch id="critical-enabled" checked={form.enabled} onCheckedChange={(enabled) => set({ enabled })} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="critical-set-minutes" className="text-xs">Standard reply window (minutes)</Label>
                <Input id="critical-set-minutes" inputMode="numeric" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="critical-set-percent" className="text-xs">Standard surcharge (%)</Label>
                <Input id="critical-set-percent" inputMode="decimal" value={form.percent} onChange={(e) => set({ percent: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="critical-set-max-minutes" className="text-xs">Longest window a client can choose (minutes)</Label>
                <Input id="critical-set-max-minutes" inputMode="numeric" value={form.maxMinutes} onChange={(e) => set({ maxMinutes: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="critical-set-max-percent" className="text-xs">Highest surcharge a client can choose (%)</Label>
                <Input id="critical-set-max-percent" inputMode="decimal" value={form.maxPercent} onChange={(e) => set({ maxPercent: e.target.value })} />
              </div>
            </div>

            {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
            <div className="flex items-center gap-3">
              <Button disabled={!!problem || !changed || save.isPending} onClick={() => terms && save.mutate(terms)}>
                {save.isPending ? 'Saving...' : 'Save'}
              </Button>
              {!changed && !problem && <span className="text-xs text-muted-foreground">Nothing to save.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
