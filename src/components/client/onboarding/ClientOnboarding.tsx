import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Building2, Settings2, Cpu, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import CompanyStep from './steps/CompanyStep';
import PreferencesStep from './steps/PreferencesStep';
import SapModulesStep from './steps/SapModulesStep';
import ReviewStep from './steps/ReviewStep';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';

export interface ClientOnboardingData {
  companyName: string;
  companySize: string;
  industry: string;
  sapLandscape: string;
  phone: string;
  preferredLanguage: string;
  communicationPreference: string;
  timezone: string;
  sapModules: string[];
}

const initialData: ClientOnboardingData = {
  companyName: '',
  companySize: '',
  industry: '',
  sapLandscape: '',
  phone: '',
  preferredLanguage: 'en',
  communicationPreference: 'email',
  timezone: 'Asia/Riyadh',
  sapModules: [],
};

const stepIcons = [Building2, Settings2, Cpu, ClipboardCheck];

export default function ClientOnboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isGuest } = useGuestMode();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<ClientOnboardingData>(initialData);
  const [submitting, setSubmitting] = useState(false);

  const steps = [
    { key: 'company', label: t('client_onboarding.step_company') },
    { key: 'preferences', label: t('client_onboarding.step_preferences') },
    { key: 'sap_modules', label: t('client_onboarding.step_sap_modules') },
    { key: 'review', label: t('client_onboarding.step_review') },
  ];

  const updateData = (partial: Partial<ClientOnboardingData>) => {
    setData(prev => ({ ...prev, ...partial }));
  };

  const handleSubmit = async () => {
    if (isGuest) {
      toast.success(t('guest.onboarding_demo'));
      navigate('/client');
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t('onboarding.error_auth')); return; }

      await supabase.from('profiles').update({
        display_name: data.companyName,
        phone: data.phone,
        preferred_language: data.preferredLanguage,
        onboarding_completed: true,
      }).eq('user_id', user.id);

      // Use rpc or direct insert for client_profiles
      const { error } = await supabase.from('client_profiles' as any).upsert({
        user_id: user.id,
        company_name: data.companyName,
        company_size: data.companySize,
        industry: data.industry,
        sap_landscape: data.sapLandscape,
        phone: data.phone,
        preferred_language: data.preferredLanguage,
        communication_preference: data.communicationPreference,
        timezone: data.timezone,
        sap_modules: data.sapModules,
        onboarding_completed: true,
      }, { onConflict: 'user_id' });

      if (error) throw error;
      toast.success(t('client_onboarding.success'));
      navigate('/client');
    } catch (err) {
      console.error(err);
      toast.error(t('onboarding.error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const canNext = () => {
    if (currentStep === 0) return data.companyName.trim().length > 0;
    if (currentStep === 2) return data.sapModules.length > 0;
    return true;
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-1 pb-36 md:pb-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">{t('client_onboarding.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('client_onboarding.subtitle')}</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 flex-wrap">
        {steps.map((step, i) => {
          const Icon = stepIcons[i];
          const isCompleted = i < currentStep;
          const isActive = i === currentStep;
          return (
            <div key={step.key} className="flex items-center">
              <button
                onClick={() => i < currentStep && setCurrentStep(i)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all',
                  isActive && 'bg-primary text-primary-foreground shadow-md',
                  isCompleted && 'bg-primary/10 text-primary cursor-pointer hover:bg-primary/20',
                  !isActive && !isCompleted && 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted ? <Check className="w-3 h-3 shrink-0" /> : <Icon className="w-3 h-3 shrink-0" />}
                <span className="hidden sm:inline whitespace-nowrap">{step.label}</span>
              </button>
              {i < steps.length - 1 && (
                <div className={cn('w-6 h-0.5 mx-0.5', i < currentStep ? 'bg-primary' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>

      <Card className="p-4 md:p-6">
        {currentStep === 0 && <CompanyStep data={data} onChange={updateData} />}
        {currentStep === 1 && <PreferencesStep data={data} onChange={updateData} />}
        {currentStep === 2 && <SapModulesStep data={data} onChange={updateData} />}
        {currentStep === 3 && <ReviewStep data={data} />}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setCurrentStep(s => s - 1)} disabled={currentStep === 0} className="gap-1.5">
          <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          {t('onboarding.back')}
        </Button>
        {currentStep < steps.length - 1 ? (
          <Button onClick={() => setCurrentStep(s => s + 1)} disabled={!canNext()} className="gap-1.5">
            {t('onboarding.next')}
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting ? t('common.loading') : t('client_onboarding.submit')}
          </Button>
        )}
      </div>
    </div>
  );
}
