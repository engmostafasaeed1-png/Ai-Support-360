import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type NdaPendingItem = {
  kind: 'share' | 'environment';
  ref_id: string;
  client_id: string;
  client_name: string;
  detail: string;
  since: string;
  /** The consultant signed already; the client has to countersign before the access opens. */
  waiting_for_client?: boolean;
};

/** What waits for the signed-in consultant's NDA (no host, IP, ID or environment name is returned before the NDA). */
export function useNdaPendingAccess() {
  return useQuery({
    queryKey: ['nda-pending-access'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_nda_pending_access');
      if (error) throw error;
      return (data ?? []) as NdaPendingItem[];
    },
  });
}

/** The consultants (ids) who have an active NDA with the signed-in client. */
export function useClientNdaConsultantIds() {
  return useQuery({
    queryKey: ['client-nda-consultant-ids'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return new Set<string>();
      const { data, error } = await supabase
        .from('nda_agreements')
        .select('consultant_id')
        .eq('client_id', user.id)
        .is('revoked_at', null);
      if (error) throw error;
      return new Set((data ?? []).map((n) => n.consultant_id as string));
    },
  });
}
