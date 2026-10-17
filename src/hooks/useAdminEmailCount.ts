import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useAdminEmailCount() {
  return useQuery({
    queryKey: ['admin-email-count'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_notification_email_count');
      if (error) throw error;
      return Number(data);
    },
  });
}