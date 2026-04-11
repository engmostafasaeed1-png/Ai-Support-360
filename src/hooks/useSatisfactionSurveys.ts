import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SatisfactionSurvey {
  id: string;
  rated_by: string;
  rated_user: string;
  ticket_id?: string | null;
  session_id?: string | null;
  role: 'client' | 'consultant';
  communication_score?: number | null;
  technical_quality_score?: number | null;
  timeliness_score?: number | null;
  professionalism_score?: number | null;
  overall_score?: number | null;
  comment?: string | null;
  status: 'pending' | 'completed' | 'expired';
  requested_by?: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  rated_user_name?: string;
  rated_by_name?: string;
}

export function useSatisfactionSurveys() {
  const queryClient = useQueryClient();

  const { data: surveys, isLoading } = useQuery({
    queryKey: ['satisfaction-surveys'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await (supabase.from('satisfaction_surveys') as any)
        .select('*')
        .or(`rated_by.eq.${user.id},rated_user.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch profile names
      const userIds = [...new Set((data || []).flatMap((s: any) => [s.rated_by, s.rated_user]))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'User']));
        }
      }

      return (data || []).map((s: any) => ({
        ...s,
        rated_user_name: profileMap[s.rated_user] || 'User',
        rated_by_name: profileMap[s.rated_by] || 'User',
      })) as SatisfactionSurvey[];
    },
  });

  const requestSurvey = useMutation({
    mutationFn: async (params: {
      ratedBy: string;
      ratedUser: string;
      role: 'client' | 'consultant';
      ticketId?: string;
      sessionId?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase.from('satisfaction_surveys') as any).insert({
        rated_by: params.ratedBy,
        rated_user: params.ratedUser,
        role: params.role,
        ticket_id: params.ticketId || null,
        session_id: params.sessionId || null,
        requested_by: user.id,
        status: 'pending',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Satisfaction survey requested!');
      queryClient.invalidateQueries({ queryKey: ['satisfaction-surveys'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to request survey'),
  });

  const submitSurvey = useMutation({
    mutationFn: async (params: {
      surveyId: string;
      communication: number;
      technicalQuality: number;
      timeliness: number;
      professionalism: number;
      overall: number;
      comment?: string;
    }) => {
      const { error } = await (supabase.from('satisfaction_surveys') as any)
        .update({
          communication_score: params.communication,
          technical_quality_score: params.technicalQuality,
          timeliness_score: params.timeliness,
          professionalism_score: params.professionalism,
          overall_score: params.overall,
          comment: params.comment?.trim() || null,
          status: 'completed',
        })
        .eq('id', params.surveyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Survey submitted! Thank you for your feedback.');
      queryClient.invalidateQueries({ queryKey: ['satisfaction-surveys'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to submit survey'),
  });

  return { surveys: surveys || [], isLoading, requestSurvey, submitSurvey };
}
