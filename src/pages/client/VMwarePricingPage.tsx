import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Zap, Crown, Server, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { useVMwarePricingPlans, useVMwareSubscriptions, useSubscribeVMwarePlan } from '@/hooks/useVMwarePricing';

const tierConfig: Record<string, { icon: typeof Zap; color: string; badge: string }> = {
  basic: { icon: Zap, color: 'border-muted', badge: 'bg-muted text-muted-foreground' },
  pro: { icon: Server, color: 'border-primary', badge: 'bg-primary/10 text-primary' },
  enterprise: { icon: Crown, color: 'border-amber-500', badge: 'bg-amber-500/10 text-amber-600' },
};

export default function VMwarePricingPage() {
  const { t } = useTranslation();
  const { data: plans, isLoading } = useVMwarePricingPlans();
  const { data: subscriptions } = useVMwareSubscriptions();
  const subscribe = useSubscribeVMwarePlan();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'hourly'>('monthly');

  const activePlanIds = (subscriptions || []).filter(s => s.status === 'active').map(s => s.plan_id);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-80 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Server className="w-6 h-6 text-primary" /> VMware Pricing
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the right plan for your infrastructure needs
        </p>
      </div>

      <Tabs value={billingCycle} onValueChange={v => setBillingCycle(v as any)}>
        <TabsList className="w-full max-w-xs">
          <TabsTrigger value="monthly" className="flex-1">Monthly</TabsTrigger>
          <TabsTrigger value="hourly" className="flex-1">Hourly</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-3">
        {(plans || []).map(plan => {
          const config = tierConfig[plan.tier] || tierConfig.basic;
          const TierIcon = config.icon;
          const isActive = activePlanIds.includes(plan.id);
          const features = Array.isArray(plan.features) ? plan.features : [];

          return (
            <Card key={plan.id} className={`rounded-2xl border-2 ${plan.tier === 'pro' ? 'border-primary shadow-lg relative' : 'border-border/50'}`}>
              {plan.tier === 'pro' && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground text-xs">Most Popular</Badge>
                </div>
              )}
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TierIcon className="w-5 h-5 text-primary" />
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">{plan.description}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  {billingCycle === 'monthly' ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">${plan.monthly_rate}</span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">${plan.hourly_rate}</span>
                      <span className="text-sm text-muted-foreground">/hr</span>
                    </div>
                  )}
                </div>

                {/* Resource pricing */}
                <div className="space-y-1.5 py-3 border-y border-border/50">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{plan.included_cpu} vCPU incl. (+${plan.cpu_price_per_core}/core/hr)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MemoryStick className="w-3.5 h-3.5" />
                    <span>{plan.included_ram_gb} GB RAM incl. (+${plan.ram_price_per_gb}/GB/hr)</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>{plan.included_disk_gb} GB Disk incl. (+${plan.disk_price_per_gb}/GB/hr)</span>
                  </div>
                </div>

                {/* Features */}
                <ul className="space-y-1.5">
                  {features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span className="text-foreground">{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full"
                  variant={isActive ? 'outline' : plan.tier === 'pro' ? 'default' : 'secondary'}
                  disabled={isActive || subscribe.isPending}
                  onClick={() => subscribe.mutate({ plan_id: plan.id, billing_cycle: billingCycle })}
                >
                  {isActive ? 'Current Plan' : 'Subscribe'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Resource pricing table */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Resource-Based Pricing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 text-muted-foreground font-medium">Resource</th>
                  {(plans || []).map(p => (
                    <th key={p.id} className="text-center py-2 text-muted-foreground font-medium">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/30">
                  <td className="py-2">Extra CPU (per core/hr)</td>
                  {(plans || []).map(p => <td key={p.id} className="text-center py-2">${p.cpu_price_per_core}</td>)}
                </tr>
                <tr className="border-b border-border/30">
                  <td className="py-2">Extra RAM (per GB/hr)</td>
                  {(plans || []).map(p => <td key={p.id} className="text-center py-2">${p.ram_price_per_gb}</td>)}
                </tr>
                <tr>
                  <td className="py-2">Extra Disk (per GB/hr)</td>
                  {(plans || []).map(p => <td key={p.id} className="text-center py-2">${p.disk_price_per_gb}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
