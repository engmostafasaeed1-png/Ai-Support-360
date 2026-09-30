import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Upload, FileText, Loader2, Sparkles, X, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useGuestMode } from '@/contexts/GuestModeContext';
import type { OnboardingData } from '../ConsultantOnboarding';

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

export default function ImportStep({ data, onChange }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [importing, setImporting] = useState<'cv' | null>(null);
  const [imported, setImported] = useState<'cv' | null>(null);

  const applyProfile = (profile: any) => {
    const partial: Partial<OnboardingData> = {};
    if (profile.display_name) partial.displayName = profile.display_name;
    if (profile.bio) partial.bio = profile.bio;
    if (profile.hourly_rate) partial.hourlyRate = profile.hourly_rate;
    if (profile.nationality) partial.nationality = profile.nationality;
    if (profile.city) partial.city = profile.city;
    if (profile.country) partial.country = profile.country;
    if (profile.languages?.length) partial.languages = profile.languages;
    if (profile.linkedin_url) partial.linkedinUrl = profile.linkedin_url;
    if (profile.github_url) partial.githubUrl = profile.github_url;
    if (profile.personal_website) partial.personalWebsite = profile.personal_website;

    if (profile.skills?.length) {
      partial.skills = profile.skills.map((s: any) => ({
        sapModule: s.sap_module || s.sapModule || '',
        proficiencyLevel: s.proficiency_level || s.proficiencyLevel || 3,
        yearsExperience: s.years_experience || s.yearsExperience || 1,
        certified: s.certified || false,
      }));
    }
    if (profile.certifications?.length) {
      partial.certifications = profile.certifications.map((c: any) => ({
        name: c.name || '',
        issuer: c.issuer || '',
        issueDate: c.issue_date || c.issueDate || '',
        expiryDate: c.expiry_date || c.expiryDate || '',
      }));
    }
    if (profile.work_history?.length) {
      partial.workHistory = profile.work_history.map((w: any) => ({
        companyName: w.company_name || w.companyName || '',
        jobTitle: w.job_title || w.jobTitle || '',
        startDate: w.start_date || w.startDate || '',
        endDate: w.end_date || w.endDate || '',
        description: w.description || '',
        isCurrent: w.is_current || w.isCurrent || false,
      }));
    }
    if (profile.education?.length) {
      partial.education = profile.education.map((e: any) => ({
        institution: e.institution || '',
        degree: e.degree || '',
        fieldOfStudy: e.field_of_study || e.fieldOfStudy || '',
        startYear: e.start_year || e.startYear || null,
        endYear: e.end_year || e.endYear || null,
      }));
    }
    if (profile.projects?.length) {
      partial.projects = profile.projects.map((p: any) => ({
        projectName: p.project_name || p.projectName || '',
        clientIndustry: p.client_industry || p.clientIndustry || '',
        sapModules: p.sap_modules || p.sapModules || [],
        description: p.description || '',
        durationMonths: p.duration_months || p.durationMonths || null,
        role: p.role || '',
      }));
    }
    onChange(partial);
  };

  const handleCVUpload = async (file: File) => {
    if (isGuest) {
      toast.success('Demo: CV parsed successfully!');
      setImported('cv');
      // Apply mock data
      applyProfile({
        display_name: 'Ahmed Al-Rashid',
        bio: 'Senior SAP S/4HANA consultant with 12+ years of experience in Finance and Controlling modules across oil & gas, banking, and telecom industries.',
        nationality: 'Saudi',
        city: 'Riyadh',
        country: 'Saudi Arabia',
        languages: ['en', 'ar'],
        skills: [
          { sap_module: 'SAP S/4HANA', proficiency_level: 5, years_experience: 12, certified: true },
          { sap_module: 'SAP FI/CO', proficiency_level: 5, years_experience: 10, certified: true },
        ],
        certifications: [
          { name: 'SAP Certified Application Associate - S/4HANA Finance', issuer: 'SAP', issue_date: '2023-06-15' },
        ],
        work_history: [
          { company_name: 'Accenture', job_title: 'Senior SAP Consultant', start_date: '2020-01-01', is_current: true, description: 'Lead S/4HANA implementation projects for Fortune 500 clients' },
          { company_name: 'Deloitte', job_title: 'SAP Consultant', start_date: '2014-03-01', end_date: '2019-12-31', description: 'FI/CO module configuration and customization' },
        ],
        education: [
          { institution: 'King Saud University', degree: 'BSc', field_of_study: 'Computer Science', start_year: 2008, end_year: 2012 },
        ],
        projects: [
          { project_name: 'ARAMCO S/4HANA Migration', client_industry: 'Oil & Gas', sap_modules: ['SAP S/4HANA', 'SAP FI/CO'], description: 'Full greenfield S/4HANA implementation', duration_months: 18, role: 'Lead Consultant' },
        ],
      });
      return;
    }

    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
      toast.error('Please upload a plain-text (.txt) file. For PDF or Word CVs, copy the text into a .txt file first.');
      return;
    }
    if (file.size > 300 * 1024) {
      toast.error('Please choose a CV text file smaller than 300 KB.');
      return;
    }
    setImporting('cv');
    try {
      // Read file as text
      const text = await file.text();
      const { data: result, error } = await supabase.functions.invoke('parse-cv', {
        body: { cv_text: text },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      applyProfile(result.profile);
      setImported('cv');
      toast.success('CV parsed! Review and edit the pre-filled data.');
    } catch (err: any) {
      console.error('CV parse error:', err);
      toast.error(err.message || 'Failed to parse CV');
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center space-y-1.5 mb-2">
        <Sparkles className="w-8 h-8 text-primary mx-auto" />
        <h3 className="font-semibold text-lg">Quick Profile Import</h3>
        <p className="text-sm text-muted-foreground">
          Speed up your setup by importing from your CV. You can review and edit everything afterward.
        </p>
      </div>

      {/* CV Upload */}
      <Card className="p-4 space-y-3 border-2 border-dashed border-border hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1">
            <h4 className="font-medium text-sm">Upload CV / Resume</h4>
            <p className="text-xs text-muted-foreground">Upload your CV as a plain-text (.txt) file — AI will extract your details. For PDF or Word CVs, copy the text into a .txt file first.</p>
          </div>
          {imported === 'cv' && <Check className="w-5 h-5 text-green-500" />}
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <input
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleCVUpload(f);
              }}
              disabled={importing !== null}
            />
            <Button
              variant="outline"
              className="w-full gap-2"
              asChild
              disabled={importing !== null}
            >
              <span>
                {importing === 'cv' ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Parsing...</>
                ) : (
                  <><Upload className="w-4 h-4" /> Choose File</>
                )}
              </span>
            </Button>
          </label>
        </div>
      </Card>

      <p className="text-xs text-center text-muted-foreground">
        You can skip this step and fill in your details manually →
      </p>
    </div>
  );
}
