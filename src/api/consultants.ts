import { supabase } from '@/integrations/supabase/client';

export const consultantsApi = {
  getAll: () =>
    supabase.from('consultants')
      .select('id, user_id, bio, hourly_rate, currency, timezone, languages, availability_status, rating, total_reviews, verification_status, city, country, industries, ai_skills_score, response_time_minutes')
      .order('rating', { ascending: false }),

  getById: (id: string) =>
    supabase.from('consultants').select('*').eq('id', id).single(),

  getByUserId: (userId: string) =>
    supabase.from('consultants').select('*').eq('user_id', userId).single(),
};
