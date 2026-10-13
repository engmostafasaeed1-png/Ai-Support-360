import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ListTodo } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMyMissingFields, useProfileFieldRules, useProfileRulesConfig } from '@/hooks/useProfileFieldRules';

/** The profile section (anchor id on the profile page) where each field is filled. */
const SECTION_OF: Record<string, string> = {
  avatar: 'profile-top', display_name: 'profile-details', phone: 'profile-details', bio: 'profile-details', hourly_rate: 'profile-details',
  timezone: 'profile-details', languages: 'profile-details', nationality: 'profile-details', country: 'profile-details', city: 'profile-details',
  linkedin_url: 'profile-details', credly_username: 'profile-details', github_url: 'profile-details', personal_website: 'profile-details', profile_video_url: 'profile-details',
  sap_role: 'expertise', seniority_level: 'expertise', total_sap_years: 'expertise', sap_roles: 'expertise', sap_technologies: 'expertise', skills: 'expertise',
  language_levels: 'profile-experience', work_modes: 'profile-experience', working_week: 'profile-experience', industries: 'profile-experience',
  customer_segments: 'profile-experience', vertical_solutions: 'profile-experience', localization_countries: 'profile-experience',
  localization_solutions: 'profile-experience', deployment_experience: 'profile-experience', project_types: 'profile-experience', project_scale: 'profile-experience',
  work_history: 'experience', cv: 'experience', certifications: 'certifications', education: 'education', projects: 'projects',
  availability: 'availability', ai_interview: 'interview-history', bank_details: 'payout-details',
};

export function sectionOf(key: string): string {
  return SECTION_OF[key] || 'profile-details';
}

/** "Complete your profile": the required fields the consultant still lacks, each one jumps to its section. Hidden when nothing is missing. */
export default function ProfileTodoCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: missing } = useMyMissingFields();
  const { labels } = useProfileFieldRules();
  const { data: config } = useProfileRulesConfig();
  if (!missing || missing.length === 0) return null;

  const go = (key: string) => {
    const id = sectionOf(key);
    if (pathname.startsWith('/consultant/profile')) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate(`/consultant/profile#${id}`);
    }
  };

  return (
    <Card className="rounded-2xl border-destructive/30" data-testid="profile-todo">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo aria-hidden="true" className="h-4 w-4 text-destructive" />
          {t('profileRules.todoTitle', 'Complete your profile')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('profileRules.todoCount', '{{n}} required fields are missing.', { n: missing.length })}</p>
        <div className="flex flex-wrap gap-2">
          {missing.map(key => (
            <Button key={key} type="button" size="sm" variant="outline" onClick={() => go(key)}>
              {labels.get(key) || key}
            </Button>
          ))}
        </div>
        {config?.enforce && (
          <p className="text-sm text-warning" role="status">
            {t('profileRules.todoEnforced', 'Until these are filled your profile is hidden from clients and you cannot place new bids.')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
