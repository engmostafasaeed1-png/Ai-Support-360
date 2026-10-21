import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useProfileFieldRules, MY_MISSING_FIELDS_KEY } from '@/hooks/useProfileFieldRules';
import { buildChecklist, parseMissingRequired, POLICY_ITEM, submissionState, type Checklist, type SubmissionState } from '@/lib/profileSubmission';

export const MY_PROFILE_SUBMISSION_KEY = ['my-profile-submission'] as const;

interface Raw { submitted_at: string | null; verification_status: string | null; missing: string[]; required_total: number }

/**
 * The consultant's mandatory-items gate (Feature V). The server decides what is missing; this hook refreshes it
 * whenever any other profile data finishes saving or reloading, so items disappear without a page reload.
 */
export function useProfileSubmission() {
  const { t } = useTranslation();
  const { signedIn } = useSessionReady();
  const qc = useQueryClient();
  const rules = useProfileFieldRules();
  const query = useQuery({
    queryKey: MY_PROFILE_SUBMISSION_KEY,
    enabled: signedIn,
    staleTime: 15_000,
    queryFn: async (): Promise<Raw | null> => {
      const { data, error } = await (supabase.rpc as any)('my_profile_submission');
      if (error) throw error;
      return (data ?? null) as Raw | null;
    },
  });

  // Live: any saved section (query refetch or mutation) refreshes the list shortly after.
  const timer = useRef<number>();
  useEffect(() => {
    const kick = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: MY_PROFILE_SUBMISSION_KEY });
        void qc.invalidateQueries({ queryKey: MY_MISSING_FIELDS_KEY });
      }, 600);
    };
    const own = (key: readonly unknown[]) => key[0] === MY_PROFILE_SUBMISSION_KEY[0] || key[0] === MY_MISSING_FIELDS_KEY[0];
    const unQ = qc.getQueryCache().subscribe((e: any) => {
      if (e?.type === 'updated' && e.action?.type === 'success' && !own(e.query.queryKey)) kick();
    });
    const unM = qc.getMutationCache().subscribe((e: any) => {
      if (e?.type === 'updated' && e.action?.type === 'success') kick();
    });
    const onSaved = () => kick();
    window.addEventListener('profile-section-saved', onSaved);
    return () => { unQ(); unM(); window.removeEventListener('profile-section-saved', onSaved); window.clearTimeout(timer.current); };
  }, [qc]);

  const labelOf = (key: string) => key === POLICY_ITEM
    ? String(t('profileSubmit.policy_item', { defaultValue: 'Accept the Consultant Service Policy' }))
    : String(t(`profileSubmit.field.${key}`, { defaultValue: rules.labels.get(key) ?? key.replace(/_/g, ' ') }));
  const sectionLabelOf = (s: { key: string; label: string }) => String(t(`profileSubmit.section.${s.key}`, { defaultValue: s.label }));

  const raw = query.data;
  const checklist: Checklist | null = useMemo(
    () => (raw ? buildChecklist(raw.missing ?? [], raw.required_total ?? 0, labelOf, sectionLabelOf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, rules.labels, t],
  );
  const state: SubmissionState = submissionState(raw?.submitted_at, raw?.verification_status);

  const submit = useMutation({
    mutationFn: async (): Promise<{ ok: true } | { ok: false; missing: string[] | null; message: string }> => {
      const { error } = await (supabase.rpc as any)('submit_consultant_profile');
      if (error) return { ok: false, missing: parseMissingRequired(error.message), message: error.message };
      return { ok: true };
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: MY_PROFILE_SUBMISSION_KEY }); void qc.invalidateQueries({ queryKey: ['consultant-profile'] }); },
  });

  return { loading: query.isLoading, available: !query.isError, checklist, state, submittedAt: raw?.submitted_at ?? null, submit, refetch: query.refetch };
}
