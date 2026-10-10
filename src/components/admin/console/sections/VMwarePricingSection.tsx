import { useMemo, useState, type ReactNode } from 'react';
import { DollarSign, ExternalLink, Loader2, Pencil, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useAdminVMwarePlans,
  useAdminVMwareSubscriptions,
  useDecideVMwareRequest,
  useSaveVMwarePlan,
  type VMwarePlanInput,
  type VMwarePlanTier,
  type VMwarePricingPlan,
} from '@/hooks/useVMwarePricing';
import { cn } from '@/lib/utils';

const TIER_OPTIONS: { value: VMwarePlanTier; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'payg', label: 'Pay as you go' },
];
const TIER_LABEL: Record<string, string> = Object.fromEntries(TIER_OPTIONS.map((t) => [t.value, t.label]));

const URL_RE = /^https?:\/\/[^\s<>"'`]+$/i;
const money = (v: number): string => `$${v.toFixed(4).replace(/\.?0+$/, '')}`;

interface FormState {
  name: string;
  tier: VMwarePlanTier;
  description: string;
  monthly_rate: string;
  hourly_rate: string;
  cpu_price_per_core: string;
  ram_price_per_gb: string;
  disk_price_per_gb: string;
  included_cpu: string;
  included_ram_gb: string;
  included_disk_gb: string;
  features: string;
  provider_name: string;
  external_url: string;
  sort_order: string;
  is_active: boolean;
}

function toForm(plan: VMwarePricingPlan | null, nextSort: number): FormState {
  if (!plan) {
    return {
      name: '', tier: 'basic', description: '', monthly_rate: '0', hourly_rate: '0',
      cpu_price_per_core: '0', ram_price_per_gb: '0', disk_price_per_gb: '0',
      included_cpu: '0', included_ram_gb: '0', included_disk_gb: '0',
      features: '', provider_name: '', external_url: '', sort_order: String(nextSort), is_active: true,
    };
  }
  return {
    name: plan.name,
    tier: (TIER_OPTIONS.some((t) => t.value === plan.tier) ? plan.tier : 'basic') as VMwarePlanTier,
    description: plan.description ?? '',
    monthly_rate: String(plan.monthly_rate),
    hourly_rate: String(plan.hourly_rate),
    cpu_price_per_core: String(plan.cpu_price_per_core),
    ram_price_per_gb: String(plan.ram_price_per_gb),
    disk_price_per_gb: String(plan.disk_price_per_gb),
    included_cpu: String(plan.included_cpu),
    included_ram_gb: String(plan.included_ram_gb),
    included_disk_gb: String(plan.included_disk_gb),
    features: plan.features.join('\n'),
    provider_name: plan.provider_name ?? '',
    external_url: plan.external_url ?? '',
    sort_order: String(plan.sort_order),
    is_active: plan.is_active,
  };
}

function validate(f: FormState): { errors: Record<string, string>; values: VMwarePlanInput } {
  const errors: Record<string, string> = {};
  const amount = (raw: string, key: string, label: string): number => {
    const s = raw.trim();
    if (s === '') return 0;
    const v = Number(s);
    if (!Number.isFinite(v) || v < 0) { errors[key] = `${label}: enter a number of 0 or more`; return 0; }
    if (v > 1_000_000) { errors[key] = `${label}: the number is too large`; return 0; }
    return v;
  };
  const whole = (raw: string, key: string, label: string, max: number): number => {
    const s = raw.trim();
    if (s === '') return 0;
    const v = Number(s);
    if (!Number.isInteger(v) || v < 0) { errors[key] = `${label}: enter a whole number of 0 or more`; return 0; }
    if (v > max) { errors[key] = `${label}: the number is too large`; return 0; }
    return v;
  };

  const name = f.name.trim();
  if (name.length < 1 || name.length > 80) errors.name = 'The name must have 1 to 80 characters';
  const description = f.description.trim();
  if (description.length > 500) errors.description = 'The description can have at most 500 characters';
  const provider = f.provider_name.trim();
  if (provider.length > 80) errors.provider_name = 'The provider name can have at most 80 characters';
  const url = f.external_url.trim();
  if (url && (url.length > 500 || !URL_RE.test(url))) errors.external_url = 'Enter a link that starts with https:// or http://';
  const features = f.features.split('\n').map((s) => s.trim()).filter(Boolean);
  if (features.length > 12) errors.features = 'Use at most 12 lines';
  else if (features.some((s) => s.length > 200)) errors.features = 'Each line can have at most 200 characters';

  const values: VMwarePlanInput = {
    name,
    description: description || null,
    tier: f.tier,
    monthly_rate: amount(f.monthly_rate, 'monthly_rate', 'Monthly price'),
    hourly_rate: amount(f.hourly_rate, 'hourly_rate', 'Hourly price'),
    cpu_price_per_core: amount(f.cpu_price_per_core, 'cpu_price_per_core', 'Extra CPU price'),
    ram_price_per_gb: amount(f.ram_price_per_gb, 'ram_price_per_gb', 'Extra RAM price'),
    disk_price_per_gb: amount(f.disk_price_per_gb, 'disk_price_per_gb', 'Extra disk price'),
    included_cpu: whole(f.included_cpu, 'included_cpu', 'Included CPU', 10_000),
    included_ram_gb: whole(f.included_ram_gb, 'included_ram_gb', 'Included RAM', 100_000),
    included_disk_gb: whole(f.included_disk_gb, 'included_disk_gb', 'Included disk', 1_000_000),
    features,
    is_active: f.is_active,
    sort_order: whole(f.sort_order, 'sort_order', 'Order', 100_000),
    provider_name: provider || null,
    external_url: url || null,
  };
  return { errors, values };
}

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PlanDialog({ plan, nextSort, onClose }: { plan: VMwarePricingPlan | null; nextSort: number; onClose: () => void }) {
  const save = useSaveVMwarePlan();
  const [form, setForm] = useState<FormState>(() => toForm(plan, nextSort));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    const { errors: e, values } = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    save.mutate({ id: plan?.id, values }, { onSuccess: onClose });
  };

  const num = (key: keyof FormState, label: string, hint?: string) => (
    <Field label={label} htmlFor={`vp-${key}`} error={errors[key]} hint={hint}>
      <Input
        id={`vp-${key}`}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={String(form[key])}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : 'New plan'}</DialogTitle>
          <DialogDescription>
            Clients see the change as soon as you save. Every change is written to the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" htmlFor="vp-name" error={errors.name}>
            <Input id="vp-name" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type" htmlFor="vp-tier" hint="Free and Pay as you go have special wording on the client page.">
            <Select value={form.tier} onValueChange={(v) => set('tier', v as VMwarePlanTier)}>
              <SelectTrigger id="vp-tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description" htmlFor="vp-description" error={errors.description}>
              <Textarea id="vp-description" rows={2} maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </div>

          {num('monthly_rate', 'Monthly price (USD)')}
          {num('hourly_rate', 'Hourly price (USD)')}
          {num('cpu_price_per_core', 'Extra CPU, per core per hour (USD)')}
          {num('ram_price_per_gb', 'Extra RAM, per GB per hour (USD)')}
          {num('disk_price_per_gb', 'Extra disk, per GB per hour (USD)')}
          {num('sort_order', 'Order on the page', 'Smaller numbers come first.')}
          {num('included_cpu', 'CPU included (cores)')}
          {num('included_ram_gb', 'RAM included (GB)')}
          {num('included_disk_gb', 'Disk included (GB)')}

          <div className="md:col-span-2">
            <Field label="What is included (one line each)" htmlFor="vp-features" error={errors.features} hint="Shown as a checklist on the plan card. At most 12 lines.">
              <Textarea id="vp-features" rows={5} value={form.features} onChange={(e) => set('features', e.target.value)} />
            </Field>
          </div>

          <Field label="Provider (optional)" htmlFor="vp-provider" error={errors.provider_name} hint="For example Oracle Cloud Free Tier. Shown as “Runs on …”.">
            <Input id="vp-provider" value={form.provider_name} maxLength={80} onChange={(e) => set('provider_name', e.target.value)} />
          </Field>
          <Field label="Link (optional)" htmlFor="vp-url" error={errors.external_url} hint="Starts with https://. Shown as “Learn more”.">
            <Input id="vp-url" type="url" value={form.external_url} maxLength={500} onChange={(e) => set('external_url', e.target.value)} placeholder="https://" />
          </Field>

          <div className="flex items-center justify-between rounded-xl border border-border/60 p-3 md:col-span-2">
            <div>
              <Label htmlFor="vp-active" className="text-sm font-medium">Visible to clients</Label>
              <p className="text-xs text-muted-foreground">Turn it off to hide the plan without deleting it. Existing subscriptions are not changed.</p>
            </div>
            <Switch id="vp-active" checked={form.is_active} onCheckedChange={(v) => set('is_active', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={save.isPending} className="gap-2">
            {save.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VMwarePricingSection() {
  const { data: plans, isLoading, error } = useAdminVMwarePlans();
  const { data: subs } = useAdminVMwareSubscriptions();
  const decide = useDecideVMwareRequest();
  const [editing, setEditing] = useState<VMwarePricingPlan | 'new' | null>(null);

  const planName = useMemo(() => new Map((plans ?? []).map((p): [string, string] => [p.id, p.name])), [plans]);
  const requested = useMemo(() => (subs ?? []).filter((s) => s.status === 'requested'), [subs]);
  const counts = useMemo(() => {
    const m = new Map<string, { active: number; requested: number }>();
    (subs ?? []).forEach((s) => {
      const c = m.get(s.plan_id) ?? { active: 0, requested: 0 };
      if (s.status === 'active') c.active += 1;
      if (s.status === 'requested') c.requested += 1;
      m.set(s.plan_id, c);
    });
    return m;
  }, [subs]);
  const nextSort = useMemo(() => Math.max(0, ...(plans ?? []).filter((p) => p.tier !== 'payg').map((p) => p.sort_order)) + 10, [plans]);
  const pendingId = decide.isPending ? decide.variables?.id : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <DollarSign aria-hidden="true" className="h-5 w-5 text-primary" /> VMware Pricing
          </h2>
          <p className="text-sm text-muted-foreground">
            The plans and prices clients see on their VMware Pricing page. A client sends a request, you activate it here, and you set up the server yourself.
          </p>
        </div>
        <Button onClick={() => setEditing('new')} className="gap-2">
          <Plus aria-hidden="true" className="h-4 w-4" /> New plan
        </Button>
      </div>

      {requested.length > 0 ? (
        <Card className="rounded-2xl border-info/30 bg-info/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Waiting for you ({requested.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/50">
              {requested.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-foreground">{s.client_name}</p>
                    <p className="text-xs text-muted-foreground">
                      asked for {planName.get(s.plan_id) ?? 'a plan'} ({s.billing_cycle === 'payg' ? 'pay as you go' : s.billing_cycle}) on {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === s.id}
                      onClick={() => decide.mutate({ id: s.id, status: 'rejected' })}
                    >
                      Reject
                    </Button>
                    <Button size="sm" disabled={pendingId === s.id} onClick={() => decide.mutate({ id: s.id, status: 'active' })} className="gap-2">
                      {pendingId === s.id ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}
                      Activate
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Activating tells the client that the plan is active and that you will contact them with the access details. Rejecting tells them the request was not accepted.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
      ) : error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(plans ?? []).map((p) => {
            const c = counts.get(p.id) ?? { active: 0, requested: 0 };
            return (
              <Card key={p.id} className={cn('rounded-2xl', !p.is_active && 'opacity-70')}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{p.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-[10px]">{TIER_LABEL[p.tier] ?? p.tier}</Badge>
                        {!p.is_active ? <Badge variant="outline" className="text-[10px]">Hidden from clients</Badge> : null}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => setEditing(p)}>
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" /> Edit
                    </Button>
                  </div>

                  <div className="text-sm">
                    {p.tier === 'free' ? (
                      <p className="font-semibold text-foreground">Free</p>
                    ) : p.tier === 'payg' ? (
                      <p className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{money(p.cpu_price_per_core)}</span> CPU ·{' '}
                        <span className="font-semibold text-foreground">{money(p.ram_price_per_gb)}</span> RAM ·{' '}
                        <span className="font-semibold text-foreground">{money(p.disk_price_per_gb)}</span> disk, per hour
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{money(p.monthly_rate)}</span>/month ·{' '}
                        <span className="font-semibold text-foreground">{money(p.hourly_rate)}</span>/hour
                      </p>
                    )}
                    {p.tier !== 'payg' ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.included_cpu} CPU · {p.included_ram_gb} GB RAM · {p.included_disk_gb} GB disk included
                      </p>
                    ) : null}
                  </div>

                  {p.provider_name || p.external_url ? (
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {p.provider_name ? <span>{p.provider_name}</span> : null}
                      {p.external_url && URL_RE.test(p.external_url) ? (
                        <a href={p.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          Link <ExternalLink aria-hidden="true" className="h-3 w-3" />
                        </a>
                      ) : null}
                    </p>
                  ) : null}

                  <p className="text-xs text-muted-foreground">
                    {c.active} active · {c.requested} waiting
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing ? (
        <PlanDialog
          key={editing === 'new' ? 'new' : editing.id}
          plan={editing === 'new' ? null : editing}
          nextSort={nextSort}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
