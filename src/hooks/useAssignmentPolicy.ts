import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { POLICY_DEFAULTS, readPolicyMinutes, type PolicyMinutes } from '../../supabase/functions/_shared/assignmentPolicy';

type RpcResult = { data: unknown; error: { message: string } | null };
// Called as a method: supabase.rpc reads `this`, so a detached reference throws.
const rpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<RpcResult> }).rpc(fn, args);

/** Current reminder timings (admin setting); the owner's defaults until docs/sql/assignment-response.sql is applied. */
export function useAssignmentPolicy(): PolicyMinutes {
  const { signedIn } = useSessionReady();
  const q = useQuery({
    queryKey: ['assignment-policy-minutes'],
    queryFn: async () => {
      const { data, error } = await rpc('assignment_policy_minutes');
      return error ? POLICY_DEFAULTS : readPolicyMinutes(data);
    },
    enabled: signedIn,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return q.data ?? POLICY_DEFAULTS;
}

/** "Wait longer" after No response (once per request). */
export async function extendAssignmentRequest(requestId: string): Promise<void> {
  const { error } = await rpc('client_extend_assignment_request', { _request_id: requestId });
  if (error) throw new Error(error.message);
}
