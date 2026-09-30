import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Upload, User, Cpu, Award, Clock, Briefcase, GraduationCap, FolderKanban, Brain } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ImportStep from './steps/ImportStep';
import ProfileStep from './steps/ProfileStep';
import SkillsStep from './steps/SkillsStep';
import CertificationsStep from './steps/CertificationsStep';
import WorkHistoryStep from './steps/WorkHistoryStep';
import EducationStep from './steps/EducationStep';
import ProjectsStep from './steps/ProjectsStep';
import AvailabilityStep from './steps/AvailabilityStep';
import InterviewStep from './steps/InterviewStep';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { fireConfetti } from '@/lib/confetti';
import { safeFileName } from '@/lib/storagePath';

export interface WorkHistoryEntry {
  companyName: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
  description: string;
  isCurrent: boolean;
}

export interface EducationEntry {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYear: number | null;
  endYear: number | null;
}

export interface ProjectEntry {
  projectName: string;
  clientIndustry: string;
  sapModules: string[];
  description: string;
  durationMonths: number | null;
  role: string;
}

export interface OnboardingData {
  // Profile
  displayName: string;
  bio: string;
  hourlyRate: number;
  currency: string;
  timezone: string;
  languages: string[];
  // Personal / Social
  nationality: string;
  city: string;
  country: string;
  linkedinUrl: string;
  githubUrl: string;
  personalWebsite: string;
  // Skills
  skills: { sapModule: string; proficiencyLevel: number; yearsExperience: number; certified: boolean }[];
  // Certifications
  certifications: { name: string; issuer: string; issueDate: string; expiryDate: string; file?: File }[];
  // Work History
  workHistory: WorkHistoryEntry[];
  // Education
  education: EducationEntry[];
  // Projects
  projects: ProjectEntry[];
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
  nationality: '',
  city: '',
  country: '',
  linkedinUrl: '',
  githubUrl: '',
  personalWebsite: '',
  skills: [],
  certifications: [],
  workHistory: [],
  education: [],
  projects: [],
  availability: [],
};

const STEP_COUNT = 9;

const stepIcons = [Upload, User, Cpu, Award, Briefcase, GraduationCap, FolderKanban, Clock, Brain];

export default function ConsultantOnboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isGuest } = useGuestMode();
  const [searchParams] = useSearchParams();
  const initialStep = Math.min(Math.max(Number(searchParams.get('step')) || 0, 0), STEP_COUNT - 1);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [data, setData] = useState<OnboardingData>(initialData);
  const [submitting, setSubmitting] = useState(false);
  const [interviewDone, setInterviewDone] = useState(false);
  const [consultantId, setConsultantId] = useState<string | null>(null);

  const steps = [
    { key: 'import', label: 'Import' },
    { key: 'profile', label: t('onboarding.step_profile') },
    { key: 'skills', label: t('onboarding.step_skills') },
    { key: 'certifications', label: t('onboarding.step_certifications') },
    { key: 'work', label: 'Experience' },
    { key: 'education', label: 'Education' },
    { key: 'projects', label: 'Projects' },
    { key: 'availability', label: t('onboarding.step_availability') },
    { key: 'interview', label: 'AI Interview' },
  ];

  const updateData = (partial: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...partial }));
  };

  const handleSaveAndContinue = async () => {
    if (isGuest) {
      setCurrentStep(STEP_COUNT - 1);
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t('onboarding.error_auth')); return; }

      // Update or create profile
      const { error: profileError } = await supabase.from('profiles').upsert({
        user_id: user.id,
        display_name: data.displayName,
        onboarding_completed: true,
      }, { onConflict: 'user_id' });

      if (profileError) throw profileError;

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
          linkedin_url: data.linkedinUrl || null,
          github_url: data.githubUrl || null,
          personal_website: data.personalWebsite || null,
          nationality: data.nationality || null,
          city: data.city || null,
          country: data.country || null,
          availability_status: 'offline',
        }, { onConflict: 'user_id' })
        .select('id')
        .single();

      if (consultantErr || !consultant) throw consultantErr;
      setConsultantId(consultant.id);

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
          // Private bucket; the stored value is the storage path (first folder = user id, as the storage policy requires).
          const filePath = `${user.id}/certifications/${Date.now()}-${safeFileName(cert.file.name)}`;
          const { error: uploadErr } = await supabase.storage.from('consultant-documents').upload(filePath, cert.file);
          if (uploadErr) {
            console.error('Certificate upload failed:', uploadErr);
            toast.warning(`The file for "${cert.name}" could not be uploaded.`);
          } else {
            docUrl = filePath;
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

      // Insert work history
      if (data.workHistory.length > 0) {
        await supabase.from('consultant_work_history').insert(
          data.workHistory.map(w => ({
            consultant_id: consultant.id,
            company_name: w.companyName,
            job_title: w.jobTitle,
            start_date: w.startDate || null,
            end_date: w.endDate || null,
            description: w.description || null,
            is_current: w.isCurrent,
          }))
        );
      }

      // Insert education
      if (data.education.length > 0) {
        await supabase.from('consultant_education').insert(
          data.education.map(e => ({
            consultant_id: consultant.id,
            institution: e.institution,
            degree: e.degree || null,
            field_of_study: e.fieldOfStudy || null,
            start_year: e.startYear,
            end_year: e.endYear,
          }))
        );
      }

      // Insert projects
      if (data.projects.length > 0) {
        await supabase.from('consultant_projects').insert(
          data.projects.map(p => ({
            consultant_id: consultant.id,
            project_name: p.projectName,
            client_industry: p.clientIndustry || null,
            sap_modules: p.sapModules,
            description: p.description || null,
            duration_months: p.durationMonths,
            role: p.role || null,
          }))
        );
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

      toast.success('Profile saved! Proceeding to AI Interview...');
      setCurrentStep(STEP_COUNT - 1);
    } catch (err) {
      console.error(err);
      toast.error(t('onboarding.error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const canNext = () => {
    if (currentStep === 0) return true; // Import is always skippable
    if (currentStep === 1) return data.displayName.trim().length > 0 && data.bio.trim().length > 0;
    if (currentStep === 2) return data.skills.length > 0;
    return true;
  };

  const isLastContentStep = currentStep === STEP_COUNT - 2; // Availability is last before interview
  const isInterviewStep = currentStep === STEP_COUNT - 1;

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-1 pb-36 md:pb-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('onboarding.subtitle')}</p>
      </div>

      {/* Skip onboarding */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                await supabase.from('profiles').update({ onboarding_completed: true }).eq('user_id', user.id);
              }
            } catch {}
            navigate('/consultant');
          }}
        >
          Skip for now
        </Button>
      </div>

      {/* Step indicator - scrollable */}
      <div className="flex items-center justify-start gap-1 overflow-x-auto pb-2 scrollbar-hide">
        {steps.map((step, i) => {
          const Icon = stepIcons[i];
          const isCompleted = i < currentStep;
          const isActive = i === currentStep;
          return (
            <div key={step.key} className="flex items-center shrink-0">
              <button
                onClick={() => i < currentStep && setCurrentStep(i)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1.5 rounded-xl text-[10px] font-medium transition-all',
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
                <div className={cn('w-4 h-0.5 mx-0.5', i < currentStep ? 'bg-primary' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <Card className="p-4 md:p-6">
        {currentStep === 0 && <ImportStep data={data} onChange={updateData} />}
        {currentStep === 1 && <ProfileStep data={data} onChange={updateData} />}
        {currentStep === 2 && <SkillsStep data={data} onChange={updateData} />}
        {currentStep === 3 && <CertificationsStep data={data} onChange={updateData} />}
        {currentStep === 4 && <WorkHistoryStep data={data} onChange={updateData} />}
        {currentStep === 5 && <EducationStep data={data} onChange={updateData} />}
        {currentStep === 6 && <ProjectsStep data={data} onChange={updateData} />}
        {currentStep === 7 && <AvailabilityStep data={data} onChange={updateData} />}
        {currentStep === 8 && (
          <InterviewStep
            onInterviewComplete={() => setInterviewDone(true)}
            consultantId={consultantId || undefined}
          />
        )}
      </Card>

      {/* Navigation */}
      {!isInterviewStep && (
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
          {currentStep < STEP_COUNT - 2 ? (
            <Button onClick={() => setCurrentStep(s => s + 1)} disabled={!canNext()} className="gap-1.5">
              {t('onboarding.next')}
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button onClick={handleSaveAndContinue} disabled={submitting} className="gap-1.5">
              {submitting ? t('common.loading') : 'Save & Continue to Interview'}
              <ChevronRight className="w-4 h-4 rtl:rotate-180" />
            </Button>
          )}
        </div>
      )}

      {isInterviewStep && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(s => s - 1)}
            className="gap-1.5"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            {t('onboarding.back')}
          </Button>
          <Button
            onClick={async () => {
              try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                  await supabase.from('profiles').update({ onboarding_completed: true }).eq('user_id', user.id);
                }
              } catch {}
              fireConfetti();
              toast.success('Profile setup complete!');
              setTimeout(() => navigate('/consultant?welcome=true'), 1200);
            }}
            className="gap-1.5"
          >
            Finish Setup
          </Button>
        </div>
      )}
    </div>
  );
}
