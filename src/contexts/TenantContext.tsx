import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  subscription_tier: 'basic' | 'professional' | 'enterprise';
  subscription_status: string;
  max_users: number;
  max_tickets_per_month: number;
  max_sessions_per_month: number;
  ai_quota: number;
}

interface TenantMember {
  tenant_id: string;
  org_role: 'owner' | 'admin' | 'manager' | 'member';
}

interface TenantContextType {
  tenant: Tenant | null;
  membership: TenantMember | null;
  loading: boolean;
  isOwnerOrAdmin: boolean;
  hasTenant: boolean;
  refetch: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType>({
  tenant: null,
  membership: null,
  loading: true,
  isOwnerOrAdmin: false,
  hasTenant: false,
  refetch: async () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [membership, setMembership] = useState<TenantMember | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTenant = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setTenant(null);
        setMembership(null);
        setLoading(false);
        return;
      }

      // Get the user's tenant membership
      const { data: memberData } = await supabase
        .from('tenant_members')
        .select('tenant_id, org_role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!memberData) {
        setTenant(null);
        setMembership(null);
        setLoading(false);
        return;
      }

      setMembership({
        tenant_id: memberData.tenant_id,
        org_role: memberData.org_role as TenantMember['org_role'],
      });

      // Get tenant details
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', memberData.tenant_id)
        .single();

      if (tenantData) {
        setTenant({
          id: tenantData.id,
          name: tenantData.name,
          slug: tenantData.slug,
          logo_url: tenantData.logo_url,
          subscription_tier: tenantData.subscription_tier as Tenant['subscription_tier'],
          subscription_status: tenantData.subscription_status,
          max_users: tenantData.max_users,
          max_tickets_per_month: tenantData.max_tickets_per_month,
          max_sessions_per_month: tenantData.max_sessions_per_month,
          ai_quota: tenantData.ai_quota,
        });
      }
    } catch (err) {
      console.error('Error fetching tenant:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenant();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchTenant();
    });

    return () => subscription.unsubscribe();
  }, []);

  const isOwnerOrAdmin = membership?.org_role === 'owner' || membership?.org_role === 'admin';

  return (
    <TenantContext.Provider value={{
      tenant,
      membership,
      loading,
      isOwnerOrAdmin,
      hasTenant: !!tenant,
      refetch: fetchTenant,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
