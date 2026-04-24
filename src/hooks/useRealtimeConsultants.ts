import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockRecommendedConsultants } from '@/data/clientMockData';

export interface ConsultantLive {
  id: string;
  name: string;
  specialty: string;
  rating: number;
  reviews: number;
  rate: number;
  avatar: string;
  available: boolean;
  matchScore: number;
  badges: string[];
  lat: number;
  lng: number;
  city: string;
  industries: string[];
  credly_username?: string | null;
  languages: string[];
  response_time_minutes: number;
  verification_status: string;
  credibility_credits?: number;
  ai_interview_badge?: string | null;
}

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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isGuest, queryClient]);

  const { data: consultants = [], isLoading } = useQuery({
    queryKey: ['realtime-consultants'],
    queryFn: async () => {
      // Fetch all consultants with their skills
      const { data: consultantRows, error } = await supabase
        .from('consultants')
        .select('id, user_id, bio, hourly_rate, currency, timezone, languages, industries, verification_status, rating, total_reviews, response_time_minutes, availability_status, location, credly_username')
        .order('rating', { ascending: false });

      if (error) throw error;
      if (!consultantRows || consultantRows.length === 0) return [];

      // Get user profiles for names
      const userIds = consultantRows.map(c => c.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
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

      return consultantRows.map((c): ConsultantLive => {
        const profile = profileMap.get(c.user_id);
        const name = profile?.display_name || 'Consultant';
        const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
        const topSkills = skillsMap.get(c.id) || [];
        const loc = c.location as any;

        const badges: string[] = [];
        if (c.verification_status === 'verified') badges.push('verified');
        if ((c.rating || 0) >= 4.5) badges.push('top_rated');
        if ((c.response_time_minutes || 999) <= 30) badges.push('fast_responder');
        if (c.credly_username) badges.push('credly');

        return {
          id: c.id,
          name,
          specialty: topSkills[0] || 'SAP',
          rating: Number(c.rating) || 0,
          reviews: c.total_reviews || 0,
          rate: Number(c.hourly_rate) || 0,
          avatar: initials,
          available: c.availability_status === 'available',
          matchScore: Math.round(60 + Math.random() * 40),
          badges,
          lat: loc?.x || 24.7136 + (Math.random() - 0.5) * 5,
          lng: loc?.y || 46.6753 + (Math.random() - 0.5) * 5,
          city: c.timezone?.split('/')[1]?.replace('_', ' ') || 'Riyadh',
          industries: c.industries || [],
          credly_username: c.credly_username,
          languages: c.languages || ['en'],
          response_time_minutes: c.response_time_minutes || 0,
          verification_status: c.verification_status || 'pending',
        };
      });
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockRecommendedConsultants.map(c => ({
      ...c,
      languages: ['en'],
      response_time_minutes: 15,
      verification_status: 'verified',
    })) : undefined,
  });

  const realtimeConnected = !isGuest;

  return { consultants, realtimeConnected, isLoading };
}
