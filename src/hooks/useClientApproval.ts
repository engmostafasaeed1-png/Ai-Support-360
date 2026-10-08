import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import type { ClientApproval } from '@/lib/clientApproval';

export const CLIENT_APPROVAL_KEY = ['client-approval'] as const;

/** The signed-in client's approval state (null for users without a client profile). Administrators are never blocked. */
export function useClientApproval() {
  const isAdmin = useIsAdmin();
  return useQuery({
    queryKey: CLIENT_APPROVAL_KEY,
    queryFn: async (): Promise<ClientApproval | null> => {
      const { data, error } = await supabase.rpc('my_client_approval');
      if (error) throw error;
      return (data as unknown as ClientApproval | null) ?? null;
    },
    select: (d) => (d && isAdmin ? { ...d, required: false } : d),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // while an administrator is deciding, look again once a minute so the page changes without a reload
    refetchInterval: (query) => (query.state.data?.status === 'awaiting_confirmation' ? 60_000 : false),
    retry: 1,
  });
}

export function useResubmitForApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (message: string) => {
      const note = message.trim();
      const { error } = await supabase.rpc('client_resubmit_for_approval', note ? { p_message: note } : {});
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CLIENT_APPROVAL_KEY });
      toast.success('Sent again. An administrator will review it.');
    },
    onError: (e: Error) => toast.error('Could not send it again', { description: e.message }),
  });
}
