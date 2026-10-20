import { useSessionReady } from '@/hooks/useSessionReady';
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isHardRequiredField } from '@/lib/consultantLocation';

export type FieldMode = 'required' | 'optional' | 'hidden';

export interface ProfileFieldRule {
  field_key: string;
  section: string;
  label: string;
  mode: FieldMode;
  default_mode: FieldMode;
  sort_order: number;
  /** Always required (Fix K: country and city), whatever the mode or the enforcement switch. */
  hard_required?: boolean;
}

export const PROFILE_FIELD_RULES_KEY = ['profile-field-rules'] as const;
export const PROFILE_RULES_CONFIG_KEY = ['profile-rules-config'] as const;
export const MY_MISSING_FIELDS_KEY = ['my-missing-profile-fields'] as const;

export async function fetchProfileFieldRules(): Promise<ProfileFieldRule[]> {
  const { data, error } = await (supabase as any)
    .from('profile_field_rules')
    // '*' so the optional hard_required column is read once the prepared SQL adds it, without breaking before.
    .select('*')
    .order('sort_order');
  if (error) throw error;
  return ((data || []) as ProfileFieldRule[]).map(r => ({
    field_key: r.field_key, section: r.section, label: r.label, mode: r.mode, default_mode: r.default_mode, sort_order: r.sort_order,
    hard_required: r.hard_required === true || isHardRequiredField(r.field_key),
  }));
}

/** The admin-chosen mode of every profile field. Unknown or not-yet-loaded fields count as optional (shown, not required). */
export function useProfileFieldRules() {
  const signedIn = useSessionReady().signedIn;
  const query = useQuery({
    enabled: signedIn,
    queryKey: PROFILE_FIELD_RULES_KEY,
    queryFn: fetchProfileFieldRules,
    staleTime: 5 * 60 * 1000,
  });
  const rules = query.data;
  const modes = useMemo(() => new Map<string, FieldMode>((rules || []).map(r => [r.field_key, r.mode])), [rules]);
  const labels = useMemo(() => new Map<string, string>((rules || []).map(r => [r.field_key, r.label])), [rules]);
  const hard = useMemo(() => new Set<string>([...(rules || []).filter(r => r.hard_required).map(r => r.field_key)]), [rules]);
  // Hard-required fields are always shown and required, even before the rules load and whatever an admin chose.
  const isHardRequired = useCallback((key: string) => isHardRequiredField(key) || hard.has(key), [hard]);
  const isRequired = useCallback((key: string) => isHardRequired(key) || modes.get(key) === 'required', [modes, isHardRequired]);
  const isHidden = useCallback((key: string) => !isHardRequired(key) && modes.get(key) === 'hidden', [modes, isHardRequired]);
  const isVisible = useCallback((key: string) => isHardRequired(key) || modes.get(key) !== 'hidden', [modes, isHardRequired]);
  return { rules: rules || [], modes, labels, isRequired, isHardRequired, isHidden, isVisible, isLoading: query.isLoading };
}

/** The enforcement switch (hide incomplete profiles and block their new bids). */
export function useProfileRulesConfig() {
  const signedIn2 = useSessionReady().signedIn;
  return useQuery({
    enabled: signedIn2,
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
  const signedIn3 = useSessionReady().signedIn;
  return useQuery({
    enabled: signedIn3,
    queryKey: MY_MISSING_FIELDS_KEY,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any).rpc('my_missing_profile_fields');
      if (error) throw error;
      return Array.isArray(data) ? (data as string[]) : [];
    },
    staleTime: 60 * 1000,
  });
}
