import { useSessionReady } from '@/hooks/useSessionReady';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockConsultantProfile } from '@/data/consultantMockData';

export function useConsultantProfile() {
  const { isGuest } = useGuestMode();

  const signedIn = useSessionReady().signedIn;
  return useQuery({
    queryKey: ['consultant-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id, bio, hourly_rate, currency, timezone, languages, industries, verification_status, rating, total_reviews, response_time_minutes, availability_status, ai_skills_score, credibility_credits, ai_interview_badge, ai_interview_completed_at')
        .eq('user_id', user.id)
        .maybeSingle();

      // The links are no longer readable on consultants: they come from the view of contact links (own row).
      const { data: links } = consultant
        ? await (supabase as any)
          .from('consultant_contact_links')
          .select('credly_username')
          .eq('consultant_id', consultant.id)
          .maybeSingle()
        : { data: null };

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
        credly_username: (links?.credly_username as string | null | undefined) ?? null,
        credibility_credits: (consultant as any).credibility_credits || 0,
        ai_interview_badge: (consultant as any).ai_interview_badge || null,
        ai_interview_completed_at: (consultant as any).ai_interview_completed_at || null,
      };
    },
    enabled: signedIn && (!isGuest),
    placeholderData: isGuest ? { ...mockConsultantProfile, avatar_url: null, credly_username: null, credibility_credits: 250, ai_interview_badge: 'Gold', ai_interview_completed_at: new Date().toISOString() } : undefined,
  });
}
