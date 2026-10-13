import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type FieldMode = 'required' | 'optional' | 'hidden';

export interface ProfileFieldRule {
  field_key: string;
  section: string;
  label: string;
  mode: FieldMode;
  default_mode: FieldMode;
  sort_order: number;
}

export const PROFILE_FIELD_RULES_KEY = ['profile-field-rules'] as const;
export const PROFILE_RULES_CONFIG_KEY = ['profile-rules-config'] as const;
export const MY_MISSING_FIELDS_KEY = ['my-missing-profile-fields'] as const;

export async function fetchProfileFieldRules(): Promise<ProfileFieldRule[]> {
  const { data, error } = await (supabase as any)
    .from('profile_field_rules')
    .select('field_key, section, label, mode, default_mode, sort_order')
    .order('sort_order');
  if (error) throw error;
  return (data || []) as ProfileFieldRule[];
}

/** The admin-chosen mode of every profile field. Unknown or not-yet-loaded fields count as optional (shown, not required). */
export function useProfileFieldRules() {
  const query = useQuery({
    queryKey: PROFILE_FIELD_RULES_KEY,
    queryFn: fetchProfileFieldRules,
    staleTime: 5 * 60 * 1000,
  });
  const rules = query.data;
  const modes = useMemo(() => new Map<string, FieldMode>((rules || []).map(r => [r.field_key, r.mode])), [rules]);
  const labels = useMemo(() => new Map<string, string>((rules || []).map(r => [r.field_key, r.label])), [rules]);
  const isRequired = useCallback((key: string) => modes.get(key) === 'required', [modes]);
  const isHidden = useCallback((key: string) => modes.get(key) === 'hidden', [modes]);
  const isVisible = useCallback((key: string) => modes.get(key) !== 'hidden', [modes]);
  return { rules: rules || [], modes, labels, isRequired, isHidden, isVisible, isLoading: query.isLoading };
}

/** The enforcement switch (hide incomplete profiles and block their new bids). */
export function useProfileRulesConfig() {
  return useQuery({
    queryKey: PROFILE_RULES_CONFIG_KEY,
    queryFn: async (): Promise<{ enforce: boolean }> => {
      const { data, error } = await (supabase as any).from('profile_rules_config').select('enforce').maybeSingle();
      if (error) throw error;
      return { enforce: !!data?.enforce };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** The required field keys that the signed-in consultant still lacks. */
export function useMyMissingFields() {
  return useQuery({
    queryKey: MY_MISSING_FIELDS_KEY,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any).rpc('my_missing_profile_fields');
      if (error) throw error;
      return Array.isArray(data) ? (data as string[]) : [];
    },
    staleTime: 60 * 1000,
  });
}
