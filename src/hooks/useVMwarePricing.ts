import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type VMwarePlanTier = 'free' | 'basic' | 'pro' | 'enterprise' | 'payg';

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
  provider_name: string | null;
  external_url: string | null;
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

/** The fields an administrator edits (the database checks the same limits). */
export interface VMwarePlanInput {
  name: string;
  description: string | null;
  tier: VMwarePlanTier;
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
  provider_name: string | null;
  external_url: string | null;
}

export const VMWARE_PLANS_KEY = ['vmware-pricing-plans'] as const;
export const VMWARE_ADMIN_PLANS_KEY = ['vmware-pricing-plans-admin'] as const;
export const VMWARE_SUBSCRIPTIONS_KEY = ['vmware-subscriptions'] as const;
export const VMWARE_ADMIN_SUBSCRIPTIONS_KEY = ['vmware-subscriptions-admin'] as const;

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toPlan(row: Record<string, unknown>): VMwarePricingPlan {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    description: str(row.description),
    tier: String(row.tier ?? 'basic'),
    hourly_rate: num(row.hourly_rate),
    monthly_rate: num(row.monthly_rate),
    cpu_price_per_core: num(row.cpu_price_per_core),
    ram_price_per_gb: num(row.ram_price_per_gb),
    disk_price_per_gb: num(row.disk_price_per_gb),
    included_cpu: num(row.included_cpu),
    included_ram_gb: num(row.included_ram_gb),
    included_disk_gb: num(row.included_disk_gb),
    features: Array.isArray(row.features) ? row.features.filter((f): f is string => typeof f === 'string') : [],
    is_active: row.is_active !== false,
    sort_order: num(row.sort_order),
    provider_name: str(row.provider_name),
    external_url: str(row.external_url),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/** Plans the clients see (active ones only). */
export function useVMwarePricingPlans() {
  return useQuery({
    queryKey: VMWARE_PLANS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_pricing_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => toPlan(r as unknown as Record<string, unknown>));
    },
  });
}

/** The signed-in client's own requests and plans. */
export function useVMwareSubscriptions() {
  return useQuery({
    queryKey: VMWARE_SUBSCRIPTIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_subscriptions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as VMwareSubscription[];
    },
  });
}

/** A client asks for a plan; an administrator activates it (the database function checks everything). */
export function useRequestVMwarePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { plan_id: string; billing_cycle?: string; environment_id?: string }) => {
      const { data, error } = await supabase.rpc('request_vmware_plan', {
        p_plan_id: params.plan_id,
        p_billing_cycle: params.billing_cycle ?? 'monthly',
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VMWARE_SUBSCRIPTIONS_KEY });
      toast.success('Request sent. An administrator will activate the plan and contact you.');
    },
    onError: (err: Error) => toast.error('Could not send the request', { description: err.message }),
  });
}

/** Old name, kept so nothing else breaks. */
export const useSubscribeVMwarePlan = useRequestVMwarePlan;

/** Every plan, also the hidden ones (administrators). */
export function useAdminVMwarePlans() {
  return useQuery({
    queryKey: VMWARE_ADMIN_PLANS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_pricing_plans')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => toPlan(r as unknown as Record<string, unknown>));
    },
  });
}

export function useSaveVMwarePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id?: string; values: VMwarePlanInput }) => {
      if (params.id) {
        const { data, error } = await supabase
          .from('vmware_pricing_plans')
          .update(params.values)
          .eq('id', params.id)
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('The plan could not be saved');
      } else {
        const { data, error } = await supabase.from('vmware_pricing_plans').insert(params.values).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('The plan could not be saved');
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: VMWARE_ADMIN_PLANS_KEY });
      void qc.invalidateQueries({ queryKey: VMWARE_PLANS_KEY });
      toast.success('Plan saved. Clients see it now.');
    },
    onError: (err: Error) => toast.error('Could not save the plan', { description: err.message }),
  });
}

export interface VMwareRequestRow extends VMwareSubscription {
  client_name: string;
}

/** All requests and subscriptions, with the client's name (administrators). */
export function useAdminVMwareSubscriptions() {
  return useQuery({
    queryKey: VMWARE_ADMIN_SUBSCRIPTIONS_KEY,
    queryFn: async (): Promise<VMwareRequestRow[]> => {
      const { data, error } = await supabase
        .from('vmware_subscriptions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as unknown as VMwareSubscription[];
      const ids = Array.from(new Set(rows.map((r) => r.client_id)));
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, display_name').in('user_id', ids);
        (profiles ?? []).forEach((p) => {
          if (p.display_name) names.set(p.user_id, p.display_name);
        });
      }
      return rows.map((r) => ({ ...r, client_name: names.get(r.client_id) ?? `Client ${r.client_id.slice(0, 8)}` }));
    },
    refetchInterval: 60_000,
  });
}

/** The administrator decides on a request: the database sets the dates and tells the client. */
export function useDecideVMwareRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; status: 'active' | 'rejected' | 'cancelled' }) => {
      const { data, error } = await supabase
        .from('vmware_subscriptions')
        .update({ status: params.status })
        .eq('id', params.id)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('The request could not be updated');
      return params.status;
    },
    onSuccess: (status) => {
      void qc.invalidateQueries({ queryKey: VMWARE_ADMIN_SUBSCRIPTIONS_KEY });
      void qc.invalidateQueries({ queryKey: VMWARE_SUBSCRIPTIONS_KEY });
      toast.success(
        status === 'active'
          ? 'Plan activated. The client was notified.'
          : status === 'rejected'
            ? 'Request rejected. The client was notified.'
            : 'Plan cancelled. The client was notified.',
      );
    },
    onError: (err: Error) => toast.error('Could not update the request', { description: err.message }),
  });
}
