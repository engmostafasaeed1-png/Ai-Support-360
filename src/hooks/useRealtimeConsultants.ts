import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockRecommendedConsultants } from '@/data/clientMockData';
import { useHiddenConsultantIds, withoutHidden } from '@/hooks/useHiddenConsultants';
import { toConsultantLive, formatWeeklyHours, type ConsultantLive, type WeeklySlot } from '@/lib/consultantDirectory';

export type { ConsultantLive } from '@/lib/consultantDirectory';

export function useRealtimeConsultants() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  // Subscribe to real-time changes
  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('consultants-availability')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'consultants' }, () => {
        queryClient.invalidateQueries({ queryKey: ['realtime-consultants'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, () => {
        queryClient.invalidateQueries({ queryKey: ['realtime-consultants'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isGuest, queryClient]);

  const hiddenIds = useHiddenConsultantIds(!isGuest);
  const { data: allConsultants = [], isLoading } = useQuery({
    queryKey: ['realtime-consultants'],
    queryFn: async (): Promise<ConsultantLive[]> => {
      // The consultants that the signed-in person may see (verified ones; an administrator sees all)
      const { data: consultantRows, error } = await supabase
        .from('consultants')
        .select('id, user_id, hourly_rate, industries, languages, verification_status, rating, total_reviews, response_time_minutes, availability_status, city, country, latitude, longitude, linkedin_checked_at, credly_checked_at, credibility_credits, ai_interview_badge, show_availability, customer_segments, vertical_solutions, localization_countries, localization_solutions, project_types, deployment_experience, project_scale, work_modes, working_week')
        .order('rating', { ascending: false });

      if (error) throw error;
      if (!consultantRows || consultantRows.length === 0) return [];

      // Get user profiles for names
      const userIds = consultantRows.map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);

      const profileMap = new Map(
        (profiles || []).map(p => [p.user_id, p])
      );

      // Get skills for all consultants
      const consultantIds = consultantRows.map(c => c.id);
      const { data: skills } = await supabase
        .from('consultant_skills')
        .select('consultant_id, sap_module, proficiency_level')
        .in('consultant_id', consultantIds);

      const skillsMap = new Map<string, string[]>();
      (skills || []).forEach(s => {
        const existing = skillsMap.get(s.consultant_id) || [];
        existing.push(s.sap_module);
        skillsMap.set(s.consultant_id, existing);
      });

      const { data: slotRows } = await supabase
        .from('availability_slots')
        .select('consultant_id, day_of_week, start_time, end_time')
        .in('consultant_id', consultantIds);
      const hoursMap = new Map<string, WeeklySlot[]>();
      (slotRows || []).forEach(s => {
        const list = hoursMap.get(s.consultant_id) || [];
        list.push(s as WeeklySlot);
        hoursMap.set(s.consultant_id, list);
      });

      // The place, the availability and the links come from the database as they are: nothing is invented here.
      // A consultant who switched "Show availability status" off appears as Offline, without weekly hours.
      return consultantRows.map(c => {
        const live = toConsultantLive(c, profileMap.get(c.user_id)?.display_name, skillsMap.get(c.id) || []);
        if (c.show_availability === false) return { ...live, status: 'offline' as const, available: false, hours: [] as string[] };
        return { ...live, hours: formatWeeklyHours(hoursMap.get(c.id) || []) };
      });
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockRecommendedConsultants.map((c, i): ConsultantLive => ({
      ...c,
      status: c.available ? 'available' : 'offline',
      country: '',
      place: c.city,
      linkedin_state: c.linkedinVerified ? 'checked' : 'none',
      credly_state: c.credlyVerified ? 'checked' : 'none',
      languages: ['en'],
      response_time_minutes: 15,
      verification_status: 'verified',
      credibility_credits: [250, 175, 100, 75, 50, 0][i % 6],
      ai_interview_badge: ['Gold', 'Silver', 'Bronze', 'Verified', 'Verified', null][i % 6],
    })) : undefined,
  });

  // Incomplete profiles are left out while the administrator's switch is on (an empty list when the call fails: everyone is shown).
  const consultants = withoutHidden(allConsultants, hiddenIds);
  const realtimeConnected = !isGuest;

  return { consultants, realtimeConnected, isLoading };
}
