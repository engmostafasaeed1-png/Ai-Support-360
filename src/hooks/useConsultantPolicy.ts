import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { DRAFT_POLICY_V1, policyState, type PolicyLang, type PolicyStatus, type PolicyVersion } from '@/lib/consultantPolicy';

export const POLICY_VERSION_KEY = ['consultant-policy-version'] as const;
export const MY_POLICY_KEY = ['my-consultant-policy'] as const;

export interface LoadedPolicy {
  policy: PolicyVersion;
  /** False while docs/sql/consultant-policy.sql is not applied: the bundled draft is shown and nothing can be accepted. */
  ready: boolean;
}

interface VersionRow {
  version: number; effective_at: string;
  title_en: string; title_ar: string; summary_en: string; summary_ar: string; body_en: string; body_ar: string;
}

export function toPolicyVersion(r: VersionRow): PolicyVersion {
  return {
    version: r.version,
    effectiveAt: r.effective_at,
    en: { title: r.title_en, summary: r.summary_en, body: r.body_en },
    ar: { title: r.title_ar, summary: r.summary_ar, body: r.body_ar },
  };
}

const COLUMNS = 'version, effective_at, title_en, title_ar, summary_en, summary_ar, body_en, body_ar';

/** The current (or a given) published version; readable without signing in. */
export async function fetchPolicy(version?: number | null): Promise<LoadedPolicy> {
  let q = (supabase as any).from('consultant_policy_versions').select(COLUMNS);
  q = version ? q.eq('version', version) : q.lte('effective_at', new Date().toISOString()).order('version', { ascending: false }).limit(1);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return { policy: DRAFT_POLICY_V1, ready: false };
  return { policy: toPolicyVersion(data as VersionRow), ready: true };
}

export function usePolicyVersion(version?: number | null) {
  return useQuery({ queryKey: [...POLICY_VERSION_KEY, version ?? 'current'], queryFn: () => fetchPolicy(version), staleTime: 5 * 60_000 });
}

export interface MyPolicyRaw {
  state?: string;
  current_version: number | null;
  effective_at: string | null;
  accepted_version: number | null;
  accepted_at: string | null;
  first_shown_at: string | null;
  grace_days: number | null;
  consultant_id: string;
  signed_up_at: string | null;
}

export interface MyPolicy {
  /** False before the database update is applied, or while loading. */
  ready: boolean;
  isConsultant: boolean;
  raw: MyPolicyRaw | null;
  status: PolicyStatus;
}

/** The signed-in consultant's acknowledgement status, plus "shown" and "accept" actions. */
export function useMyPolicy() {
  const { signedIn } = useSessionReady();
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: MY_POLICY_KEY,
    enabled: signedIn && !isGuest,
    staleTime: 60_000,
    queryFn: async (): Promise<{ ready: boolean; raw: MyPolicyRaw | null }> => {
      const { data, error } = await (supabase as any).rpc('my_consultant_policy_status');
      if (error) return { ready: false, raw: null };
      return { ready: true, raw: (data as MyPolicyRaw | null) ?? null };
    },
  });
  const raw = q.data?.raw ?? null;
  const ready = q.data?.ready === true;
  const status: PolicyStatus = ready && raw
    ? policyState({ currentVersion: raw.current_version, acceptedVersion: raw.accepted_version, firstShownAt: raw.first_shown_at, graceDays: raw.grace_days, now: Date.now() })
    : { state: 'none', deadline: null, canSnooze: false };

  const markShown = async (version: number) => {
    const { data, error } = await (supabase as any).rpc('consultant_policy_mark_shown', { _version: version });
    if (!error && data) qc.setQueryData(MY_POLICY_KEY, { ready: true, raw: data as MyPolicyRaw });
  };

  const accept = useMutation({
    mutationFn: async ({ version, lang, source }: { version: number; lang: PolicyLang; source: 'registration' | 'popup' | 'banner' | 'page' }) => {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 400) : null;
      const { data, error } = await (supabase as any).rpc('accept_consultant_policy', { _version: version, _language: lang, _source: source, _user_agent: ua });
      if (error) throw error;
      return data as { version: number; accepted_at: string };
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: MY_POLICY_KEY }),
      qc.invalidateQueries({ queryKey: ['hidden-consultants'] }),
    ]),
  });

  return { loading: q.isLoading, ready, isConsultant: !!raw?.consultant_id, raw, status, markShown, accept };
}
