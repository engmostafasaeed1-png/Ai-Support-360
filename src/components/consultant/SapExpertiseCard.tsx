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
import { useQueryClient } from '@tanstack/react-query';
import { Textarea } from '@/components/ui/textarea';
import RolePicker from './RolePicker';
import { MY_ROLES_KEY, useRoleCatalog } from '@/hooks/useRoleCatalog';
import { MAX_ROLES, fieldAppliesToRoles, isRequiredForRoles, normalizeRoles, primaryToStore } from '@/lib/consultantRoles';

/** @deprecated The role list now comes from the admin catalogue (useRoleCatalog); kept for older imports. */
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

const METHODOLOGIES = ['SAP Activate', 'ASAP', 'Agile / Scrum', 'Waterfall', 'Hybrid', 'PRINCE2', 'PMP', 'SAFe', 'ITIL', 'TOGAF'];
const SOLUTION_AREAS = ['Finance', 'Procurement', 'Supply chain', 'Sales & service', 'Human resources', 'Manufacturing', 'Asset management', 'Analytics', 'BTP & integration', 'Industry solutions'];
type RoleDetails = { methodologies?: string[]; team_size_managed?: number | null; solution_areas?: string[]; presales_experience?: string };

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
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={add} reason={!custom.trim() && 'fill_required_fields'}><Plus className="h-3.5 w-3.5 me-1" />Add</Button>
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
  const queryClient = useQueryClient();
  const roleCatalog = useRoleCatalog();
  const [details, setDetails] = useState<RoleDetails>({});
  const [detailsLoaded, setDetailsLoaded] = useState(false);
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
        // Stored labels and old keys become catalogue keys; unknown legacy text stays as typed.
        setRoles(normalizeRoles(data.sap_roles?.length ? data.sap_roles : [], data.sap_role).roles);
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
  const applied = roleCatalog.applied;
  useEffect(() => {
    if (!applied || !userId || detailsLoaded) return;
    (supabase as any).from('consultants').select('role_details').eq('id', userId).maybeSingle().then(({ data }: { data: { role_details?: RoleDetails } | null }) => {
      setDetails(data?.role_details && typeof data.role_details === 'object' ? data.role_details : {});
      setDetailsLoaded(true);
    });
  }, [applied, userId, detailsLoaded]);
  const applies = (field: string) => fieldAppliesToRoles(field, roles, roleCatalog.catalog);
  const values = { sap_roles: roles, seniority_level: seniority || null, total_sap_years: years === '' ? null : Number(years), sap_technologies: tech };
  const state = useSectionAutosave({ values, ready: !loading && loadSucceeded && !!userId && !rules.isLoading, automatic: automatic.data === true, beforeManual,
    validate: patch => {
      const y = values.total_sap_years;
      if (y !== null && (!Number.isInteger(y) || y < 0 || y > 50)) return 'Years of SAP experience must be 0–50';
      if (roles.length > MAX_ROLES && 'sap_roles' in patch) return t('roles.max_reached', 'You can choose up to {{n}} roles.', { n: MAX_ROLES });
      if (Object.entries(patch).some(([key, value]) => isRequiredForRoles(key, rules.isRequired(key), roles, roleCatalog.catalog) && (value === null || value === '' || (Array.isArray(value) && !value.length)))) return 'Complete the required fields in this section before saving.';
      return null;
    },
    persist: async patch => {
      if (!userId) throw new Error('Your consultant profile could not be found.');
      const payload = { ...patch, ...('sap_roles' in patch ? { sap_role: primaryToStore(roles[0] ?? null, applied, roleCatalog.catalog) } : {}) };
      const { error } = await supabase.from('consultants').update(payload as never).eq('id', userId);
      if (error) { toast.error(error.message); throw error; }
      if ('sap_roles' in patch) void queryClient.invalidateQueries({ queryKey: MY_ROLES_KEY });
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
  const detailState = useSectionAutosave({ values: { role_details: details }, ready: applied && detailsLoaded && !!userId && !rules.isLoading, automatic: automatic.data === true, beforeManual,
    validate: () => {
      const n = details.team_size_managed;
      if (n !== undefined && n !== null && (!Number.isInteger(n) || n < 0 || n > 10000)) return t('roles.team_size_invalid', 'Team size must be a whole number from 0 to 10000.');
      const missing = (['methodologies', 'team_size_managed', 'solution_areas', 'presales_experience'] as const).some((k) => {
        if (!isRequiredForRoles(k, rules.isRequired(k), roles, roleCatalog.catalog)) return false;
        const v = details[k];
        return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
      });
      return missing ? 'Complete the required fields in this section before saving.' : null;
    },
    persist: async () => {
      if (!userId) throw new Error('Your consultant profile could not be found.');
      const clean: RoleDetails = {};
      if (details.methodologies?.length) clean.methodologies = details.methodologies.slice(0, 12).map((x) => x.slice(0, 80));
      if (details.solution_areas?.length) clean.solution_areas = details.solution_areas.slice(0, 12).map((x) => x.slice(0, 80));
      if (typeof details.team_size_managed === 'number') clean.team_size_managed = details.team_size_managed;
      if (details.presales_experience?.trim()) clean.presales_experience = details.presales_experience.trim().slice(0, 600);
      const { error } = await (supabase as any).from('consultants').update({ role_details: clean }).eq('id', userId);
      if (error) { toast.error(error.message?.includes('role_details_invalid') ? t('roles.details_invalid', 'Remove contact details (e-mail, phone, links) from your role details.') : error.message); throw error; }
      onProfileChanged?.();
    },
  });
  const showDetails = applied && (['methodologies', 'team_size_managed', 'solution_areas', 'presales_experience'] as const).some((k) => applies(k) && rules.isVisible(k));
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
        <SectionSaveControls state={state} reason={loading && 'loading_data'} />
      </CardHeader>
      <CardContent className="space-y-6">
        {loadError && <p role="alert" className="text-xs text-destructive">{loadError}</p>}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('roles.intro', 'All SAP professionals are welcome: consultants, architects, managers, analysts, testers, trainers and pre-sales. Choose one main role and up to 4 more.')}</p>
          <RolePicker catalog={roleCatalog.catalog} value={roles} onChange={setRoles} max={MAX_ROLES} withPrimary idPrefix="profile-role" required={rules.isRequired('sap_roles') || rules.isRequired('sap_role')} />
        </div>

        {showDetails && (
          <div className="rounded-xl border border-border/60 p-3 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{t('roles.details_title', 'Details for your role')}</p>
              <SectionSaveControls state={detailState} reason={loading && 'loading_data'} />
            </div>
            {applies('methodologies') && rules.isVisible('methodologies') && (
              <div className="space-y-2">
                <Label>{t('roles.methodologies', 'Delivery methodologies')}</Label>
                <Chips options={METHODOLOGIES} value={details.methodologies ?? []} onChange={(v) => setDetails({ ...details, methodologies: v.slice(0, 12) })} otherPlaceholder={t('roles.other_method', 'Other method')} />
              </div>
            )}
            {applies('team_size_managed') && rules.isVisible('team_size_managed') && (
              <div className="space-y-1.5 max-w-xs">
                <Label htmlFor="role-team-size">{t('roles.team_size', 'Largest team you managed (people)')}</Label>
                <Input id="role-team-size" type="number" min={0} max={10000} value={details.team_size_managed ?? ''}
                  onChange={(e) => setDetails({ ...details, team_size_managed: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            )}
            {applies('solution_areas') && rules.isVisible('solution_areas') && (
              <div className="space-y-2">
                <Label>{t('roles.solution_areas', 'Solution areas you position or design')}</Label>
                <Chips options={SOLUTION_AREAS} value={details.solution_areas ?? []} onChange={(v) => setDetails({ ...details, solution_areas: v.slice(0, 12) })} otherPlaceholder={t('roles.other_area', 'Other area')} />
              </div>
            )}
            {applies('presales_experience') && rules.isVisible('presales_experience') && (
              <div className="space-y-1.5">
                <Label htmlFor="role-presales">{t('roles.presales_experience', 'Deal and demo experience')}</Label>
                <Textarea id="role-presales" rows={3} maxLength={600} value={details.presales_experience ?? ''}
                  placeholder={t('roles.presales_placeholder', 'For example: 20+ S/4HANA demos for distribution companies, discovery workshops, proposal writing.')}
                  onChange={(e) => setDetails({ ...details, presales_experience: e.target.value })} />
                <p className="text-[11px] text-muted-foreground">{t('roles.no_prices', 'Do not include prices, discounts or contact details.')}</p>
              </div>
            )}
          </div>
        )}

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
          <Label>SAP modules &amp; skill level</Label><FieldHint field="skillLevel" /><SectionSaveControls state={moduleState} reason={loading && 'loading_data'} />
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
              <Button size="sm" variant="outline" onClick={addSkills} reason={!picked.length && !customModule.trim() && 'select_items_first'}>
                <Plus className="h-4 w-4 me-1" />Add {picked.length + (customModule.trim() ? customModule.split(',').filter((x) => x.trim()).length : 0) || ''} module(s)
              </Button>
            </div>
          </div>
        </div>

        {(applies('sap_technologies') || tech.length > 0) && (
          <div className="space-y-2">
            <Label>Technologies{!applies('sap_technologies') && <span className="ms-1 text-xs font-normal text-muted-foreground">{t('roles.optional_for_role', '(optional for your role)')}</span>}</Label>
            <Chips options={TECHNOLOGIES} value={tech} onChange={setTech} otherPlaceholder="Other technologies (comma-separated)" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
