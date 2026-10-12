import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Briefcase, Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import GroupedMultiSelect from '@/components/profile/GroupedMultiSelect';
import { profileCompleteness } from '@/lib/profileCompleteness';
import {
  CUSTOMER_SEGMENTS, DEPLOYMENT_EXPERIENCE, INDUSTRY_EXPERIENCE, LANGUAGE_LEVELS,
  LOCALIZATION_COUNTRIES, LOCALIZATION_SOLUTIONS, PROJECT_SCALE, PROJECT_TYPE_OPTIONS,
  VERTICAL_SOLUTIONS, WORKING_WEEK, WORK_MODES,
} from '@/lib/profileTaxonomy';

// The language code map of the onboarding ProfileStep is not exported, so the same 12 codes
// are kept here with their English names.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', ar: 'Arabic', de: 'German', fr: 'French', es: 'Spanish', hi: 'Hindi',
  ur: 'Urdu', zh: 'Chinese', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', tr: 'Turkish',
};

const COLUMNS = 'id, languages, industries, customer_segments, vertical_solutions, localization_countries, localization_solutions, project_types, deployment_experience, project_scale, work_modes, onsite_countries, working_week, language_levels, sap_roles, seniority_level, total_sap_years, sap_technologies';

type Row = {
  id: string;
  languages: string[] | null;
  industries: string[] | null;
  customer_segments: string[] | null;
  vertical_solutions: string[] | null;
  localization_countries: string[] | null;
  localization_solutions: string[] | null;
  project_types: string[] | null;
  deployment_experience: string[] | null;
  project_scale: string | null;
  work_modes: string[] | null;
  onsite_countries: string[] | null;
  working_week: string | null;
  language_levels: Record<string, string> | null;
  sap_roles: string[] | null;
  seniority_level: string | null;
  total_sap_years: number | null;
  sap_technologies: string[] | null;
};

export default function ProfileExperienceCard({ payoutReady = false }: { payoutReady?: boolean } = {}) {
  const [consultantId, setConsultantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [skillsCount, setSkillsCount] = useState(0);
  const [base, setBase] = useState<Row | null>(null);

  const [industries, setIndustries] = useState<string[]>([]);
  const [segments, setSegments] = useState<string[]>([]);
  const [verticals, setVerticals] = useState<string[]>([]);
  const [locCountries, setLocCountries] = useState<string[]>([]);
  const [locSolutions, setLocSolutions] = useState<string[]>([]);
  const [projectTypes, setProjectTypes] = useState<string[]>([]);
  const [deployment, setDeployment] = useState<string[]>([]);
  const [scale, setScale] = useState<string>('');
  const [workModes, setWorkModes] = useState<string[]>([]);
  const [workingWeek, setWorkingWeek] = useState<string>('');
  const [onsiteCountries, setOnsiteCountries] = useState<string[]>([]);
  const [languageLevels, setLanguageLevels] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return setLoading(false);
      const { data: me } = await supabase.from('consultants').select('id').eq('user_id', session.user.id).maybeSingle();
      if (!me) return setLoading(false);
      const cid = me.id;
      setConsultantId(cid);
      const [{ data }, { count }] = await Promise.all([
        supabase.from('consultants').select(COLUMNS).eq('id', cid).maybeSingle(),
        supabase.from('consultant_skills').select('id', { count: 'exact', head: true }).eq('consultant_id', cid),
      ]);
      setSkillsCount(count ?? 0);
      if (data) {
        const row = data as unknown as Row;
        setBase(row);
        setLanguages(row.languages ?? []);
        setIndustries(row.industries ?? []);
        setSegments(row.customer_segments ?? []);
        setVerticals(row.vertical_solutions ?? []);
        setLocCountries(row.localization_countries ?? []);
        setLocSolutions(row.localization_solutions ?? []);
        setProjectTypes(row.project_types ?? []);
        setDeployment(row.deployment_experience ?? []);
        setScale(row.project_scale ?? '');
        setWorkModes(row.work_modes ?? []);
        setWorkingWeek(row.working_week ?? '');
        setOnsiteCountries(row.onsite_countries ?? []);
        setLanguageLevels(row.language_levels ?? {});
      }
      setLoading(false);
    });
  }, []);

  const completeness = useMemo(() => profileCompleteness({
    sap_roles: base?.sap_roles,
    seniority_level: base?.seniority_level,
    total_sap_years: base?.total_sap_years,
    sap_technologies: base?.sap_technologies,
    skills_count: skillsCount,
    industries,
    customer_segments: segments,
    vertical_solutions: verticals,
    localization_countries: locCountries,
    localization_solutions: locSolutions,
    project_types: projectTypes,
    deployment_experience: deployment,
    project_scale: scale || null,
    work_modes: workModes,
    working_week: workingWeek || null,
    language_levels: languageLevels,
    payout_ready: payoutReady,
  }), [payoutReady, base, skillsCount, industries, segments, verticals, locCountries, locSolutions, projectTypes, deployment, scale, workModes, workingWeek, languageLevels]);

  const missing = completeness.items.filter((i) => !i.done).slice(0, 4);

  const save = async () => {
    if (!consultantId) return;
    setSaving(true);
    const { error } = await supabase.from('consultants').update({
      industries,
      customer_segments: segments,
      vertical_solutions: verticals,
      localization_countries: locCountries,
      localization_solutions: locSolutions,
      project_types: projectTypes,
      deployment_experience: deployment,
      project_scale: scale || null,
      work_modes: workModes,
      working_week: workingWeek || null,
      onsite_countries: onsiteCountries,
      language_levels: languageLevels,
    } as never).eq('id', consultantId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Experience saved');
  };

  if (loading) {
    return <Card className="rounded-2xl border-border/50"><CardContent className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Briefcase className="h-4 w-4" /> Industry, customer and solution experience</CardTitle>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Save className="h-4 w-4 me-1" />}Save</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Profile completeness: {completeness.percent}%</span>
            <span className="text-xs text-muted-foreground">{completeness.done}/{completeness.total}</span>
          </div>
          <Progress value={completeness.percent} />
          {missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Add these to be matched better:{' '}
              {missing.map((m, i) => (
                <span key={m.key} title={m.hint} className="underline decoration-dotted underline-offset-2">
                  {m.label}{i < missing.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Industries I worked in</Label>
          <GroupedMultiSelect groups={INDUSTRY_EXPERIENCE} value={industries} onChange={setIndustries} />
        </div>

        <div className="space-y-2">
          <Label>Customer segments I served</Label>
          <p className="text-xs text-muted-foreground">Government, semi-government, sovereign-fund-owned companies, large enterprises, SMEs and more: clients are matched by who you served before.</p>
          <GroupedMultiSelect groups={CUSTOMER_SEGMENTS} value={segments} onChange={setSegments} />
        </div>

        <div className="space-y-2">
          <Label>Vertical (industry) solutions</Label>
          <GroupedMultiSelect groups={VERTICAL_SOLUTIONS} value={verticals} onChange={setVerticals} />
        </div>

        <div className="space-y-2">
          <Label>Countries whose localization I configured</Label>
          <GroupedMultiSelect groups={LOCALIZATION_COUNTRIES} value={locCountries} onChange={setLocCountries} />
        </div>

        <div className="space-y-2">
          <Label>Localization solutions I delivered</Label>
          <p className="text-xs text-muted-foreground">For example e-invoicing, payroll, tax reporting and bank formats required by local law.</p>
          <GroupedMultiSelect groups={LOCALIZATION_SOLUTIONS} value={locSolutions} onChange={setLocSolutions} />
        </div>

        <div className="space-y-2">
          <Label>Project types</Label>
          <GroupedMultiSelect groups={[{ group: 'Project types', items: PROJECT_TYPE_OPTIONS }]} value={projectTypes} onChange={setProjectTypes} />
        </div>

        <div className="space-y-2">
          <Label>Deployment experience</Label>
          <GroupedMultiSelect groups={[{ group: 'Deployment experience', items: DEPLOYMENT_EXPERIENCE }]} value={deployment} onChange={setDeployment} />
        </div>

        <div className="space-y-2">
          <Label>Largest project I worked on</Label>
          <Select value={scale} onValueChange={setScale}>
            <SelectTrigger><SelectValue placeholder="Choose project size" /></SelectTrigger>
            <SelectContent>{PROJECT_SCALE.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label>How I work</Label>
          <div className="flex flex-wrap gap-4">
            {WORK_MODES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={workModes.includes(m)}
                  onCheckedChange={(v) => setWorkModes(v ? [...workModes, m] : workModes.filter((x) => x !== m))}
                />
                {m}
              </label>
            ))}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Working week</Label>
            <Select value={workingWeek} onValueChange={setWorkingWeek}>
              <SelectTrigger><SelectValue placeholder="Choose working week" /></SelectTrigger>
              <SelectContent>{WORKING_WEEK.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Countries where I can work on site (I hold or can get the work permit)</Label>
            <GroupedMultiSelect groups={LOCALIZATION_COUNTRIES} value={onsiteCountries} onChange={setOnsiteCountries} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Language levels</Label>
          {languages.length === 0 ? (
            <p className="text-xs text-muted-foreground">Add your languages in your profile first.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {languages.map((code) => (
                <div key={code}>
                  <Label className="text-xs text-muted-foreground">{LANGUAGE_NAMES[code] ?? code}</Label>
                  <Select
                    value={languageLevels[code] ?? ''}
                    onValueChange={(v) => setLanguageLevels((prev) => ({ ...prev, [code]: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose level" /></SelectTrigger>
                    <SelectContent>{LANGUAGE_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
