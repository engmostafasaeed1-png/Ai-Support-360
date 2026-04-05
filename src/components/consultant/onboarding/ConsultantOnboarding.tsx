import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, User, Cpu, Award, Clock } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ProfileStep from './steps/ProfileStep';
import SkillsStep from './steps/SkillsStep';
import CertificationsStep from './steps/CertificationsStep';
import AvailabilityStep from './steps/AvailabilityStep';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { fireConfetti } from '@/lib/confetti';

export interface OnboardingData {
  // Profile
  displayName: string;
  bio: string;
  hourlyRate: number;
  currency: string;
  timezone: string;
  languages: string[];
  // Skills
  skills: { sapModule: string; proficiencyLevel: number; yearsExperience: number; certified: boolean }[];
  // Certifications
  certifications: { name: string; issuer: string; issueDate: string; expiryDate: string; file?: File }[];
  // Availability
  availability: { dayOfWeek: number; startTime: string; endTime: string }[];
}

const initialData: OnboardingData = {
  displayName: '',
  bio: '',
  hourlyRate: 0,
  currency: 'USD',
  timezone: 'Asia/Riyadh',
  languages: ['en'],
  skills: [],
  certifications: [],
  availability: [],
};

const stepIcons = [User, Cpu, Award, Clock];

export default function ConsultantOnboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isGuest } = useGuestMode();
  const [searchParams] = useSearchParams();
  const initialStep = Math.min(Math.max(Number(searchParams.get('step')) || 0, 0), 3);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [data, setData] = useState<OnboardingData>(initialData);
  const [submitting, setSubmitting] = useState(false);

  const steps = [
    { key: 'profile', label: t('onboarding.step_profile') },
    { key: 'skills', label: t('onboarding.step_skills') },
    { key: 'certifications', label: t('onboarding.step_certifications') },
    { key: 'availability', label: t('onboarding.step_availability') },
  ];

  const updateData = (partial: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...partial }));
  };

  const handleSubmit = async () => {
    if (isGuest) {
      fireConfetti();
      toast.success(t('guest.onboarding_demo'));
      setTimeout(() => navigate('/consultant?welcome=true'), 1200);
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t('onboarding.error_auth')); return; }

      // Update profile
      await supabase.from('profiles').update({
        display_name: data.displayName,
        onboarding_completed: true,
      }).eq('user_id', user.id);

      // Upsert consultant record
      const { data: consultant, error: consultantErr } = await supabase
        .from('consultants')
        .upsert({
          user_id: user.id,
          bio: data.bio,
          hourly_rate: data.hourlyRate,
          currency: data.currency,
          timezone: data.timezone,
          languages: data.languages,
          verification_status: 'pending',
          availability_status: 'offline',
        }, { onConflict: 'user_id' })
        .select('id')
        .single();

      if (consultantErr || !consultant) throw consultantErr;

      // Insert skills
      if (data.skills.length > 0) {
        await supabase.from('consultant_skills').insert(
          data.skills.map(s => ({
            consultant_id: consultant.id,
            sap_module: s.sapModule,
            proficiency_level: s.proficiencyLevel,
            years_experience: s.yearsExperience,
            certified: s.certified,
          }))
        );
      }

      // Upload certifications
      for (const cert of data.certifications) {
        let docUrl: string | null = null;
        if (cert.file) {
          const filePath = `${user.id}/${Date.now()}-${cert.file.name}`;
          const { error: uploadErr } = await supabase.storage
            .from('chat-files')
            .upload(filePath, cert.file);
          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(filePath);
            docUrl = urlData.publicUrl;
          }
        }
        await supabase.from('certifications').insert({
          consultant_id: consultant.id,
          name: cert.name,
          issuer: cert.issuer || null,
          issue_date: cert.issueDate || null,
          expiry_date: cert.expiryDate || null,
          document_url: docUrl,
        });
      }

      // Insert availability slots
      if (data.availability.length > 0) {
        await supabase.from('availability_slots').insert(
          data.availability.map(a => ({
            consultant_id: consultant.id,
            day_of_week: a.dayOfWeek,
            start_time: a.startTime,
            end_time: a.endTime,
            is_recurring: true,
          }))
        );
      }

      fireConfetti();
      toast.success(t('onboarding.success'));
      setTimeout(() => navigate('/consultant?welcome=true'), 1200);
    } catch (err) {
      console.error(err);
      toast.error(t('onboarding.error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const canNext = () => {
    if (currentStep === 0) return data.displayName.trim().length > 0 && data.bio.trim().length > 0;
    if (currentStep === 1) return data.skills.length > 0;
    return true;
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-1 pb-36 md:pb-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('onboarding.subtitle')}</p>
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
                {isCompleted ? (
                  <Check className="w-3 h-3 shrink-0" />
                ) : (
                  <Icon className="w-3 h-3 shrink-0" />
                )}
                <span className="hidden sm:inline whitespace-nowrap">{step.label}</span>
              </button>
              {i < steps.length - 1 && (
                <div className={cn('w-6 h-0.5 mx-0.5', i < currentStep ? 'bg-primary' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <Card className="p-4 md:p-6">
        {currentStep === 0 && <ProfileStep data={data} onChange={updateData} />}
        {currentStep === 1 && <SkillsStep data={data} onChange={updateData} />}
        {currentStep === 2 && <CertificationsStep data={data} onChange={updateData} />}
        {currentStep === 3 && <AvailabilityStep data={data} onChange={updateData} />}
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(s => s - 1)}
          disabled={currentStep === 0}
          className="gap-1.5"
        >
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
            {submitting ? t('common.loading') : t('onboarding.submit')}
          </Button>
        )}
      </div>
    </div>
  );
}
