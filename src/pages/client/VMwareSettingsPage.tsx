import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Server, Monitor, Settings2, Check, Zap, Crown, Cpu, MemoryStick, HardDrive, CreditCard } from 'lucide-react';
import { useRemoteEnvironments } from '@/hooks/useRemoteEnvironments';
import { useVMwareSettings, useSaveVMwareSettings } from '@/hooks/useVMwareSettings';
import { useVMwarePricingPlans, useVMwareSubscriptions, useSubscribeVMwarePlan } from '@/hooks/useVMwarePricing';
import VMwareSettingsForm from '@/components/remote/VMwareSettingsForm';

const tierIcons: Record<string, typeof Zap> = { basic: Zap, pro: Server, enterprise: Crown };

export default function ClientVMwareSettingsPage() {
  const { t } = useTranslation();
  const { data: environments, isLoading: envsLoading } = useRemoteEnvironments();
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const { data: settings, isLoading: settingsLoading } = useVMwareSettings(selectedEnvId || undefined);
  const saveSettings = useSaveVMwareSettings();
  const { data: plans, isLoading: plansLoading } = useVMwarePricingPlans();
  const { data: subscriptions } = useVMwareSubscriptions();
  const subscribe = useSubscribeVMwarePlan();

  const selectedEnv = (environments || []).find(e => e.id === selectedEnvId);
  const activePlanIds = (subscriptions || []).filter(s => s.status === 'active').map(s => s.plan_id);

  if (envsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const envs = environments || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Settings2 className="w-6 h-6 text-primary" /> {t('client.vmware_title', 'VMware Settings')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('client.vmware_subtitle', 'Configure your VMware infrastructure, VM defaults, and network security')}
        </p>
      </div>

      {/* Pricing Plans */}
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-3">
          <CreditCard className="w-4 h-4 text-primary" /> Pricing Plans
        </h2>
        {plansLoading ? (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            {[1,2,3].map(i => <Skeleton key={i} className="h-52 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            {(plans || []).map(plan => {
              const TierIcon = tierIcons[plan.tier] || Zap;
              const isActive = activePlanIds.includes(plan.id);
              const features = Array.isArray(plan.features) ? plan.features : [];

              return (
                <Card key={plan.id} className={`rounded-2xl ${plan.tier === 'pro' ? 'border-2 border-primary shadow-md relative' : 'border-border/50'}`}>
                  {plan.tier === 'pro' && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground text-[9px]">Popular</Badge>
                    </div>
                  )}
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <TierIcon className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold">{plan.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-tight">{plan.description}</p>

                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-foreground">${plan.monthly_rate}</span>
                      <span className="text-xs text-muted-foreground">/mo</span>
                      <span className="text-[10px] text-muted-foreground ml-1">(${plan.hourly_rate}/hr)</span>
                    </div>

                    <div className="space-y-1 py-2 border-y border-border/40">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Cpu className="w-3 h-3" /> {plan.included_cpu} vCPU
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <MemoryStick className="w-3 h-3" /> {plan.included_ram_gb} GB RAM
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <HardDrive className="w-3 h-3" /> {plan.included_disk_gb} GB Disk
                      </div>
                    </div>

                    <ul className="space-y-1">
                      {features.slice(0, 4).map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[10px]">
                          <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                      {features.length > 4 && (
                        <li className="text-[10px] text-muted-foreground pl-4">+{features.length - 4} more</li>
                      )}
                    </ul>

                    <Button
                      size="sm"
                      className="w-full text-xs h-8"
                      variant={isActive ? 'outline' : plan.tier === 'pro' ? 'default' : 'secondary'}
                      disabled={isActive || subscribe.isPending}
                      onClick={() => subscribe.mutate({ plan_id: plan.id, environment_id: selectedEnvId || undefined })}
                    >
                      {isActive ? '✓ Current Plan' : 'Subscribe'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}

            {/* Pay as you go card */}
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Pay as you go</span>
                  <Badge variant="outline" className="text-[9px]">No commitment</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground leading-tight">No monthly fee — pay only for what you use.</p>

                <div className="space-y-1 py-2 border-y border-border/40">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Cpu className="w-3 h-3" /> $0.05 /vCPU/hr
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <MemoryStick className="w-3 h-3" /> $0.01 /GB RAM/hr
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <HardDrive className="w-3 h-3" /> $0.0005 /GB Disk/hr
                  </div>
                </div>

                <ul className="space-y-1">
                  <li className="flex items-start gap-1.5 text-[10px]">
                    <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" /> Per-second billing
                  </li>
                  <li className="flex items-start gap-1.5 text-[10px]">
                    <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" /> No minimum spend
                  </li>
                  <li className="flex items-start gap-1.5 text-[10px]">
                    <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" /> Auto-scale resources
                  </li>
                </ul>

                <Button
                  size="sm"
                  className="w-full text-xs h-8"
                  variant="secondary"
                  disabled={subscribe.isPending}
                  onClick={() => subscribe.mutate({ plan_id: 'payg', environment_id: selectedEnvId || undefined, billing_cycle: 'payg' })}
                >
                  Enable Pay as you go
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Environment selector */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">{t('client.vmware_select_env', 'Select Environment')}</label>
              <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder={t('client.vmware_select_placeholder', 'Choose an environment...')} />
                </SelectTrigger>
                <SelectContent>
                  {envs.map(env => (
                    <SelectItem key={env.id} value={env.id}>
                      <div className="flex items-center gap-2">
                        <Monitor className="w-3.5 h-3.5" />
                        {env.name}
                        <Badge variant="outline" className="text-[9px]">
                          {env.platform_type === 'vmware' ? 'VMware' : env.platform_type}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings form */}
      {selectedEnvId ? (
        settingsLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : (
          <VMwareSettingsForm
            settings={settings || null}
            environmentId={selectedEnvId}
            environmentName={selectedEnv?.name || ''}
            onSave={(data) => saveSettings.mutate(data)}
            saving={saveSettings.isPending}
          />
        )
      ) : (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Settings2 className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">{t('client.vmware_select_hint', 'Select an environment above to configure its VMware settings')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
