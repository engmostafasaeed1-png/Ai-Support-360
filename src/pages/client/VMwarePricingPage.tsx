import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Clock, Cpu, Crown, ExternalLink, Gift, HardDrive, Loader2, MemoryStick, Server, Zap } from 'lucide-react';
import {
  useRequestVMwarePlan,
  useVMwarePricingPlans,
  useVMwareSubscriptions,
  type VMwarePricingPlan,
  type VMwareSubscription,
} from '@/hooks/useVMwarePricing';
import { cn } from '@/lib/utils';

type Cycle = 'monthly' | 'hourly';

const TIER_ICON: Record<string, typeof Zap> = {
  free: Gift,
  basic: Zap,
  pro: Server,
  enterprise: Crown,
  payg: Clock,
};

const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  active: 'Active',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const STATUS_CLASS: Record<string, string> = {
  requested: 'border-info/40 bg-info/10 text-info',
  active: 'border-success/40 bg-success/10 text-success',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground',
  expired: 'border-border bg-muted text-muted-foreground',
};

/** 149 -> $149, 0.05 -> $0.05, 0.0005 -> $0.0005 */
const money = (v: number): string => `$${v.toFixed(4).replace(/\.?0+$/, '')}`;
const isHttpUrl = (u: string | null): u is string => !!u && /^https?:\/\/\S+$/i.test(u);

interface PlanCardProps {
  plan: VMwarePricingPlan;
  cycle: Cycle;
  sub: VMwareSubscription | undefined;
  busy: boolean;
  onRequest: () => void;
}

function PlanCard({ plan, cycle, sub, busy, onRequest }: PlanCardProps) {
  const Icon = TIER_ICON[plan.tier] ?? Server;
  const isFree = plan.tier === 'free';
  const isPayg = plan.tier === 'payg';
  const popular = plan.tier === 'pro';
  const upTo = isFree ? 'Up to ' : '';

  return (
    <Card className={cn('relative flex flex-col rounded-2xl border-2', popular ? 'border-primary shadow-lg' : 'border-border/50')}>
      {popular ? (
        <div className="absolute -top-3 start-1/2 -translate-x-1/2 rtl:translate-x-1/2">
          <Badge className="bg-primary text-xs text-primary-foreground">Most Popular</Badge>
        </div>
      ) : null}
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg leading-tight">{plan.name}</CardTitle>
        </div>
        {plan.description ? <p className="text-xs text-muted-foreground">{plan.description}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div>
          {isFree ? (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">Free</span>
            </div>
          ) : isPayg ? (
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold text-foreground">No monthly fee</span>
            </div>
          ) : cycle === 'monthly' ? (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">{money(plan.monthly_rate)}</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">{money(plan.hourly_rate)}</span>
              <span className="text-sm text-muted-foreground">/hr</span>
            </div>
          )}
        </div>

        <div className="space-y-1.5 border-y border-border/50 py-3">
          {isPayg ? (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cpu aria-hidden="true" className="h-3.5 w-3.5" />
                <span><span className="font-semibold text-foreground">{money(plan.cpu_price_per_core)}</span> per vCPU per hour</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MemoryStick aria-hidden="true" className="h-3.5 w-3.5" />
                <span><span className="font-semibold text-foreground">{money(plan.ram_price_per_gb)}</span> per GB RAM per hour</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HardDrive aria-hidden="true" className="h-3.5 w-3.5" />
                <span><span className="font-semibold text-foreground">{money(plan.disk_price_per_gb)}</span> per GB disk per hour</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cpu aria-hidden="true" className="h-3.5 w-3.5" />
                <span>{upTo}{plan.included_cpu} vCPU included{!isFree ? ` (+${money(plan.cpu_price_per_core)} per core per hour)` : ''}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MemoryStick aria-hidden="true" className="h-3.5 w-3.5" />
                <span>{upTo}{plan.included_ram_gb} GB RAM included{!isFree ? ` (+${money(plan.ram_price_per_gb)} per GB per hour)` : ''}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HardDrive aria-hidden="true" className="h-3.5 w-3.5" />
                <span>{upTo}{plan.included_disk_gb} GB disk included{!isFree ? ` (+${money(plan.disk_price_per_gb)} per GB per hour)` : ''}</span>
              </div>
            </>
          )}
        </div>

        {plan.features.length > 0 ? (
          <ul className="space-y-1.5">
            {plan.features.map((f, i) => (
              <li key={`${f}-${i}`} className="flex items-start gap-2 text-xs">
                <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-foreground">{f}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {plan.provider_name || isHttpUrl(plan.external_url) ? (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 text-xs text-muted-foreground">
            {plan.provider_name ? (
              <p>
                Runs on <span className="font-medium text-foreground">{plan.provider_name}</span>
              </p>
            ) : null}
            {isHttpUrl(plan.external_url) ? (
              <a
                href={plan.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Learn more <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto space-y-2 pt-1">
          {sub?.status === 'active' ? (
            <Button className="w-full" variant="outline" disabled>
              Current plan
            </Button>
          ) : sub?.status === 'requested' ? (
            <>
              <Button className="w-full" variant="outline" disabled>
                Requested
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">An administrator will contact you.</p>
            </>
          ) : (
            <Button className="w-full" variant={popular ? 'default' : 'secondary'} disabled={busy} onClick={onRequest}>
              {busy ? <Loader2 aria-hidden="true" className="me-2 h-4 w-4 animate-spin" /> : null}
              {isFree ? 'Request free sandbox' : 'Request plan'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function VMwarePricingPage() {
  const { data: plans, isLoading } = useVMwarePricingPlans();
  const { data: subscriptions } = useVMwareSubscriptions();
  const request = useRequestVMwarePlan();
  const [cycle, setCycle] = useState<Cycle>('monthly');

  // one open (requested or active) subscription per plan; active wins over requested
  const openByPlan = useMemo(() => {
    const m = new Map<string, VMwareSubscription>();
    (subscriptions ?? []).forEach((s) => {
      if (s.status !== 'active' && s.status !== 'requested') return;
      const cur = m.get(s.plan_id);
      if (!cur || (cur.status === 'requested' && s.status === 'active')) m.set(s.plan_id, s);
    });
    return m;
  }, [subscriptions]);

  const planName = useMemo(() => new Map((plans ?? []).map((p): [string, string] => [p.id, p.name])), [plans]);
  const paidAndPayg = useMemo(() => (plans ?? []).filter((p) => p.tier !== 'free'), [plans]);
  const pendingId = request.isPending ? request.variables?.plan_id : undefined;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-80 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Server aria-hidden="true" className="h-6 w-6 text-primary" /> VMware Pricing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a plan and send a request. An administrator activates it and contacts you with the access details.
        </p>
      </div>

      <Tabs value={cycle} onValueChange={(v) => setCycle(v as Cycle)}>
        <TabsList className="w-full max-w-xs">
          <TabsTrigger value="monthly" className="flex-1">Monthly</TabsTrigger>
          <TabsTrigger value="hourly" className="flex-1">Hourly</TabsTrigger>
        </TabsList>
      </Tabs>

      {(plans ?? []).length === 0 ? (
        <p className="rounded-2xl border border-border/50 p-8 text-center text-sm text-muted-foreground">
          No plans are available right now. Please check again later.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(plans ?? []).map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              sub={openByPlan.get(plan.id)}
              busy={pendingId === plan.id}
              onRequest={() => request.mutate({ plan_id: plan.id, billing_cycle: cycle })}
            />
          ))}
        </div>
      )}

      {(subscriptions ?? []).length > 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Your requests and plans</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/50">
              {(subscriptions ?? []).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{planName.get(s.plan_id) ?? 'VMware plan'}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.billing_cycle === 'payg' ? 'Pay as you go' : s.billing_cycle === 'hourly' ? 'Hourly' : 'Monthly'}
                      {' · '}
                      {s.status === 'requested' ? 'Asked on ' : s.status === 'active' ? 'Active since ' : 'Updated '}
                      {new Date(s.status === 'active' ? s.started_at : s.status === 'requested' ? s.created_at : s.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('text-[11px]', STATUS_CLASS[s.status] ?? STATUS_CLASS.cancelled)}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {paidAndPayg.length > 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Extra resources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 text-start font-medium text-muted-foreground">Resource</th>
                    {paidAndPayg.map((p) => (
                      <th key={p.id} className="py-2 text-center font-medium text-muted-foreground">{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-2">CPU (per core per hour)</td>
                    {paidAndPayg.map((p) => (
                      <td key={p.id} className="py-2 text-center">{money(p.cpu_price_per_core)}</td>
                    ))}
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">RAM (per GB per hour)</td>
                    {paidAndPayg.map((p) => (
                      <td key={p.id} className="py-2 text-center">{money(p.ram_price_per_gb)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2">Disk (per GB per hour)</td>
                    {paidAndPayg.map((p) => (
                      <td key={p.id} className="py-2 text-center">{money(p.disk_price_per_gb)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Prices are in US dollars. The free sandbox runs on Oracle Cloud's Always Free tier: Oracle sets its limits and can change them, and you need your own Oracle Cloud account.
      </p>
    </div>
  );
}
