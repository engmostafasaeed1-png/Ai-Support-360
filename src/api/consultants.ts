import { supabase } from '@/integrations/supabase/client';

export const consultantsApi = {
  getAll: () =>
    supabase.from('consultants')
      .select('id, user_id, bio, hourly_rate, currency, timezone, languages, availability_status, rating, total_reviews, verification_status, city, country, industries, ai_skills_score, response_time_minutes')
      .order('rating', { ascending: false }),

  getById: (id: string) =>
    supabase.from('consultants').select('id, user_id, bio, hourly_rate, currency, timezone, languages, industries, verification_status, rating, total_reviews, response_time_minutes, availability_status, ai_skills_score, created_at, updated_at, location, city, country, credibility_credits, ai_interview_completed_at, ai_interview_badge, latitude, longitude, linkedin_checked_at, credly_checked_at, sap_role, seniority_level, total_sap_years, sap_technologies, localization_countries, project_types, sap_roles, profile_visible, show_availability, new_case_alerts').eq('id', id).single(),

  getByUserId: (userId: string) =>
    supabase.from('consultants').select('id, user_id, bio, hourly_rate, currency, timezone, languages, industries, verification_status, rating, total_reviews, response_time_minutes, availability_status, ai_skills_score, created_at, updated_at, location, city, country, credibility_credits, ai_interview_completed_at, ai_interview_badge, latitude, longitude, linkedin_checked_at, credly_checked_at, sap_role, seniority_level, total_sap_years, sap_technologies, localization_countries, project_types, sap_roles, profile_visible, show_availability, new_case_alerts').eq('user_id', userId).single(),
};
