import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
export function useAdminEmailCount() {
  return useQuery({
    queryKey: ['admin-email-count'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_notification_email_count' as never);
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}