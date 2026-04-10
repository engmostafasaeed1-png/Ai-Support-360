import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ClientProfile {
  id: string;
  user_id: string;
  company_name: string | null;
  company_size: string | null;
  industry: string | null;
  company_logo_url: string | null;
  company_website: string | null;
  company_description: string | null;
  headquarters: string | null;
  sap_landscape: string | null;
  sap_modules: string[];
  sap_system_ids: string[];
  sap_hosting_type: string | null;
  sap_module_versions: Record<string, string>;
  key_contacts: Array<{ name: string; role: string; email: string; phone?: string }>;
  phone: string | null;
  timezone: string | null;
  preferred_language: string | null;
  communication_preference: string | null;
  onboarding_completed: boolean;
  sap_product: string | null;
  sap_version: string | null;
  sap_database_type: string | null;
  sap_os_type: string | null;
  sap_support_pack: string | null;
  sap_go_live_date: string | null;
  sap_user_count: number | null;
  sap_custom_dev_count: number | null;
  sap_interfaces: string[] | null;
  sap_third_party_tools: string[] | null;
  sap_landscape_notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useClientProfileData() {
  return useQuery({
    queryKey: ['client-profile-full'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('client_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        sap_modules: data.sap_modules || [],
        sap_system_ids: data.sap_system_ids || [],
        sap_module_versions: (data.sap_module_versions || {}) as Record<string, string>,
        key_contacts: (data.key_contacts || []) as ClientProfile['key_contacts'],
        sap_interfaces: data.sap_interfaces || [],
        sap_third_party_tools: data.sap_third_party_tools || [],
        onboarding_completed: data.onboarding_completed ?? false,
      } as ClientProfile;
    },
  });
}

export function useUpdateClientProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<ClientProfile>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      
      // Remove read-only fields
      const { id, user_id, created_at, updated_at, ...payload } = updates as any;
      
      const { error, count } = await supabase
        .from('client_profiles')
        .update(payload)
        .eq('user_id', session.user.id)
        .select('id');
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-profile-full'] });
      toast.success('Company profile updated');
    },
    onError: (err: any) => toast.error('Update failed', { description: err.message }),
  });
}
