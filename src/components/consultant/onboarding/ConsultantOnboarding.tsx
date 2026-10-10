import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Upload, User, Cpu, Award, Clock, Briefcase, GraduationCap, FolderKanban, Brain } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useQueryClient } from '@tanstack/react-query';
import SapExpertiseCard from '@/components/consultant/SapExpertiseCard';
import ExperienceCvCard from '@/components/consultant/ExperienceCvCard';
import SetAvailabilityDialog from '@/components/consultant/SetAvailabilityDialog';
import ProfileAvailability from '@/components/consultant/ProfileAvailability';
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
import { cityPoint } from '@/lib/geo';
import { CREDLY_HINT, LINKEDIN_HINT, normalizeCredlyUsername, normalizeLinkedinUrl } from '@/lib/consultantLinks';
import { certificateKey, jobKey, onlyNew, projectKey, skillKey, slotKey, studyKey } from '@/lib/onboardingDedupe';

export interface WorkHistoryEntry {
  companyName: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
  description: string;
  isCurrent: boolean;
}

export interface EducationEntry {
  id?: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYear: number | null;
  endYear: number | null;
}

export interface ProjectEntry {
  id?: string;
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
  credlyUsername: string;
  // Skills
  skills: { sapModule: string; proficiencyLevel: number; yearsExperience: number; certified: boolean }[];
  // Certifications
  certifications: { id?: string; name: string; issuer: string; issueDate: string; expiryDate: string; file?: File }[];
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
  credlyUsername: '',
  skills: [],
  certifications: [],
  workHistory: [],
  education: [],
  projects: [],
  availability: [],
};

const STEP_COUNT = 9;

const stepIcons = [Upload, User, Cpu, Award, Briefcase, GraduationCap, FolderKanban, Clock, Brain];

export default function ConsultantOnboarding({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loadedRevision, setLoadedRevision] = useState(0);
  const [savedRows, setSavedRows] = useState({ certifications: [] as string[], education: [] as string[], projects: [] as string[] });
  const { isGuest } = useGuestMode();
  const [searchParams] = useSearchParams();
  const initialStep = Math.min(Math.max(Number(searchParams.get('step')) || 0, 0), STEP_COUNT - 1);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [data, setData] = useState<OnboardingData>(initialData);
  const [submitting, setSubmitting] = useState(false);
  const [interviewDone, setInterviewDone] = useState(false);
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isGuest);

  useEffect(() => {
    if (isGuest) return;
    let active = true;
    const prefill = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [profileResult, consultantResult] = await Promise.all([
          supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
          supabase.from('consultants').select('*').eq('user_id', user.id).maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (consultantResult.error) throw consultantResult.error;
        const c = consultantResult.data;
        if (!active) return;
        if (!c) {
          setData(prev => ({ ...prev, displayName: profileResult.data?.display_name || '' }));
          return;
        }
        const [skills, certificates, jobs, studies, projects, slots] = await Promise.all([
          supabase.from('consultant_skills').select('*').eq('consultant_id', c.id),
          supabase.from('certifications').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_work_history').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_education').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_projects').select('*').eq('consultant_id', c.id),
          supabase.from('availability_slots').select('*').eq('consultant_id', c.id),
        ]);
        for (const result of [skills, certificates, jobs, studies, projects, slots]) {
          if (result.error) throw result.error;
        }
        if (!active) return;
        setConsultantId(c.id);
        setSavedRows({ certifications: (certificates.data || []).map(x => x.id), education: (studies.data || []).map(x => x.id), projects: (projects.data || []).map(x => x.id) });
        setData({
          displayName: profileResult.data?.display_name || '', bio: c.bio || '',
          hourlyRate: Number(c.hourly_rate) || 0, currency: c.currency || 'USD',
          timezone: c.timezone || 'Asia/Riyadh', languages: c.languages || ['en'],
          nationality: c.nationality || '', city: c.city || '', country: c.country || '',
          linkedinUrl: c.linkedin_url || '', githubUrl: c.github_url || '',
          personalWebsite: c.personal_website || '', credlyUsername: c.credly_username || '',
          skills: (skills.data || []).map(s => ({ sapModule: s.sap_module, proficiencyLevel: s.proficiency_level || 1, yearsExperience: s.years_experience || 0, certified: Boolean(s.certified) })),
          certifications: (certificates.data || []).map(s => ({ id: s.id, name: s.name, issuer: s.issuer || '', issueDate: s.issue_date || '', expiryDate: s.expiry_date || '' })),
          workHistory: (jobs.data || []).map(s => ({ companyName: s.company_name, jobTitle: s.job_title, startDate: s.start_date || '', endDate: s.end_date || '', description: s.description || '', isCurrent: Boolean(s.is_current) })),
          education: (studies.data || []).map(s => ({ id: s.id, institution: s.institution, degree: s.degree || '', fieldOfStudy: s.field_of_study || '', startYear: s.start_year, endYear: s.end_year })),
          projects: (projects.data || []).map(s => ({ id: s.id, projectName: s.project_name, clientIndustry: s.client_industry || '', sapModules: s.sap_modules || [], description: s.description || '', durationMonths: s.duration_months, role: s.role || '' })),
          availability: (slots.data || []).flatMap(s => s.day_of_week === null ? [] : [{ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time }]),
        });
      } catch {
        toast.error(t('onboarding.error_generic'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void prefill();
    return () => { active = false; };
  }, [isGuest, t, loadedRevision]);

  useEffect(() => {
    setCurrentStep(Math.min(Math.max(Number(searchParams.get('step')) || 0, 0), STEP_COUNT - 1));
  }, [searchParams]);

  useEffect(() => {
    if (!embedded || loading || !searchParams.has('step')) return;
    const targets = ['profile-details', 'profile-details', 'expertise', 'certifications', 'experience', 'education', 'projects', 'availability', 'interview-history'];
    document.getElementById(targets[Number(searchParams.get('step'))] || 'profile-details')?.scrollIntoView({ block: 'start' });
  }, [embedded, loading, searchParams]);

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
    // Same rules as the database: a wrong LinkedIn or Credly value is shown here, before anything is saved.
    const linkedinUrl = data.linkedinUrl.trim() ? normalizeLinkedinUrl(data.linkedinUrl) : null;
    const credlyUsername = data.credlyUsername.trim() ? normalizeCredlyUsername(data.credlyUsername) : null;
    if ((data.linkedinUrl.trim() && !linkedinUrl) || (data.credlyUsername.trim() && !credlyUsername)) {
      toast.error(data.linkedinUrl.trim() && !linkedinUrl ? LINKEDIN_HINT : CREDLY_HINT);
      setCurrentStep(1);
      return;
    }
    // The place on the map is the centre of the chosen city (the database rounds it to about 1 km).
    const place = data.country && data.city ? cityPoint(data.country, data.city) : null;
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
          linkedin_url: linkedinUrl,
          credly_username: credlyUsername,
          github_url: data.githubUrl || null,
          personal_website: data.personalWebsite || null,
          nationality: data.nationality || null,
          city: data.city || null,
          country: data.country || null,
          latitude: place ? place.lat : null,
          longitude: place ? place.lng : null,
        }, { onConflict: 'user_id' })
        .select('id')
        .single();

      if (consultantErr || !consultant) throw consultantErr;
      setConsultantId(consultant.id);

      // The nationality is a private detail: it is kept in its own table that only the consultant and the administrators can read.
      const { error: privateError } = await supabase
        .from('consultant_private')
        .upsert({ consultant_id: consultant.id, nationality: data.nationality || null }, { onConflict: 'consultant_id' });
      if (privateError) throw privateError;

      if (embedded) {
        // Existing rows are edited by their stable row IDs; new duplicates are skipped, not appended.
        const syncRows = async (table: 'certifications' | 'consultant_education' | 'consultant_projects', rows: { id?: string; [key: string]: unknown }[], original: string[], key: (row: any) => string) => {
          const { data: existing, error: readError } = await supabase.from(table).select('*').eq('consultant_id', consultant.id);
          if (readError) throw readError;
          const seen = new Set((existing || []).map(key));
          for (const row of rows) {
            const { id, ...values } = row;
            if (!key(row)) continue;
            if (id) {
              const { error } = await supabase.from(table).update(values).eq('id', id).eq('consultant_id', consultant.id);
              if (error) throw error;
            } else if (!seen.has(key(row))) {
              const { error } = await supabase.from(table).insert({ ...values, consultant_id: consultant.id } as any);
              if (error) throw error;
              seen.add(key(row));
            }
          }
          const removed = original.filter(id => !rows.some(row => row.id === id));
          if (removed.length) {
            const { error } = await supabase.from(table).delete().in('id', removed).eq('consultant_id', consultant.id);
            if (error) throw error;
          }
        };
        const certificates = [];
        for (const cert of data.certifications.filter(c => c.name.trim())) {
          let document_url: string | undefined;
          if (cert.file) {
            const path = `${user.id}/certifications/${Date.now()}-${safeFileName(cert.file.name)}`;
            const { error } = await supabase.storage.from('consultant-documents').upload(path, cert.file);
            if (error) throw error;
            document_url = path;
          }
          certificates.push({ id: cert.id, name: cert.name.trim(), issuer: cert.issuer || null, issue_date: cert.issueDate || null,
            expiry_date: cert.expiryDate || null, ...(document_url ? { document_url } : {}) });
        }
        await syncRows('certifications', certificates, savedRows.certifications, r => certificateKey(r.name, r.issuer, r.issue_date));
        await syncRows('consultant_education', data.education.filter(e => e.institution.trim()).map(e => ({ id: e.id, institution: e.institution.trim(), degree: e.degree || null, field_of_study: e.fieldOfStudy || null, start_year: e.startYear, end_year: e.endYear })), savedRows.education, r => studyKey(r.institution, r.degree, r.field_of_study, r.start_year));
        await syncRows('consultant_projects', data.projects.filter(p => p.projectName.trim()).map(p => ({ id: p.id, project_name: p.projectName.trim(), client_industry: p.clientIndustry || null, sap_modules: [...new Set(p.sapModules)], description: p.description || null, duration_months: p.durationMonths, role: p.role || null })), savedRows.projects, r => projectKey(r.project_name));
        await queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
        setLoadedRevision(r => r + 1);
        toast.success(t('common.saved', 'Profile saved'));
        return;
      }

      // What the consultant already has: running the onboarding again must not add the same rows a second time (nothing that is saved is changed or removed).
      const [haveSkills, haveCertificates, haveJobs, haveStudies, haveProjects, haveSlots] = await Promise.all([
        supabase.from('consultant_skills').select('sap_module').eq('consultant_id', consultant.id),
        supabase.from('certifications').select('name, issuer, issue_date').eq('consultant_id', consultant.id),
        supabase.from('consultant_work_history').select('company_name, job_title, start_date').eq('consultant_id', consultant.id),
        supabase.from('consultant_education').select('institution, degree, field_of_study, start_year').eq('consultant_id', consultant.id),
        supabase.from('consultant_projects').select('project_name').eq('consultant_id', consultant.id),
        supabase.from('availability_slots').select('day_of_week, start_time, end_time').eq('consultant_id', consultant.id),
      ]);

      // Insert skills
      const newSkills = onlyNew(data.skills, haveSkills.data ?? [], s => skillKey(s.sapModule), x => skillKey(x.sap_module));
      if (newSkills.length > 0) {
        await supabase.from('consultant_skills').insert(
          newSkills.map(s => ({
            consultant_id: consultant.id,
            sap_module: s.sapModule,
            proficiency_level: s.proficiencyLevel,
            years_experience: s.yearsExperience,
            certified: s.certified,
          }))
        );
      }

      // Upload certifications (an empty form row and a certificate that the consultant already has are not saved)
      const newCertificates = onlyNew(data.certifications, haveCertificates.data ?? [], c => certificateKey(c.name, c.issuer, c.issueDate), x => certificateKey(x.name, x.issuer, x.issue_date));
      for (const cert of newCertificates) {
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
      const newJobs = onlyNew(data.workHistory, haveJobs.data ?? [], w => jobKey(w.companyName, w.jobTitle, w.startDate), x => jobKey(x.company_name, x.job_title, x.start_date));
      if (newJobs.length > 0) {
        await supabase.from('consultant_work_history').insert(
          newJobs.map(w => ({
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
      const newStudies = onlyNew(data.education, haveStudies.data ?? [], e => studyKey(e.institution, e.degree, e.fieldOfStudy, e.startYear), x => studyKey(x.institution, x.degree, x.field_of_study, x.start_year));
      if (newStudies.length > 0) {
        await supabase.from('consultant_education').insert(
          newStudies.map(e => ({
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
      const newProjects = onlyNew(data.projects, haveProjects.data ?? [], p => projectKey(p.projectName), x => projectKey(x.project_name));
      if (newProjects.length > 0) {
        await supabase.from('consultant_projects').insert(
          newProjects.map(p => ({
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
      const newSlots = onlyNew(data.availability, haveSlots.data ?? [], a => slotKey(a.dayOfWeek, a.startTime, a.endTime), x => slotKey(x.day_of_week, x.start_time, x.end_time));
      if (newSlots.length > 0) {
        await supabase.from('availability_slots').insert(
          newSlots.map(a => ({
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
      const failure = err as { code?: string; message?: string } | null;
      toast.error(failure?.code === '22023' && failure.message ? failure.message : t('onboarding.error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const canNext = () => {
    if (currentStep === 0) return true; // Import is always skippable
    if (currentStep === 1) {
      const linkedinOk = !data.linkedinUrl.trim() || !!normalizeLinkedinUrl(data.linkedinUrl);
      const credlyOk = !data.credlyUsername.trim() || !!normalizeCredlyUsername(data.credlyUsername);
      return data.displayName.trim().length > 0 && data.bio.trim().length > 0 && linkedinOk && credlyOk;
    }
    if (currentStep === 2) return data.skills.length > 0;
    return true;
  };

  const isLastContentStep = currentStep === STEP_COUNT - 2; // Availability is last before interview
  const isInterviewStep = currentStep === STEP_COUNT - 1;

  if (loading) return <div role="status" className="py-8 text-center text-muted-foreground">{t('common.loading')}</div>;

  if (embedded) return (
    <div className="space-y-8">
      <section id="profile-details" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('consultant_profile_hub.details')}</h2>
          <Button onClick={handleSaveAndContinue} disabled={submitting || isGuest}>{submitting ? t('common.loading') : t('common.save', 'Save')}</Button>
        </div>
        <ProfileStep data={data} onChange={updateData} />
      </section>
      <section id="expertise"><SapExpertiseCard key={`skills-${loadedRevision}`} /></section>
      <section id="experience"><ExperienceCvCard onProfileChanged={() => setLoadedRevision(r => r + 1)} /></section>
      <section id="certifications"><CertificationsStep data={data} onChange={updateData} /></section>
      <section id="education"><EducationStep data={data} onChange={updateData} /></section>
      <section id="projects"><ProjectsStep data={data} onChange={updateData} /></section>
      <div className="flex justify-end"><Button onClick={handleSaveAndContinue} disabled={submitting || isGuest}>{submitting ? t('common.loading') : t('common.save', 'Save')}</Button></div>
      <section id="availability" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('onboarding.availability')}</h2>
          <SetAvailabilityDialog trigger={<Button variant="outline">{t('onboarding.step_availability')}</Button>} />
        </div>
        {consultantId && <ProfileAvailability consultantId={consultantId} />}
      </section>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 px-1 pb-36 md:pb-6">
      {!embedded && <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('onboarding.subtitle')}</p>
      </div>}

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
             navigate(embedded ? '/consultant/profile' : '/consultant');
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
              <Button variant="ghost" size="sm"
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
              </Button>
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
               setTimeout(() => navigate(embedded ? '/consultant/profile' : '/consultant?welcome=true'), 1200);
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
