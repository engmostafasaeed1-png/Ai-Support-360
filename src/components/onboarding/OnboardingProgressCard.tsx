import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ClipboardList, ChevronRight } from 'lucide-react';

interface Props {
  role: 'client' | 'consultant';
}

export default function OnboardingProgressCard({ role }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [progress, setProgress] = useState<number | null>(null);
  const [completed, setCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      if (isGuest) {
        setCompleted(false);
        setProgress(0);
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

        if (data?.onboarding_completed) {
          setCompleted(true);
          return;
        }

        // Calculate progress based on filled fields
        const fields = [data?.company_name, data?.company_size, data?.industry, data?.phone];
        const modulesOk = (data?.sap_modules?.length ?? 0) > 0;
        const filled = fields.filter(Boolean).length + (modulesOk ? 1 : 0);
        setProgress(Math.round((filled / 5) * 100));
        setCompleted(false);
      } else {
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_completed, display_name')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profile?.onboarding_completed) {
          setCompleted(true);
          return;
        }

        const { data: consultant } = await supabase
          .from('consultants')
          .select('bio, hourly_rate')
          .eq('user_id', user.id)
          .maybeSingle();

        const fields = [profile?.display_name, consultant?.bio, consultant?.hourly_rate];
        const filled = fields.filter(Boolean).length;
        setProgress(Math.round((filled / 3) * 100));
        setCompleted(false);
      }
    };
    check();
  }, [isGuest, role]);

  // Don't render if completed or still loading
  if (completed === null || completed) return null;

  const onboardingPath = role === 'client' ? '/client/onboarding' : '/consultant/onboarding';

  return (
    <Card className="rounded-2xl border-accent/30 bg-accent/5">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {t('onboarding.progress_title', 'Complete your setup')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onboarding.progress_desc', 'Finish onboarding to unlock all features')}
            </p>
            <div className="flex items-center gap-3 mt-3">
              <Progress value={progress ?? 0} className="h-2 flex-1" />
              <span className="text-xs font-medium text-foreground whitespace-nowrap">
                {progress ?? 0}%
              </span>
            </div>
          </div>
          <Link to={onboardingPath} className="shrink-0">
            <Button size="sm" className="gradient-primary border-0 gap-1">
              {t('onboarding.continue', 'Continue')}
              <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
