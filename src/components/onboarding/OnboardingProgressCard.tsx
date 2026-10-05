import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ClipboardList, ChevronRight, Circle, CheckCircle2 } from 'lucide-react';
import { getClientOnboardingState } from '@/lib/clientOnboarding';

interface ChecklistItem {
  labelKey: string;
  fallback: string;
  done: boolean;
  step: number;
  tooltipKey: string;
  tooltipFallback: string;
}

interface Props {
  role: 'client' | 'consultant';
}

export default function OnboardingProgressCard({ role }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    const check = async () => {
      if (isGuest) {
        setCompleted(false);
        setChecklist(
          role === 'client'
            ? [
                { labelKey: 'onboarding.check_company', fallback: 'Company name', done: false, step: 0, tooltipKey: 'onboarding.tip_company', tooltipFallback: 'Enter your organization\'s official name' },
                { labelKey: 'onboarding.check_size', fallback: 'Company size', done: false, step: 0, tooltipKey: 'onboarding.tip_size', tooltipFallback: 'Select the number of employees in your company' },
                { labelKey: 'onboarding.check_industry', fallback: 'Industry', done: false, step: 0, tooltipKey: 'onboarding.tip_industry', tooltipFallback: 'Choose the industry your business operates in' },
                { labelKey: 'onboarding.check_phone', fallback: 'Phone number', done: false, step: 1, tooltipKey: 'onboarding.tip_phone', tooltipFallback: 'Provide a contact number for session coordination' },
                { labelKey: 'onboarding.check_modules', fallback: 'SAP modules', done: false, step: 2, tooltipKey: 'onboarding.tip_modules', tooltipFallback: 'Select which SAP modules you need support with' },
              ]
            : [
                { labelKey: 'onboarding.check_name', fallback: 'Display name', done: false, step: 0, tooltipKey: 'onboarding.tip_name', tooltipFallback: 'Your full professional name shown to clients' },
                { labelKey: 'onboarding.check_bio', fallback: 'Professional bio', done: false, step: 0, tooltipKey: 'onboarding.tip_bio', tooltipFallback: 'A brief summary of your SAP experience and expertise' },
                { labelKey: 'onboarding.check_rate', fallback: 'Hourly rate', done: false, step: 0, tooltipKey: 'onboarding.tip_rate', tooltipFallback: 'Set your consulting fee per hour' },
                { labelKey: 'onboarding.check_skills', fallback: 'SAP skills', done: false, step: 1, tooltipKey: 'onboarding.tip_skills', tooltipFallback: 'List the SAP modules and areas you specialize in' },
              ]
        );
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (role === 'client') {
        const { data } = await supabase
          .from('client_profiles')
          .select('onboarding_completed, company_name, company_size, industry, sap_modules, phone')
          .eq('user_id', user.id)
          .maybeSingle();

        const onboardingState = getClientOnboardingState(data);

        if (onboardingState.completed) {
          setCompleted(true);
          return;
        }

        setChecklist([
          { labelKey: 'onboarding.check_company', fallback: 'Company name', done: onboardingState.checks.companyName, step: 0, tooltipKey: 'onboarding.tip_company', tooltipFallback: 'Enter your organization\'s official name' },
          { labelKey: 'onboarding.check_size', fallback: 'Company size', done: onboardingState.checks.companySize, step: 0, tooltipKey: 'onboarding.tip_size', tooltipFallback: 'Select the number of employees in your company' },
          { labelKey: 'onboarding.check_industry', fallback: 'Industry', done: onboardingState.checks.industry, step: 0, tooltipKey: 'onboarding.tip_industry', tooltipFallback: 'Choose the industry your business operates in' },
          { labelKey: 'onboarding.check_phone', fallback: 'Phone number', done: onboardingState.checks.phone, step: 1, tooltipKey: 'onboarding.tip_phone', tooltipFallback: 'Provide a contact number for session coordination' },
          { labelKey: 'onboarding.check_modules', fallback: 'SAP modules', done: onboardingState.checks.sapModules, step: 2, tooltipKey: 'onboarding.tip_modules', tooltipFallback: 'Select which SAP modules you need support with' },
        ]);
        setCompleted(false);
      } else {
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed, display_name')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profile?.onboarding_completed) { setCompleted(true); return; }

        const { data: consultant } = await supabase
          .from('consultants')
          .select('id, bio, hourly_rate')
          .eq('user_id', user.id)
          .maybeSingle();

        const { count } = await supabase
          .from('consultant_skills')
          .select('id', { count: 'exact', head: true })
          .eq('consultant_id', consultant?.id ?? '');

        setChecklist([
          { labelKey: 'onboarding.check_name', fallback: 'Display name', done: !!profile?.display_name, step: 0, tooltipKey: 'onboarding.tip_name', tooltipFallback: 'Your full professional name shown to clients' },
          { labelKey: 'onboarding.check_bio', fallback: 'Professional bio', done: !!consultant?.bio, step: 0, tooltipKey: 'onboarding.tip_bio', tooltipFallback: 'A brief summary of your SAP experience and expertise' },
          { labelKey: 'onboarding.check_rate', fallback: 'Hourly rate', done: !!consultant?.hourly_rate && Number(consultant.hourly_rate) > 0, step: 0, tooltipKey: 'onboarding.tip_rate', tooltipFallback: 'Set your consulting fee per hour' },
          { labelKey: 'onboarding.check_skills', fallback: 'SAP skills', done: (count ?? 0) > 0, step: 1, tooltipKey: 'onboarding.tip_skills', tooltipFallback: 'List the SAP modules and areas you specialize in' },
        ]);
        setCompleted(false);
      }
    };
    check();
  }, [isGuest, role]);

  if (completed === null || completed) return null;

  const doneCount = checklist.filter(c => c.done).length;
  const progress = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : 0;
  const onboardingPath = role === 'client' ? '/client/onboarding' : '/consultant/profile?section=setup';

  return (
    <Card className="rounded-2xl border-accent/30 bg-accent/5">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t('onboarding.progress_title', 'Complete your setup')}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {doneCount}/{checklist.length} {t('onboarding.steps_done', 'steps completed')}
                </p>
              </div>
              <Link to={onboardingPath} className="shrink-0">
                <Button size="sm" className="gradient-primary border-0 gap-1">
                  {t('onboarding.continue', 'Continue')}
                  <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
                </Button>
              </Link>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <Progress value={progress} className="h-2 flex-1" />
              <span className="text-xs font-medium text-foreground whitespace-nowrap">
                {progress}%
              </span>
            </div>

            <TooltipProvider delayDuration={300}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
                {checklist.map((item) => (
                  <Tooltip key={item.labelKey}>
                    <TooltipTrigger asChild>
                      <Link
                        to={`${onboardingPath}${role === 'client' ? '?' : '&'}step=${role === 'consultant' ? item.step + 1 : item.step}`}
                        className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors ${item.done ? 'hover:bg-muted/50' : 'hover:bg-accent/10'}`}
                      >
                        {item.done ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                        )}
                        <span className={`text-xs ${item.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {t(item.labelKey, item.fallback)}
                        </span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[200px]">
                      {t(item.tooltipKey, item.tooltipFallback)}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
