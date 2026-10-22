import { useSectionAutosave } from '@/hooks/useSectionAutosave';
import { useProfileAutosaveReady } from '@/hooks/useProfileAutosaveReady';
import { useProfileSavePrompt } from './saving/ProfileImportance';
import SectionSaveControls from './saving/SectionSaveControls';
import { useProfileFieldRules } from '@/hooks/useProfileFieldRules';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cpu, Loader2, Plus, Save, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ALL_SAP_AREAS } from '@/lib/sapAreas';
import { FieldHint } from './onboarding/OnboardingGuidePanel';
import { useTranslation } from 'react-i18next';
import { cleanVersion, isNotAppliedError, MAX_VERSION_LENGTH, versionChoices } from '@/lib/interviewKnowledge';
import { useVersionOptions } from '@/hooks/useInterviewKnowledge';

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

type Skill = { id: string; sap_module: string; proficiency_level: number | null; years_experience: number | null; sap_version?: string | null };

function Chips({ options, value, onChange, otherPlaceholder = 'Add another…' }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void; otherPlaceholder?: string }) {
  const [custom, setCustom] = useState('');
  const extras = value.filter((v) => !options.includes(v));
  const add = () => {
    const parts = custom.split(',').map((x) => x.trim().slice(0, 80)).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setCustom('');
  };
  const chip = (o: string, on: boolean) => (
    <button
      key={o}
      type="button"
      aria-pressed={on}
      onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/50'}`}
    >
      {o}{on && extras.includes(o) && <X className="inline h-3 w-3 ms-1" />}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => chip(o, value.includes(o)))}
        {extras.map((o) => chip(o, true))}
      </div>
      <div className="flex gap-2 max-w-md">
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={otherPlaceholder}
          className="h-8 text-xs"
          maxLength={300}
        />
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={add} disabled={!custom.trim()}><Plus className="h-3.5 w-3.5 me-1" />Add</Button>
      </div>
    </div>
  );
}

export default function SapExpertiseCard({ onProfileChanged }: { onProfileChanged?: () => void } = {}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<string>('');
  const [years, setYears] = useState<string>('');
  const [tech, setTech] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [moduleQuery, setModuleQuery] = useState('');
  const [customModule, setCustomModule] = useState('');
  const [newLevel, setNewLevel] = useState('3');
  const [newYears, setNewYears] = useState('');

  const knownSkillIds = useRef<string[]>([]);
  // Optional version / release per module (docs/sql/interview-knowledge.sql); hidden until that column exists.
  const [versionSupported, setVersionSupported] = useState(false);
  const knownVersions = useRef<Map<string, string | null>>(new Map());
  const versionRows = useVersionOptions();
  const { t } = useTranslation();
  const loadSkills = async (uid: string) => {
    const withVersion = await (supabase as any).from('consultant_skills').select('id, sap_module, proficiency_level, years_experience, sap_version').eq('consultant_id', uid).order('proficiency_level', { ascending: false });
    let data = withVersion.data as Skill[] | null;
    if (withVersion.error) {
      if (!isNotAppliedError(withVersion.error)) throw withVersion.error;
      const plain = await supabase.from('consultant_skills').select('id, sap_module, proficiency_level, years_experience').eq('consultant_id', uid).order('proficiency_level', { ascending: false });
      if (plain.error) throw plain.error;
      data = plain.data as Skill[];
      setVersionSupported(false);
    } else setVersionSupported(true);
    knownSkillIds.current = (data ?? []).map(row => row.id);
    knownVersions.current = new Map((data ?? []).map(row => [row.id, row.sap_version ?? null]));
    setSkills(data || []);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return setLoading(false);
      const { data: me } = await supabase.from('consultants').select('id').eq('user_id', session.user.id).maybeSingle();
      if (!me) return setLoading(false);
      const uid = me.id;
      setUserId(uid);
      const { data, error } = await supabase
        .from('consultants')
        .select('sap_role, sap_roles, seniority_level, total_sap_years, sap_technologies')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const labelOf = (k: string) => SAP_ROLES.find(([v]) => v === k)?.[1] ?? k;
        const r = data.sap_roles?.length ? data.sap_roles : data.sap_role ? [data.sap_role] : [];
        setRoles(r.map(labelOf));
        setSeniority(data.seniority_level ?? '');
        setYears(data.total_sap_years != null ? String(data.total_sap_years) : '');
        setTech(data.sap_technologies ?? []);
      }
      await loadSkills(uid);
      setLoadSucceeded(!!data);
      setLoading(false);
    }).catch(error => { setLoadError(error.message); setLoading(false); });
  }, []);

  const moduleOptions = useMemo(() => {
    const have = new Set(skills.map((s) => s.sap_module.toLowerCase()));
    const q = moduleQuery.trim().toLowerCase();
    return ALL_SAP_AREAS.map((a) => a.name).filter((n) => !have.has(n.toLowerCase()) && (!q || n.toLowerCase().includes(q)));
  }, [skills, moduleQuery]);

  const automatic = useProfileAutosaveReady();
  const rules = useProfileFieldRules();
  const beforeManual = useProfileSavePrompt();
  const values = { sap_roles: roles, seniority_level: seniority || null, total_sap_years: years === '' ? null : Number(years), sap_technologies: tech };
  const state = useSectionAutosave({ values, ready: !loading && loadSucceeded && !!userId && !rules.isLoading, automatic: automatic.data === true, beforeManual,
    validate: patch => {
      const y = values.total_sap_years;
      if (y !== null && (!Number.isInteger(y) || y < 0 || y > 50)) return 'Years of SAP experience must be 0–50';
      if (Object.entries(patch).some(([key, value]) => rules.isRequired(key) && (value === null || value === '' || (Array.isArray(value) && !value.length)))) return 'Complete the required fields in this section before saving.';
      return null;
    },
    persist: async patch => {
      if (!userId) throw new Error('Your consultant profile could not be found.');
      const payload = { ...patch, ...('sap_roles' in patch ? { sap_role: SAP_ROLES.find(([, label]) => label === roles[0])?.[0] ?? null } : {}) };
      const { error } = await supabase.from('consultants').update(payload as never).eq('id', userId);
      if (error) { toast.error(error.message); throw error; }
      onProfileChanged?.();
    },
  });


  const moduleState = useSectionAutosave({ values: { skills }, ready: !loading && loadSucceeded && !!userId && !rules.isLoading, automatic: automatic.data === true, beforeManual,
    validate: () => {
      if (rules.isRequired('skills') && !skills.length) return 'Complete the required fields in this section before saving.';
      if (skills.some(skill => !skill.sap_module.trim() || (skill.years_experience !== null && (!Number.isFinite(skill.years_experience) || skill.years_experience < 0 || skill.years_experience > 50)))) return 'Years of SAP experience must be 0–50';
      return null;
    },
    persist: async patch => {
      if (!userId) throw new Error('Your consultant profile could not be found.');
      const sent = patch.skills ?? [];
      for (const row of sent) {
        if (row.id.startsWith('new-')) {
          const { data: inserted, error } = await supabase.from('consultant_skills').upsert({ consultant_id: userId, sap_module: row.sap_module, proficiency_level: row.proficiency_level, years_experience: row.years_experience, ...(versionSupported ? { sap_version: cleanVersion(row.sap_version) } : {}) } as never, { onConflict: 'consultant_id,sap_module' }).select('id').single();
          if (error || !inserted) throw error ?? new Error('Could not save changes. Try again.');
          const localId = row.id; row.id = inserted.id;
          knownVersions.current.set(inserted.id, cleanVersion(row.sap_version));
          setSkills(current => current.map(item => item.id === localId ? { ...item, id: inserted.id } : item));
        } else if (versionSupported && cleanVersion(row.sap_version) !== (knownVersions.current.get(row.id) ?? null)) {
          const next = cleanVersion(row.sap_version);
          const { error } = await (supabase as any).from('consultant_skills').update({ sap_version: next }).eq('id', row.id).eq('consultant_id', userId);
          if (error) throw error;
          knownVersions.current.set(row.id, next);
        }
      }
      const removed = knownSkillIds.current.filter(id => !sent.some(item => item.id === id));
      if (removed.length) { const { error } = await supabase.from('consultant_skills').delete().in('id', removed).eq('consultant_id', userId); if (error) throw error; }
      knownSkillIds.current = sent.map(row => row.id);
      onProfileChanged?.();
    },
  });
  const addSkills = () => {
    const have = new Set(skills.map(s => s.sap_module.toLowerCase()));
    const names = [...picked, ...customModule.split(',').map(x => x.trim().slice(0, 120))].filter(Boolean).filter((n, i, list) => list.findIndex(x => x.toLowerCase() === n.toLowerCase()) === i && !have.has(n.toLowerCase()));
    const yrs = newYears === '' ? null : Number(newYears);
    setSkills(current => [...current, ...names.map((name, i) => ({ id: `new-${Date.now()}-${i}`, sap_module: name, proficiency_level: Number(newLevel), years_experience: yrs }))]);
    setPicked([]); setCustomModule(''); setNewYears(''); setNewLevel('3'); setModuleQuery('');
  };
  const removeSkill = (id: string) => setSkills(current => current.filter(skill => skill.id !== id));

  if (loading) {
    return <Card className="rounded-2xl border-border/50"><CardContent className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Cpu className="h-4 w-4" /> SAP expertise</CardTitle>
        <SectionSaveControls state={state} disabled={loading} />
      </CardHeader>
      <CardContent className="space-y-6">
        {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
        <div className="space-y-2">
          <Label>Roles (choose all that apply)</Label>
          <Chips options={SAP_ROLES.map(([, l]) => l)} value={roles} onChange={setRoles} otherPlaceholder="Other role, e.g. Test manager" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
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
          <Label>SAP modules &amp; skill level</Label><FieldHint field="skillLevel" /><SectionSaveControls state={moduleState} disabled={loading} />
          {skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <Badge key={s.id} variant="secondary" className="gap-1.5 py-1 ps-2.5 pe-1">
                  {s.sap_module}
                  <span className="text-muted-foreground">· L{s.proficiency_level ?? '?'}{s.years_experience != null ? ` · ${s.years_experience}y` : ''}{s.sap_version ? ` · ${s.sap_version}` : ''}</span>
                  <button type="button" aria-label={`Remove ${s.sap_module}`} onClick={() => removeSkill(s.id)} className="rounded-full p-0.5 hover:bg-muted"><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          ) : <p className="text-xs text-muted-foreground">No modules yet.</p>}
          {versionSupported && skills.length > 0 && (
            <div className="rounded-xl border border-border/60 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground">{t('ik.profile.version_title', 'Version / release per module (optional)')}</p>
              <p className="text-[11px] text-muted-foreground">{t('ik.profile.version_hint', 'The AI interview asks about the releases you name here, for example S/4HANA 2023 or ECC 6.0 EHP8. Pick one or type your own.')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {skills.map((s) => {
                  const listId = `ver-${s.id}`;
                  return (
                    <div key={s.id} className="min-w-0">
                      <Label htmlFor={`v-${s.id}`} className="text-[11px] text-muted-foreground truncate block">{s.sap_module}</Label>
                      <Input id={`v-${s.id}`} list={listId} className="h-8 text-xs" maxLength={MAX_VERSION_LENGTH} value={s.sap_version ?? ''} placeholder={t('ik.profile.version_placeholder', 'Version / release')}
                        onChange={(e) => { const v = e.target.value; setSkills(current => current.map(item => item.id === s.id ? { ...item, sap_version: v } : item)); }} />
                      <datalist id={listId}>{versionChoices(s.sap_module, versionRows.data ?? []).map((v) => <option key={v} value={v} />)}</datalist>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-border/60 p-3 space-y-3">
            <Input value={moduleQuery} onChange={(e) => setModuleQuery(e.target.value)} placeholder="Search modules (e.g. FI, payroll, EWM)" className="h-8 text-xs" />
            <div className="max-h-48 overflow-y-auto grid sm:grid-cols-2 gap-1">
              {moduleOptions.map((m) => {
                const on = picked.includes(m);
                return (
                  <label key={m} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted cursor-pointer">
                    <Checkbox checked={on} onCheckedChange={(v) => setPicked(v ? [...picked, m] : picked.filter((x) => x !== m))} />
                    {m}
                  </label>
                );
              })}
              {moduleOptions.length === 0 && <p className="text-xs text-muted-foreground px-2">No match — add it below.</p>}
            </div>
            <Input value={customModule} onChange={(e) => setCustomModule(e.target.value)} placeholder="Other modules not in the list (comma-separated)" className="h-8 text-xs" maxLength={500} />
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={newLevel} onValueChange={setNewLevel}>
                <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['1 Beginner', '2 Basic', '3 Proficient', '4 Advanced', '5 Expert'].map((l) => <SelectItem key={l} value={l[0]}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="w-24 h-8 text-xs" type="number" min={0} max={50} placeholder="Years" value={newYears} onChange={(e) => setNewYears(e.target.value)} />
              <FieldHint field="skillYears" />
              <Button size="sm" variant="outline" onClick={addSkills} disabled={!picked.length && !customModule.trim()}>
                <Plus className="h-4 w-4 me-1" />Add {picked.length + (customModule.trim() ? customModule.split(',').filter((x) => x.trim()).length : 0) || ''} module(s)
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Technologies</Label>
          <Chips options={TECHNOLOGIES} value={tech} onChange={setTech} otherPlaceholder="Other technologies (comma-separated)" />
        </div>
      </CardContent>
    </Card>
  );
}
