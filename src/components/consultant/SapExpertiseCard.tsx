import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cpu, Loader2, Plus, Save, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ALL_SAP_AREAS } from '@/lib/sapAreas';

export const SAP_ROLES = [
  ['functional', 'Functional consultant'],
  ['technical', 'Technical / developer (ABAP, Fiori)'],
  ['techno_functional', 'Techno-functional'],
  ['architect', 'Solution / enterprise architect'],
  ['basis', 'Basis / security / admin'],
  ['integration', 'Integration (CPI, PI/PO, BTP)'],
  ['data_analytics', 'Data & analytics (BW, SAC, Datasphere)'],
  ['project_manager', 'Project / program manager'],
] as const;

export const SENIORITY = [
  ['junior', 'Junior (0–3 yrs)'],
  ['mid', 'Mid-level (3–6 yrs)'],
  ['senior', 'Senior (6–10 yrs)'],
  ['lead', 'Lead (10–15 yrs)'],
  ['principal', 'Principal / expert (15+ yrs)'],
] as const;

const TECHNOLOGIES = [
  'S/4HANA On-Premise', 'S/4HANA Cloud Public', 'RISE / Private Cloud', 'ECC 6.0', 'HANA DB', 'ABAP', 'ABAP OO', 'ABAP RAP', 'CDS Views',
  'Fiori / UI5', 'BTP', 'CAP', 'Cloud Integration (CPI)', 'PI/PO', 'IDoc / EDI', 'OData', 'BW/4HANA', 'SAC', 'Datasphere',
  'Workflow', 'Adobe Forms', 'SmartForms', 'Solution Manager', 'Cloud ALM', 'GRC', 'Ariba', 'SuccessFactors', 'Concur', 'Signavio',
];

const LOCALIZATIONS = [
  'Saudi Arabia', 'United Arab Emirates', 'Egypt', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Jordan', 'Morocco', 'Algeria', 'Tunisia',
  'Turkey', 'Pakistan', 'India', 'Germany', 'United Kingdom', 'France', 'Italy', 'Spain', 'Netherlands', 'United States', 'Canada',
  'Brazil', 'Mexico', 'South Africa', 'Nigeria', 'Kenya', 'Singapore', 'Malaysia', 'Indonesia', 'China', 'Japan', 'Australia',
];

const PROJECT_TYPES = ['Greenfield implementation', 'Brownfield conversion', 'Selective data transition', 'Rollout', 'Upgrade', 'AMS / support', 'Optimization'];

type Skill = { id: string; sap_module: string; proficiency_level: number | null; years_experience: number | null };

function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export default function SapExpertiseCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<string>('');
  const [seniority, setSeniority] = useState<string>('');
  const [years, setYears] = useState<string>('');
  const [tech, setTech] = useState<string[]>([]);
  const [loc, setLoc] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [newModule, setNewModule] = useState('');
  const [newLevel, setNewLevel] = useState('3');
  const [newYears, setNewYears] = useState('');

  const loadSkills = async (uid: string) => {
    const { data } = await supabase.from('consultant_skills').select('id, sap_module, proficiency_level, years_experience').eq('consultant_id', uid).order('proficiency_level', { ascending: false });
    setSkills((data as Skill[]) || []);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return setLoading(false);
      const uid = session.user.id;
      setUserId(uid);
      const { data } = await supabase
        .from('consultants')
        .select('sap_role, seniority_level, total_sap_years, sap_technologies, localization_countries, project_types')
        .eq('id', uid)
        .maybeSingle();
      if (data) {
        setRole(data.sap_role ?? '');
        setSeniority(data.seniority_level ?? '');
        setYears(data.total_sap_years != null ? String(data.total_sap_years) : '');
        setTech(data.sap_technologies ?? []);
        setLoc(data.localization_countries ?? []);
        setTypes(data.project_types ?? []);
      }
      await loadSkills(uid);
      setLoading(false);
    });
  }, []);

  const moduleOptions = useMemo(() => {
    const have = new Set(skills.map((s) => s.sap_module.toLowerCase()));
    return ALL_SAP_AREAS.map((a) => a.name).filter((n) => !have.has(n.toLowerCase()));
  }, [skills]);

  const save = async () => {
    if (!userId) return;
    const y = years === '' ? null : Number(years);
    if (y !== null && (!Number.isInteger(y) || y < 0 || y > 50)) return toast.error('Years of SAP experience must be 0–50');
    setSaving(true);
    const { error } = await supabase.from('consultants').update({
      sap_role: role || null,
      seniority_level: seniority || null,
      total_sap_years: y,
      sap_technologies: tech,
      localization_countries: loc,
      project_types: types,
    }).eq('id', userId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('SAP expertise saved');
  };

  const addSkill = async () => {
    if (!userId || !newModule) return;
    const yrs = newYears === '' ? null : Math.max(0, Math.min(50, Math.round(Number(newYears))));
    const { error } = await supabase.from('consultant_skills').insert({ consultant_id: userId, sap_module: newModule, proficiency_level: Number(newLevel), years_experience: yrs });
    if (error) return toast.error(error.message);
    setNewModule(''); setNewYears(''); setNewLevel('3');
    loadSkills(userId);
  };

  const removeSkill = async (id: string) => {
    if (!userId) return;
    const { error } = await supabase.from('consultant_skills').delete().eq('id', id);
    if (error) return toast.error(error.message);
    loadSkills(userId);
  };

  if (loading) {
    return <Card className="rounded-2xl border-border/50"><CardContent className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Cpu className="h-4 w-4" /> SAP expertise</CardTitle>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Save className="h-4 w-4 me-1" />}Save</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue placeholder="Choose role" /></SelectTrigger>
              <SelectContent>{SAP_ROLES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Seniority level</Label>
            <Select value={seniority} onValueChange={setSeniority}>
              <SelectTrigger><SelectValue placeholder="Choose level" /></SelectTrigger>
              <SelectContent>{SENIORITY.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Total SAP experience (years)</Label>
            <Input type="number" min={0} max={50} value={years} onChange={(e) => setYears(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>SAP modules &amp; skill level</Label>
          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <Badge key={s.id} variant="secondary" className="gap-1.5 py-1 ps-2.5 pe-1">
                  {s.sap_module}
                  <span className="text-muted-foreground">· L{s.proficiency_level ?? '?'}{s.years_experience != null ? ` · ${s.years_experience}y` : ''}</span>
                  <button type="button" aria-label={`Remove ${s.sap_module}`} onClick={() => removeSkill(s.id)} className="rounded-full p-0.5 hover:bg-muted"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">No modules yet.</p>}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px]">
              <Select value={newModule} onValueChange={setNewModule}>
                <SelectTrigger><SelectValue placeholder="Add a module" /></SelectTrigger>
                <SelectContent className="max-h-72">{moduleOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Select value={newLevel} onValueChange={setNewLevel}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['1 Beginner', '2 Basic', '3 Proficient', '4 Advanced', '5 Expert'].map((l) => <SelectItem key={l} value={l[0]}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input className="w-24" type="number" min={0} max={50} placeholder="Years" value={newYears} onChange={(e) => setNewYears(e.target.value)} />
            <Button variant="outline" onClick={addSkill} disabled={!newModule}><Plus className="h-4 w-4 me-1" />Add</Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Technologies</Label>
          <Chips options={TECHNOLOGIES} value={tech} onChange={setTech} />
        </div>

        <div className="space-y-2">
          <Label>Localization experience (country versions)</Label>
          <p className="text-xs text-muted-foreground">Countries whose SAP localization you configured — tax, e-invoicing, payroll, legal reporting.</p>
          <Chips options={LOCALIZATIONS} value={loc} onChange={setLoc} />
        </div>

        <div className="space-y-2">
          <Label>Project types</Label>
          <Chips options={PROJECT_TYPES} value={types} onChange={setTypes} />
        </div>
      </CardContent>
    </Card>
  );
}
