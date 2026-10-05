import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { onlyNew, skillKey, certificateKey, jobKey, studyKey, projectKey } from '@/lib/onboardingDedupe';

export type ParsedCv = {
  bio?: string | null;
  skills?: { sap_module: string; proficiency_level?: number; years_experience?: number; certified?: boolean }[];
  certifications?: { name: string; issuer?: string | null; issue_date?: string | null; expiry_date?: string | null }[];
  work_history?: { company_name: string; job_title: string; start_date?: string | null; end_date?: string | null; description?: string | null; is_current?: boolean }[];
  education?: { institution: string; degree?: string | null; field_of_study?: string | null; start_year?: number | null; end_year?: number | null }[];
  projects?: { project_name: string; client_industry?: string | null; sap_modules?: string[]; description?: string | null; duration_months?: number | null; role?: string | null }[];
};

type Section = 'bio' | 'skills' | 'certifications' | 'work_history' | 'education' | 'projects';
const LABELS: Record<Section, string> = {
  bio: 'Professional summary',
  skills: 'Skills',
  certifications: 'Certifications',
  work_history: 'Experience',
  education: 'Education',
  projects: 'Projects',
};

const d = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);

export default function CvImportDialog({
  open, onOpenChange, userId, data, onApplied,
}: { open: boolean; onOpenChange: (o: boolean) => void; userId: string; data: ParsedCv | null; onApplied: () => void }) {
  const [pick, setPick] = useState<Record<Section, boolean>>({ bio: true, skills: true, certifications: true, work_history: true, education: true, projects: true });
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setBio(data?.bio ?? ''); }, [data]);
  if (!data) return null;

  const counts: Record<Section, number> = {
    bio: data.bio ? 1 : 0,
    skills: data.skills?.filter((s) => s.sap_module).length ?? 0,
    certifications: data.certifications?.filter((c) => c.name).length ?? 0,
    work_history: data.work_history?.filter((w) => w.company_name && w.job_title).length ?? 0,
    education: data.education?.filter((e) => e.institution).length ?? 0,
    projects: data.projects?.filter((p) => p.project_name).length ?? 0,
  };

  const apply = async () => {
    setSaving(true);
    try {
      const errs: string[] = [];
      const run = async (label: string, p: PromiseLike<{ error: any }>) => { const { error } = await p; if (error) errs.push(`${label}: ${error.message}`); };

      if (pick.bio && bio.trim()) await run('Summary', supabase.from('consultants').update({ bio: bio.trim().slice(0, 2000) }).eq('id', userId));

      if (pick.skills && counts.skills) {
        const { data: ex } = await supabase.from('consultant_skills').select('sap_module').eq('consultant_id', userId);
        const rows = onlyNew(data.skills!.filter((s) => s.sap_module), ex || [], (r) => skillKey(r.sap_module), (r) => skillKey(r.sap_module))
          .map((s) => ({ consultant_id: userId, sap_module: s.sap_module.slice(0, 120), proficiency_level: Math.min(5, Math.max(1, n(s.proficiency_level) ?? 3)), years_experience: n(s.years_experience), certified: !!s.certified }));
        if (rows.length) await run('Skills', supabase.from('consultant_skills').insert(rows));
      }
      if (pick.certifications && counts.certifications) {
        const { data: ex } = await supabase.from('certifications').select('name, issuer, issue_date').eq('consultant_id', userId);
        const rows = onlyNew(data.certifications!.filter((c) => c.name), ex || [], (r) => certificateKey(r.name, r.issuer, d(r.issue_date)), (r) => certificateKey(r.name, r.issuer, r.issue_date))
          .map((c) => ({ consultant_id: userId, name: c.name.slice(0, 200), issuer: c.issuer ?? null, issue_date: d(c.issue_date), expiry_date: d(c.expiry_date) }));
        if (rows.length) await run('Certifications', supabase.from('certifications').insert(rows));
      }
      if (pick.work_history && counts.work_history) {
        const { data: ex } = await supabase.from('consultant_work_history').select('company_name, job_title, start_date').eq('consultant_id', userId);
        const rows = onlyNew(data.work_history!.filter((w) => w.company_name && w.job_title), ex || [], (r) => jobKey(r.company_name, r.job_title, d(r.start_date)), (r) => jobKey(r.company_name, r.job_title, r.start_date))
          .map((w) => ({ consultant_id: userId, company_name: w.company_name.slice(0, 120), job_title: w.job_title.slice(0, 120), start_date: d(w.start_date), end_date: w.is_current ? null : d(w.end_date), is_current: !!w.is_current, description: w.description?.slice(0, 2000) || null }));
        if (rows.length) await run('Experience', supabase.from('consultant_work_history').insert(rows));
      }
      if (pick.education && counts.education) {
        const { data: ex } = await supabase.from('consultant_education').select('institution, degree, field_of_study, start_year').eq('consultant_id', userId);
        const rows = onlyNew(data.education!.filter((e) => e.institution), ex || [], (r) => studyKey(r.institution, r.degree, r.field_of_study, n(r.start_year)), (r) => studyKey(r.institution, r.degree, r.field_of_study, r.start_year))
          .map((e) => ({ consultant_id: userId, institution: e.institution.slice(0, 200), degree: e.degree ?? null, field_of_study: e.field_of_study ?? null, start_year: n(e.start_year), end_year: n(e.end_year) }));
        if (rows.length) await run('Education', supabase.from('consultant_education').insert(rows));
      }
      if (pick.projects && counts.projects) {
        const { data: ex } = await supabase.from('consultant_projects').select('project_name').eq('consultant_id', userId);
        const rows = onlyNew(data.projects!.filter((p) => p.project_name), ex || [], (r) => projectKey(r.project_name), (r) => projectKey(r.project_name))
          .map((p) => ({ consultant_id: userId, project_name: p.project_name.slice(0, 200), client_industry: p.client_industry ?? null, sap_modules: Array.isArray(p.sap_modules) ? p.sap_modules.slice(0, 12) : [], description: p.description?.slice(0, 2000) || null, duration_months: n(p.duration_months), role: p.role ?? null }));
        if (rows.length) await run('Projects', supabase.from('consultant_projects').insert(rows));
      }

      if (errs.length) toast.error(errs.join(' · '));
      else toast.success('Profile updated from your CV');
      onApplied();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fill your profile from your CV</DialogTitle>
          <DialogDescription>Choose what to add. Items you already have are skipped, nothing is overwritten except the summary.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(Object.keys(LABELS) as Section[]).map((s) => (
            <div key={s} className="rounded-xl border border-border/60 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={pick[s] && counts[s] > 0} disabled={!counts[s]} onCheckedChange={(v) => setPick({ ...pick, [s]: !!v })} />
                {LABELS[s]} <span className="text-muted-foreground font-normal">({counts[s] || 'none found'})</span>
              </label>
              {s === 'bio' && counts.bio > 0 && pick.bio && (
                <Textarea className="mt-2" rows={4} maxLength={2000} value={bio} onChange={(e) => setBio(e.target.value)} />
              )}
              {s === 'work_history' && counts.work_history > 0 && (
                <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                  {data.work_history!.slice(0, 6).map((w, i) => <li key={i}>{w.job_title} — {w.company_name}</li>)}
                </ul>
              )}
              {s === 'skills' && counts.skills > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">{data.skills!.map((x) => x.sap_module).join(', ')}</p>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={saving}>{saving && <Loader2 className="h-4 w-4 me-1 animate-spin" />}Add to my profile</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
