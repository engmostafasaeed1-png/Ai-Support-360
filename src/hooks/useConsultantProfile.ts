import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockConsultantProfile } from '@/data/consultantMockData';

export function useConsultantProfile() {
  const { isGuest } = useGuestMode();

  return useQuery({
    queryKey: ['consultant-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!consultant) return null;

      const displayName = profile?.display_name || user.email?.split('@')[0] || 'Consultant';
      const initials = displayName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

      return {
        id: consultant.id,
        user_id: user.id,
        display_name: displayName,
        avatar: initials,
        avatar_url: profile?.avatar_url,
        bio: consultant.bio || '',
        hourly_rate: Number(consultant.hourly_rate) || 0,
        currency: consultant.currency || 'USD',
        timezone: consultant.timezone || 'Asia/Riyadh',
        languages: consultant.languages || ['en'],
        industries: consultant.industries || [],
        verification_status: consultant.verification_status || 'pending',
        rating: Number(consultant.rating) || 0,
        total_reviews: consultant.total_reviews || 0,
        response_time_minutes: consultant.response_time_minutes || 0,
        availability_status: consultant.availability_status || 'offline',
        ai_skills_score: Number(consultant.ai_skills_score) || 0,
        credly_username: consultant.credly_username,
      };
    },
    enabled: !isGuest,
    placeholderData: isGuest ? { ...mockConsultantProfile, avatar_url: null, credly_username: null } : undefined,
  });
}
