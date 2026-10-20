import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { startBlockReason, type StartBlockCode } from '@/lib/interviewStart';

export const INTERVIEW_ELIGIBILITY_KEY = ['interview-eligibility'] as const;

export interface InterviewEligibility {
  consultantId: string | null;
  displayName: string;
  hasSapRole: boolean;
  interviewDone: boolean;
}

/** What the signed-in consultant needs before the AI interview can start, with a visible reason when something is missing. */
export function useInterviewEligibility(): { block: StartBlockCode | null; data: InterviewEligibility | null; isError: boolean; refetch: () => void } {
  const { ready, signedIn } = useSessionReady();
  const q = useQuery({
    queryKey: INTERVIEW_ELIGIBILITY_KEY,
    enabled: signedIn,
    queryFn: async (): Promise<InterviewEligibility> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { consultantId: null, displayName: '', hasSapRole: false, interviewDone: false };
      const [{ data: c, error }, { data: p }] = await Promise.all([
        (supabase as any).from('consultants').select('id, sap_role, sap_roles, ai_interview_completed_at').eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
      ]);
      if (error) throw error;
      if (!c) return { consultantId: null, displayName: p?.display_name || '', hasSapRole: false, interviewDone: false };
      let hasSapRole = (Array.isArray(c.sap_roles) && c.sap_roles.length > 0) || !!(c.sap_role && String(c.sap_role).trim());
      if (!hasSapRole) {
        const { count } = await supabase.from('consultant_skills').select('id', { count: 'exact', head: true }).eq('consultant_id', c.id);
        hasSapRole = (count ?? 0) > 0;
      }
      return { consultantId: c.id, displayName: p?.display_name || '', hasSapRole, interviewDone: !!c.ai_interview_completed_at };
    },
  });
  const data = q.data ?? null;
  // A failed eligibility read never blocks: starting reports its own, actionable error.
  const block = !ready ? 'checking' : !signedIn ? 'signed_out' : q.isLoading ? 'checking' : q.isError || !data ? null
    : startBlockReason({ ready, signedIn, consultantId: data.consultantId, displayName: data.displayName, hasSapRole: data.hasSapRole });
  return { block, data, isError: q.isError, refetch: () => void q.refetch() };
}
