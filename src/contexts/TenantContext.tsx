import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_at: string | null;
  industry: string | null;
  company_size: string | null;
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
  created_at: string | null;
}

interface TenantContextType {
  tenant: Tenant | null;
  membership: TenantMember | null;
  tenants: Tenant[];
  memberships: TenantMember[];
  loading: boolean;
  isOwnerOrAdmin: boolean;
  hasTenant: boolean;
  hasMultipleTenants: boolean;
  /** the company that the client profile of the account belongs to: the first one the user joined or created */
  mainTenantId: string | null;
  isMainCompany: boolean;
  switchTenant: (tenantId: string) => void;
  refetch: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType>({
  tenant: null,
  membership: null,
  tenants: [],
  memberships: [],
  loading: true,
  isOwnerOrAdmin: false,
  hasTenant: false,
  hasMultipleTenants: false,
  mainTenantId: null,
  isMainCompany: true,
  switchTenant: () => {},
  refetch: async () => {},
});

const ACTIVE_TENANT_KEY = 'qurtuba_active_tenant';

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [memberships, setMemberships] = useState<TenantMember[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_TENANT_KEY)
  );
  const [loading, setLoading] = useState(true);

  const fetchTenants = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setTenants([]);
        setMemberships([]);
        setActiveTenantId(null);
        setLoading(false);
        return;
      }

      // Get all tenant memberships
      const { data: memberData } = await supabase
        .from('tenant_members')
        .select('tenant_id, org_role, created_at')
        .eq('user_id', user.id);

      if (!memberData || memberData.length === 0) {
        setTenants([]);
        setMemberships([]);
        setActiveTenantId(null);
        setLoading(false);
        return;
      }

      const mems = memberData.map(m => ({
        tenant_id: m.tenant_id,
        org_role: m.org_role as TenantMember['org_role'],
        created_at: (m as { created_at?: string | null }).created_at ?? null,
      }));
      setMemberships(mems);

      const tenantIds = memberData.map(m => m.tenant_id);
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('*')
        .in('id', tenantIds);

      if (tenantData) {
        const parsed = tenantData.map((t: any) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          logo_url: t.logo_url,
          created_at: t.created_at ?? null,
          industry: t.industry ?? null,
          company_size: t.company_size ?? null,
          subscription_tier: t.subscription_tier as Tenant['subscription_tier'],
          subscription_status: t.subscription_status,
          max_users: t.max_users,
          max_tickets_per_month: t.max_tickets_per_month,
          max_sessions_per_month: t.max_sessions_per_month,
          ai_quota: t.ai_quota,
        }));
        setTenants(parsed);

        // Auto-select tenant
        const stored = localStorage.getItem(ACTIVE_TENANT_KEY);
        if (stored && parsed.some(t => t.id === stored)) {
          setActiveTenantId(stored);
        } else if (parsed.length === 1) {
          setActiveTenantId(parsed[0].id);
          localStorage.setItem(ACTIVE_TENANT_KEY, parsed[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching tenants:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchTenants();
    });
    return () => subscription.unsubscribe();
  }, [fetchTenants]);

  const switchTenant = useCallback((tenantId: string) => {
    setActiveTenantId(tenantId);
    localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
  }, []);

  const tenant = tenants.find(t => t.id === activeTenantId) ?? null;
  const membership = memberships.find(m => m.tenant_id === activeTenantId) ?? null;
  const isOwnerOrAdmin = membership?.org_role === 'owner' || membership?.org_role === 'admin';
  const mainTenantId = [...memberships].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))[0]?.tenant_id ?? null;
  const isMainCompany = !tenant || !mainTenantId || tenant.id === mainTenantId;

  return (
    <TenantContext.Provider value={{
      tenant,
      membership,
      tenants,
      memberships,
      loading,
      isOwnerOrAdmin,
      hasTenant: !!tenant,
      hasMultipleTenants: tenants.length > 1,
      mainTenantId,
      isMainCompany,
      switchTenant,
      refetch: fetchTenants,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
