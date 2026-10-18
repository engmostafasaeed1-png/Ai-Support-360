import OnboardingSection from '@/components/consultant/saving/OnboardingSection';
import { useProfileAutosaveReady } from '@/hooks/useProfileAutosaveReady';
import { useProfileFieldRules } from '@/hooks/useProfileFieldRules';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Upload, User, Cpu, Award, Clock, Briefcase, GraduationCap, FolderKanban, Brain } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useQueryClient } from '@tanstack/react-query';
import SapExpertiseCard from '@/components/consultant/SapExpertiseCard';
import ProfileExperienceCard from '@/components/consultant/ProfileExperienceCard';
import { useMyPayoutDetails } from '@/hooks/useBilling';
import { payoutReady } from '@/lib/payoutDisclaimer';
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
import { cityPoint, countryPoint } from '@/lib/geo';
import { FieldGate } from '@/components/consultant/ProfileFieldRule';
import { CREDLY_HINT, LINKEDIN_HINT, normalizeCredlyUsername, normalizeLinkedinUrl } from '@/lib/consultantLinks';
import { OnboardingGuidePanel, OnboardingGuideAccordion, OnboardingMobileProgress, OnboardingWelcome, OnboardingFinish, welcomeSeen, markWelcomeSeen } from './OnboardingGuidePanel';
import { profileCompleteness } from '@/lib/profileCompleteness';
import { certificateKey, jobKey, onlyNew, projectKey, skillKey, slotKey, studyKey } from '@/lib/onboardingDedupe';
import { EmbeddedGuideCard, EmbeddedSetupMessages, useEmbeddedGuides } from './EmbeddedGuides';
import { FieldHint } from './OnboardingGuidePanel';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';

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

/** Applies freshly loaded values, keeping the current value of every field the user edited since the last load or save. */
export function mergeLoaded(current: OnboardingData, loaded: OnboardingData, dirty: ReadonlySet<string>): OnboardingData {
  const next = { ...loaded } as Record<string, unknown>;
  for (const key of dirty) if (key in current) next[key] = (current as unknown as Record<string, unknown>)[key];
  const merged = next as unknown as OnboardingData;
  return JSON.stringify(merged) === JSON.stringify(current) ? current : merged;
}

const stepIcons = [Upload, User, Cpu, Award, Briefcase, GraduationCap, FolderKanban, Clock, Brain];

export default function ConsultantOnboarding({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const autosaveReady = useProfileAutosaveReady();
  const fieldRules = useProfileFieldRules();
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const payoutQ = useMyPayoutDetails();
  const [loadedRevision, setLoadedRevision] = useState(0);
  // Bumped only by a finished CV import: the skills and experience cards remount to show the imported rows.
  const [importRevision, setImportRevision] = useState(0);
  const [savedRows, setSavedRows] = useState({ certifications: [] as string[], education: [] as string[], projects: [] as string[] });
  const { isGuest } = useGuestMode();
  const [searchParams] = useSearchParams();
  const initialStep = Math.min(Math.max(Number(searchParams.get('step')) || 0, 0), STEP_COUNT - 1);
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [data, setData] = useState<OnboardingData>(initialData);
  const [showWelcome, setShowWelcome] = useState(() => !embedded && !searchParams.has('step') && !welcomeSeen());
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [interviewDone, setInterviewDone] = useState(false);
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isGuest);
  const embeddedGuides = useEmbeddedGuides();
  const { data: loadedProfile } = useConsultantProfile();
  // The latest t is kept in a ref, so a language or translation update does not reload (and overwrite) the form.
  const tRef = useRef(t);
  tRef.current = t;
  // Fields the user changed since the last successful load or save; a reload keeps their typed values.
  const dirtyKeys = useRef(new Set<string>());

  useEffect(() => {
    if (isGuest) return;
    let active = true;
    const prefill = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [profileResult, consultantResult] = await Promise.all([
          supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
          supabase.from('consultants').select('id, bio, hourly_rate, currency, timezone, languages, city, country').eq('user_id', user.id).maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (consultantResult.error) throw consultantResult.error;
        const c = consultantResult.data;
        if (!active) return;
        if (!c) {
          setData(prev => mergeLoaded(prev, { ...prev, displayName: profileResult.data?.display_name || '' }, dirtyKeys.current));
          return;
        }
        const [skills, certificates, jobs, studies, projects, slots, privateDetails, contactLinks] = await Promise.all([
          supabase.from('consultant_skills').select('*').eq('consultant_id', c.id),
          supabase.from('certifications').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_work_history').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_education').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_projects').select('*').eq('consultant_id', c.id),
          supabase.from('availability_slots').select('*').eq('consultant_id', c.id),
          supabase.from('consultant_private').select('nationality').eq('consultant_id', c.id).maybeSingle(),
          // The links are read from the view of contact links (the consultant's own row).
          (supabase as any).from('consultant_contact_links').select('linkedin_url, github_url, personal_website, credly_username').eq('consultant_id', c.id).maybeSingle(),
        ]);
        for (const result of [skills, certificates, jobs, studies, projects, slots, privateDetails, contactLinks]) {
          if (result.error) throw result.error;
        }
        if (!active) return;
        setConsultantId(c.id);
        setSavedRows({ certifications: (certificates.data || []).map(x => x.id), education: (studies.data || []).map(x => x.id), projects: (projects.data || []).map(x => x.id) });
        const loaded: OnboardingData = {
          displayName: profileResult.data?.display_name || '', bio: c.bio || '',
          hourlyRate: Number(c.hourly_rate) || 0, currency: c.currency || 'USD',
          timezone: c.timezone || 'Asia/Riyadh', languages: c.languages || ['en'],
          nationality: privateDetails.data?.nationality || '', city: c.city || '', country: c.country || '',
          linkedinUrl: contactLinks.data?.linkedin_url || '', githubUrl: contactLinks.data?.github_url || '',
          personalWebsite: contactLinks.data?.personal_website || '', credlyUsername: contactLinks.data?.credly_username || '',
          skills: (skills.data || []).map(s => ({ sapModule: s.sap_module, proficiencyLevel: s.proficiency_level || 1, yearsExperience: s.years_experience || 0, certified: Boolean(s.certified) })),
          certifications: (certificates.data || []).map(s => ({ id: s.id, name: s.name, issuer: s.issuer || '', issueDate: s.issue_date || '', expiryDate: s.expiry_date || '' })),
          workHistory: (jobs.data || []).map(s => ({ companyName: s.company_name, jobTitle: s.job_title, startDate: s.start_date || '', endDate: s.end_date || '', description: s.description || '', isCurrent: Boolean(s.is_current) })),
          education: (studies.data || []).map(s => ({ id: s.id, institution: s.institution, degree: s.degree || '', fieldOfStudy: s.field_of_study || '', startYear: s.start_year, endYear: s.end_year })),
          projects: (projects.data || []).map(s => ({ id: s.id, projectName: s.project_name, clientIndustry: s.client_industry || '', sapModules: s.sap_modules || [], description: s.description || '', durationMonths: s.duration_months, role: s.role || '' })),
          availability: (slots.data || []).flatMap(s => s.day_of_week === null ? [] : [{ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time }]),
        };
        setData(prev => mergeLoaded(prev, loaded, dirtyKeys.current));
        setLoadSucceeded(true);
      } catch {
        toast.error(tRef.current('onboarding.error_generic'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void prefill();
    return () => { active = false; };
  }, [isGuest, loadedRevision]);

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
    for (const key of Object.keys(partial)) dirtyKeys.current.add(key);
    setData(prev => ({ ...prev, ...partial }));
  };

  // Browser autofill paints fields yellow and fills them without a React change event, so the form state
  // stays empty and a save would wipe the visible values. Read the real input values at save time.
  const autofilled = (selector: string, stateValue: string) => {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    return el && el.value !== stateValue ? el.value : stateValue;
  };

  const handleSaveAndContinue = async () => {
    if (isGuest) {
      setCurrentStep(STEP_COUNT - 1);
      return;
    }
    const displayName = autofilled('#displayName', data.displayName);
    const bio = autofilled('#bio', data.bio);
    const hourlyRate = Number(autofilled('#hourlyRate', String(data.hourlyRate))) || 0;
    const linkedinRaw = autofilled('input[aria-label="LinkedIn profile address"]', data.linkedinUrl);
    const credlyRaw = autofilled('input[aria-label="Credly username or profile address"]', data.credlyUsername);
    const githubRaw = autofilled('input[aria-label="GitHub profile address"]', data.githubUrl);
    const websiteRaw = autofilled('input[aria-label="Personal website address"]', data.personalWebsite);
    if (displayName !== data.displayName || bio !== data.bio || hourlyRate !== data.hourlyRate ||
        linkedinRaw !== data.linkedinUrl || credlyRaw !== data.credlyUsername ||
        githubRaw !== data.githubUrl || websiteRaw !== data.personalWebsite) {
      setData(prev => ({ ...prev, displayName, bio, hourlyRate, linkedinUrl: linkedinRaw, credlyUsername: credlyRaw, githubUrl: githubRaw, personalWebsite: websiteRaw }));
    }
    // Same rules as the database: a wrong LinkedIn or Credly value is shown here, before anything is saved.
    const linkedinUrl = linkedinRaw.trim() ? normalizeLinkedinUrl(linkedinRaw) : null;
    const credlyUsername = credlyRaw.trim() ? normalizeCredlyUsername(credlyRaw) : null;
    if ((linkedinRaw.trim() && !linkedinUrl) || (credlyRaw.trim() && !credlyUsername)) {
      toast.error(linkedinRaw.trim() && !linkedinUrl ? LINKEDIN_HINT : CREDLY_HINT);
      setCurrentStep(1);
      return;
    }
    // The place on the map is the centre of the chosen city (the database rounds it to about 1 km).
    // A city that is not in the list ("Other city") or no city: the centre of the country, so the consultant is still on the map.
    const place = (data.country && data.city ? cityPoint(data.country, data.city) : null) ?? (data.country ? countryPoint(data.country) : null);
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error(t('onboarding.error_auth')); return; }

      // Update or create profile
      const { error: profileError } = await supabase.from('profiles').upsert({
        user_id: user.id,
        display_name: displayName,
        onboarding_completed: true,
      }, { onConflict: 'user_id' });

      if (profileError) throw profileError;

      // Update the consultant record, or create it on the first save. An upsert (ON CONFLICT) cannot be used:
      // it needs read permission on every written column, and the contact-link columns are write-only for the consultant.
      const consultantValues = {
        user_id: user.id,
        bio,
        hourly_rate: hourlyRate,
        currency: data.currency,
        timezone: data.timezone,
        languages: data.languages,
        linkedin_url: linkedinUrl,
        credly_username: credlyUsername,
        github_url: githubRaw.trim() || null,
        personal_website: websiteRaw.trim() || null,
        city: data.city || null,
        country: data.country || null,
        latitude: place ? place.lat : null,
        longitude: place ? place.lng : null,
      };
      const { data: existingRow, error: lookupError } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (lookupError) throw lookupError;

      let consultantIdValue = existingRow?.id as string | undefined;
      if (consultantIdValue) {
        const { error } = await supabase.from('consultants').update(consultantValues).eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from('consultants').insert(consultantValues).select('id').single();
        if (error || !inserted) throw error;
        consultantIdValue = inserted.id;
      }
      const consultant = { id: consultantIdValue };
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
        dirtyKeys.current.clear();
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

  const sectionValues = (keys: (keyof OnboardingData)[]) => Object.fromEntries(keys.map(key => [key, data[key]]));
  const validateSection = (keys: (keyof OnboardingData)[]) => (_patch: Record<string, unknown>) => {
    const fields: Partial<Record<keyof OnboardingData, string>> = { displayName: 'display_name', bio: 'bio', hourlyRate: 'hourly_rate', nationality: 'nationality', city: 'city', country: 'country', timezone: 'timezone', languages: 'languages', linkedinUrl: 'linkedin_url', credlyUsername: 'credly_username', githubUrl: 'github_url', personalWebsite: 'personal_website', certifications: 'certifications', education: 'education', projects: 'projects' };
    for (const key of keys) {
      const field = fields[key]; const value = data[key];
      if (field && fieldRules.isRequired(field) && (value === null || value === '' || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length) || (key === 'hourlyRate' && Number(value) <= 0))) return t('profile_save.required', 'Complete the required fields in this section before saving.');
    }
    if (keys.includes('linkedinUrl') && data.linkedinUrl.trim() && !normalizeLinkedinUrl(data.linkedinUrl)) return LINKEDIN_HINT;
    if (keys.includes('credlyUsername') && data.credlyUsername.trim() && !normalizeCredlyUsername(data.credlyUsername)) return CREDLY_HINT;
    if (keys.includes('hourlyRate') && (!Number.isFinite(data.hourlyRate) || data.hourlyRate < 0)) return t('profile_save.rate_invalid', 'Enter a valid hourly rate.');
    if (keys.includes('certifications') && data.certifications.some(c => !c.name.trim() || (c.issueDate && c.expiryDate && c.expiryDate < c.issueDate))) return t('profile_save.rows_invalid', 'Complete each entry and check its dates before saving.');
    if (keys.includes('education') && data.education.some(e => !e.institution.trim() || (e.startYear && e.endYear && e.endYear < e.startYear))) return t('profile_save.rows_invalid', 'Complete each entry and check its dates before saving.');
    if (keys.includes('projects') && data.projects.some(p => !p.projectName.trim())) return t('profile_save.rows_invalid', 'Complete each entry and check its dates before saving.');
    return null;
  };
  const persistSection = async (patch: Record<string, unknown>) => {
    if (!loadSucceeded || !consultantId) throw new Error(t('onboarding.error_generic'));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error(t('onboarding.error_auth'));
    const check = (result: { error: unknown }) => { if (result.error) throw result.error; };
    if ('displayName' in patch) check(await supabase.from('profiles').update({ display_name: String(patch.displayName) }).eq('user_id', user.id));
    if ('nationality' in patch) check(await supabase.from('consultant_private').upsert({ consultant_id: consultantId, nationality: String(patch.nationality) || null }, { onConflict: 'consultant_id' }));
    const columns: Record<string, string> = { bio: 'bio', hourlyRate: 'hourly_rate', currency: 'currency', timezone: 'timezone', languages: 'languages', city: 'city', country: 'country', linkedinUrl: 'linkedin_url', credlyUsername: 'credly_username', githubUrl: 'github_url', personalWebsite: 'personal_website' };
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) if (columns[key]) values[columns[key]] = value;
    if ('linkedinUrl' in patch) values.linkedin_url = normalizeLinkedinUrl(String(patch.linkedinUrl)) || null;
    if ('credlyUsername' in patch) values.credly_username = normalizeCredlyUsername(String(patch.credlyUsername)) || null;
    if ('city' in patch || 'country' in patch) {
      const place = (data.country && data.city ? cityPoint(data.country, data.city) : null) ?? (data.country ? countryPoint(data.country) : null);
      values.latitude = place?.lat ?? null; values.longitude = place?.lng ?? null;
    }
    if (Object.keys(values).length) check(await supabase.from('consultants').update(values as never).eq('id', consultantId));
    const sync = async (table: 'certifications' | 'consultant_education' | 'consultant_projects', rows: { id?: string; [key: string]: unknown }[], original: string[]) => {
      const { data: existing, error } = await supabase.from(table).select('*').eq('consultant_id', consultantId);
      if (error) throw error;
      const ids: string[] = [];
      for (const row of rows) {
        const { id, ...values } = row;
        const before = existing?.find(x => x.id === id) as Record<string, unknown> | undefined;
        if (id) {
          const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(before?.[key]) !== JSON.stringify(value)));
          if (Object.keys(changed).length) check(await supabase.from(table).update(changed as never).eq('id', id).eq('consultant_id', consultantId));
          ids.push(id);
        } else {
          const { data: inserted, error } = await supabase.from(table).insert({ ...values, consultant_id: consultantId } as never).select('id').single();
          if (error || !inserted) throw error ?? new Error(t('onboarding.error_generic'));
          row.id = inserted.id; ids.push(inserted.id);
        }
      }
      const removed = original.filter(id => !rows.some(row => row.id === id));
      if (removed.length) check(await supabase.from(table).delete().in('id', removed).eq('consultant_id', consultantId));
      return ids;
    };
    if ('certifications' in patch) {
      const rows = [];
      for (const cert of patch.certifications as OnboardingData['certifications']) {
        let document_url: string | undefined;
        if (cert.file) { const path = `${user.id}/certifications/${Date.now()}-${safeFileName(cert.file.name)}`; check(await supabase.storage.from('consultant-documents').upload(path, cert.file)); document_url = path; }
        rows.push({ id: cert.id, name: cert.name.trim(), issuer: cert.issuer || null, issue_date: cert.issueDate || null, expiry_date: cert.expiryDate || null, ...(document_url ? { document_url } : {}) });
      }
      const ids = await sync('certifications', rows, savedRows.certifications);
      (patch.certifications as OnboardingData['certifications']).forEach((row, i) => { row.id = ids[i]; delete row.file; });
      setSavedRows(prev => ({ ...prev, certifications: ids }));
    }
    if ('education' in patch) {
      const draft = patch.education as OnboardingData['education'];
      const ids = await sync('consultant_education', draft.map(e => ({ id: e.id, institution: e.institution.trim(), degree: e.degree || null, field_of_study: e.fieldOfStudy || null, start_year: e.startYear, end_year: e.endYear })), savedRows.education);
      draft.forEach((row, i) => { row.id = ids[i]; }); setSavedRows(prev => ({ ...prev, education: ids }));
    }
    if ('projects' in patch) {
      const draft = patch.projects as OnboardingData['projects'];
      const ids = await sync('consultant_projects', draft.map(p => ({ id: p.id, project_name: p.projectName.trim(), client_industry: p.clientIndustry || null, sap_modules: [...new Set(p.sapModules)], description: p.description || null, duration_months: p.durationMonths, role: p.role || null })), savedRows.projects);
      draft.forEach((row, i) => { row.id = ids[i]; }); setSavedRows(prev => ({ ...prev, projects: ids }));
    }
    // A completed snapshot only clears keys which have not changed while the request was running.
    for (const [key, value] of Object.entries(patch)) if (JSON.stringify(latestData.current[key as keyof OnboardingData]) === JSON.stringify(value)) dirtyKeys.current.delete(key);
    await queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
  };
  const latestData = useRef(data); latestData.current = data;
  const section = (keys: (keyof OnboardingData)[], children: React.ReactNode, manual = false) => <OnboardingSection values={sectionValues(keys)} automatic={!manual && autosaveReady.data === true} disabled={isGuest || !loadSucceeded || fieldRules.isLoading} persist={persistSection} validate={validateSection(keys)}>{children}</OnboardingSection>;

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
    <div className="space-y-8" onBlurCapture={() => {
      const partial: Partial<OnboardingData> = {};
      const selectors: Partial<Record<keyof OnboardingData, string>> = { displayName: '#displayName', bio: '#bio', hourlyRate: '#hourlyRate', linkedinUrl: 'input[aria-label="LinkedIn profile address"]', credlyUsername: 'input[aria-label="Credly username or profile address"]', githubUrl: 'input[aria-label="GitHub profile address"]', personalWebsite: 'input[aria-label="Personal website address"]' };
      for (const [key, selector] of Object.entries(selectors)) {
        const k = key as keyof OnboardingData; const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
        if (!el) continue;
        const value = k === 'hourlyRate' ? Number(el.value) : el.value;
        if (value !== data[k]) Object.assign(partial, { [k]: value });
      }
      if (Object.keys(partial).length) updateData(partial);
    }}>
      {autosaveReady.data !== true && <p role="status" className="text-xs text-muted-foreground">{t('profile_save.setup_pending', 'Automatic saving is not active yet. Use Save to keep your changes.')}</p>}
      <EmbeddedSetupMessages data={{ ...data, interviewDone: !!loadedProfile?.ai_interview_completed_at }} userId={loadedProfile?.user_id} />
      <section id="profile-details" className="space-y-4">
        <EmbeddedGuideCard section="profile-details" stepKey="profile" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('consultant_profile_hub.details')}</h2>

        </div>
        <ProfileStep data={data} onChange={updateData} renderSection={section} />
      </section>
      <FieldGate field={['skills', 'sap_role', 'seniority_level', 'total_sap_years', 'sap_roles', 'sap_technologies']}><section id="expertise"><EmbeddedGuideCard section="expertise" stepKey="skills" /><SapExpertiseCard key={`skills-${importRevision}`} onProfileChanged={() => setLoadedRevision(r => r + 1)} /></section></FieldGate>
      <section id="profile-experience"><EmbeddedGuideCard section="profile-experience" stepKey="projects" /><ProfileExperienceCard key={`experience-${importRevision}`} payoutReady={payoutReady(payoutQ.data?.details)} onCompletenessChange={embeddedGuides.setCompleteness} /></section>
      <FieldGate field={['work_history', 'cv']}><section id="experience"><EmbeddedGuideCard section="experience" stepKey="work" /><ExperienceCvCard onProfileChanged={() => { setImportRevision(r => r + 1); setLoadedRevision(r => r + 1); }} /></section></FieldGate>
      <FieldGate field="certifications"><section id="certifications"><EmbeddedGuideCard section="certifications" stepKey="certifications" />{section(['certifications'], <><p className="text-xs text-muted-foreground">{t('profile_save.cert_manual', 'Certificate changes require another verification check. Save them manually.')}</p><CertificationsStep data={data} onChange={updateData} /></>, true)}</section></FieldGate>
      <FieldGate field="education"><section id="education"><EmbeddedGuideCard section="education" stepKey="education" />{section(['education'], <EducationStep data={data} onChange={updateData} />)}</section></FieldGate>
      <FieldGate field="projects"><section id="projects"><EmbeddedGuideCard section="projects" stepKey="projects" />{section(['projects'], <ProjectsStep data={data} onChange={updateData} />)}</section></FieldGate>

      <FieldGate field="availability"><section id="availability" className="space-y-4">
        <EmbeddedGuideCard section="availability" stepKey="availability" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('onboarding.availability')}<FieldHint field="availability" /></h2>
          <SetAvailabilityDialog onSaved={() => setLoadedRevision(r => r + 1)} trigger={<Button variant="outline">{t('onboarding.step_availability')}</Button>} />
        </div>
        {consultantId && <ProfileAvailability consultantId={consultantId} />}
      </section></FieldGate>
    </div>
  );

  const skipOnboarding = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ onboarding_completed: true }).eq('user_id', user.id);
      }
    } catch {}
    navigate(embedded ? '/consultant/profile' : '/consultant');
  };

  if (showWelcome) {
    return (
      <div className="px-1 py-4">
        <OnboardingWelcome
          onStart={() => { markWelcomeSeen(); setShowWelcome(false); }}
          onSkip={() => { markWelcomeSeen(); void skipOnboarding(); }}
        />
      </div>
    );
  }

  if (finished) {
    return (
      <div className="px-1 py-4">
        <OnboardingFinish onTour={() => navigate('/consultant?welcome=true')} />
      </div>
    );
  }

  const strength = profileCompleteness({
    skills_count: data.skills.length,
    industries: data.projects.map(p => p.clientIndustry).filter(Boolean),
    project_types: data.projects.length > 0 ? ['project'] : [],
    language_levels: data.languages.length > 0 ? Object.fromEntries(data.languages.map(l => [l, 'set'])) : {},
  }).percent;

  return (
    <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start px-1">
    <div className="max-w-2xl w-full mx-auto space-y-6 pb-36 md:pb-6 lg:pb-6">
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
          onClick={skipOnboarding}
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

      <div className="lg:hidden"><OnboardingGuideAccordion stepIndex={currentStep} /></div>

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
              if (embedded) setTimeout(() => navigate('/consultant/profile'), 1200);
              else setFinished(true);
            }}
            className="gap-1.5"
          >
            Finish Setup
          </Button>
        </div>
      )}
    </div>
    <aside className="hidden lg:block"><OnboardingGuidePanel stepIndex={currentStep} strength={strength} /></aside>
    <OnboardingMobileProgress stepIndex={currentStep} />
    </div>
  );
}
