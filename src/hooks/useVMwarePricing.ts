import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface VMwarePricingPlan {
  id: string;
  name: string;
  description: string | null;
  tier: string;
  hourly_rate: number;
  monthly_rate: number;
  cpu_price_per_core: number;
  ram_price_per_gb: number;
  disk_price_per_gb: number;
  included_cpu: number;
  included_ram_gb: number;
  included_disk_gb: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VMwareSubscription {
  id: string;
  client_id: string;
  plan_id: string;
  environment_id: string | null;
  billing_cycle: string;
  status: string;
  current_monthly_cost: number;
  started_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useVMwarePricingPlans() {
  return useQuery({
    queryKey: ['vmware-pricing-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_pricing_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as VMwarePricingPlan[];
    },
  });
}

export function useVMwareSubscriptions() {
  return useQuery({
    queryKey: ['vmware-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_subscriptions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as VMwareSubscription[];
    },
  });
}

export function useSubscribeVMwarePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { plan_id: string; environment_id?: string; billing_cycle?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('vmware_subscriptions')
        .insert({
          client_id: user.id,
          plan_id: params.plan_id,
          environment_id: params.environment_id || null,
          billing_cycle: params.billing_cycle || 'monthly',
          status: 'active',
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vmware-subscriptions'] });
      toast.success('Subscribed to VMware plan successfully!');
    },
    onError: (err: any) => toast.error('Failed to subscribe', { description: err.message }),
  });
}
