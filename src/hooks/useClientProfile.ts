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
  onboarding_completed: boolean;
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
      return data as ClientProfile | null;
    },
  });
}

export function useUpdateClientProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<ClientProfile>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('client_profiles')
        .update(updates as any)
        .eq('user_id', session.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-profile-full'] });
      toast.success('Company profile updated');
    },
    onError: (err: any) => toast.error('Update failed', { description: err.message }),
  });
}
