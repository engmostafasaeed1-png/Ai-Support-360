import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';

export function useConsultantWorkDiary(dateRange?: { from: string; to: string }) {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['work-diary', dateRange],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: consultant } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) return [];

      let query = supabase
        .from('work_diary_entries')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('start_time', { ascending: false });

      if (dateRange?.from) query = query.gte('start_time', dateRange.from);
      if (dateRange?.to) query = query.lte('start_time', dateRange.to);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockDiaryEntries as any : undefined,
  });
}

export function useCreateDiaryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { session_id?: string; start_time: string; end_time: string; memo: string; activity_level?: number; is_manual?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: consultant } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) throw new Error('No consultant profile');

      const { error } = await supabase.from('work_diary_entries').insert({
        ...payload,
        consultant_id: consultant.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-diary'] });
    },
  });
}

const mockDiaryEntries = [
  { id: '1', session_id: 's1', start_time: '2026-04-06T09:00:00Z', end_time: '2026-04-06T10:30:00Z', memo: 'GL account reconciliation analysis', activity_level: 87, is_manual: false, screenshot_url: null },
  { id: '2', session_id: 's1', start_time: '2026-04-06T10:30:00Z', end_time: '2026-04-06T12:00:00Z', memo: 'Implemented fix for posting date validation', activity_level: 92, is_manual: false, screenshot_url: null },
  { id: '3', session_id: null, start_time: '2026-04-06T13:00:00Z', end_time: '2026-04-06T14:00:00Z', memo: 'Research on S/4HANA migration best practices', activity_level: 0, is_manual: true, screenshot_url: null },
  { id: '4', session_id: 's2', start_time: '2026-04-05T09:00:00Z', end_time: '2026-04-05T11:00:00Z', memo: 'SD pricing configuration review', activity_level: 78, is_manual: false, screenshot_url: null },
  { id: '5', session_id: 's2', start_time: '2026-04-05T14:00:00Z', end_time: '2026-04-05T16:30:00Z', memo: 'Testing pricing procedures in QA system', activity_level: 95, is_manual: false, screenshot_url: null },
];
