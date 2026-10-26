import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_ROLE_CATALOG, type RoleEntry, type RoleSettings } from '@/lib/consultantRoles';

export const ROLE_CATALOG_KEY = ['consultant-role-catalog'] as const;

/**
 * The admin-editable role catalogue (docs/sql/consultant-roles.sql). Until that file is applied the built-in copy is used
 * and `applied` is false, so screens only write values the database already accepts.
 */
export function useRoleCatalog() {
  const q = useQuery({
    queryKey: ROLE_CATALOG_KEY,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<{ catalog: RoleEntry[]; applied: boolean }> => {
      const { data, error } = await (supabase as any).from('consultant_role_catalog').select('key, label_en, label_ar, category, enabled, sort, legacy_labels').order('sort');
      if (error || !Array.isArray(data) || data.length === 0) return { catalog: DEFAULT_ROLE_CATALOG, applied: false };
      return { catalog: data as RoleEntry[], applied: true };
    },
  });
  const catalog = q.data?.catalog ?? DEFAULT_ROLE_CATALOG;
  return { catalog, enabled: catalog.filter((r) => r.enabled), applied: q.data?.applied === true, isLoading: q.isLoading };
}

/** Optional admin settings (suggested rate ranges per category); empty until set. */
export function useRoleSettings() {
  return useQuery({
    queryKey: ['consultant-role-settings'],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<RoleSettings> => {
      const { data, error } = await (supabase as any).from('platform_settings').select('value').eq('key', 'consultant_roles').maybeSingle();
      if (error || !data?.value || typeof data.value !== 'object') return {};
      return data.value as RoleSettings;
    },
  });
}

/** The signed-in consultant's own stored roles (for role-aware required fields); null for everyone else. */
export const MY_ROLES_KEY = ['my-consultant-roles'] as const;
export function useMyConsultantRoles(enabled = true) {
  return useQuery({
    queryKey: MY_ROLES_KEY,
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[] | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase.from('consultants').select('sap_role, sap_roles').eq('user_id', auth.user.id).maybeSingle();
      if (!data) return null;
      const roles = (data.sap_roles ?? []).filter(Boolean);
      return roles.length ? roles : data.sap_role ? [data.sap_role] : [];
    },
  });
}
