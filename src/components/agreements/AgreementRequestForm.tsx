// "Agreement settings": every option of a support agreement in one form with sections (Basics, Term, Rates,
// Commitment, SLA, Crew, Reporting, Escalation contacts, Documents, Review & accept), a progress checklist and
// validation messages. The draft can be saved at any time; the database re-checks everything (sa_create /
// sa_save_draft / sa_publish) and resolves the SLA snapshot itself.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Circle, Loader2, MinusCircle, Plus, Search, Send, Save, Trash2, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useTenant } from '@/contexts/TenantContext';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import { ALL_SAP_AREAS } from '@/lib/sapAreas';
import * as slaApi from '@/lib/sla/api';
import * as api from '@/lib/agreements/api';
import {
  draftChecklist, emptyRequest, emptyTerms, normalizeTerms, saErrorCode, saProblemList, sectionOfProblem, slaSummary, withModel, SETTINGS_SECTIONS,
  type ChecklistState, type EscalationContact, type SaModel, type SaRequest, type SaSettings, type SaStatus, type SaTerms, type SettingsSection,
} from '@/lib/agreements/model';
import { ProtectionBox } from './AgreementBits';
import { CrewEditor, useConsultantNames } from './AgreementCrew';

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
const today = () => new Date().toISOString().slice(0, 10);
const STATE_ICON: Record<ChecklistState, JSX.Element> = {
  done: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />,
  todo: <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
  optional: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
  error: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />,
};

function ModulePicker({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const shown = useMemo(() => ALL_SAP_AREAS.filter((a) => !value.includes(a.name) && a.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 24), [q, value]);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5" aria-live="polite">
        {value.map((m) => (
          <Badge key={m} variant="secondary" className="gap-1">{m}
            <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange(value.filter((x) => x !== m))} aria-label={t('agreements.form.removeModule', { name: m })}><X className="h-3 w-3" /></button>
          </Badge>
        ))}
        {!value.length && <span className="text-xs text-muted-foreground">{t('agreements.form.noModules')}</span>}
      </div>
      <div className="relative"><Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('agreements.form.searchModules')} className="ps-8" aria-label={t('agreements.form.searchModules')} /></div>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
        {shown.map((a) => (
          <button key={a.name} type="button" onClick={() => value.length < 12 && onChange([...value, a.name])} title={a.hint}
            className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{a.name}</button>
        ))}
      </div>
    </div>
  );
}

function EmailList({ id, value, onChange, max, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; max: number; placeholder?: string }) {
  const { t } = useTranslation();
  const [v, setV] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex gap-2"><Input id={id} type="email" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
        <Button type="button" variant="outline" disabled={!v.includes('@') || value.length >= max} onClick={() => { onChange([...new Set([...value, v.trim().toLowerCase()])]); setV(''); }}>{t('agreements.form.add')}</Button></div>
      <div className="flex flex-wrap gap-1">{value.map((e) => <Badge key={e} variant="secondary" className="gap-1">{e}
        <button type="button" aria-label={t('agreements.form.remove')} onClick={() => onChange(value.filter((x) => x !== e))}><X className="h-3 w-3" /></button></Badge>)}</div>
    </div>
  );
}

function Section({ id, title, state, children, hint }: { id: SettingsSection; title: string; state: ChecklistState; children: React.ReactNode; hint?: string }) {
  return (
    <Card id={`sa-sec-${id}`} className="scroll-mt-24 rounded-2xl">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base">{STATE_ICON[state]}{title}</CardTitle>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}</CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

interface Props {
  settings: SaSettings;
  agreementId?: string;
  status?: SaStatus;
  reference?: string | null;
  applicants?: string[];
  initial?: { request: Partial<SaRequest>; terms: SaTerms } | null;
  onSaved: (id: string, published: boolean) => void;
  onCancel: () => void;
}

/** Client: create or edit a support agreement (draft) in one settings form, then publish it for applications. */
export default function AgreementRequestForm({ settings, agreementId, status = 'draft', reference, applicants = [], initial, onSaved, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { tenant } = useTenant();
  const favs = useClientFavourites();
  const [terms, setTerms] = useState<SaTerms>(() => normalizeTerms(initial?.terms ?? emptyTerms(settings.models_enabled[0] ?? 'payg')));
  const [request, setRequest] = useState<SaRequest>(() => ({ ...emptyRequest(), ...(initial?.request ?? {}) } as SaRequest));
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [id, setId] = useState<string | undefined>(agreementId);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [inviteOnly, setInviteOnly] = useState(false);
  const [invite, setInvite] = useState<string[]>([]);
  const nameLocked = status !== 'draft';

  const policies = useQuery({ queryKey: ['sla-my-policies', tenant?.id ?? null], queryFn: () => slaApi.fetchMyPolicies(tenant?.id ?? null), retry: false, staleTime: 60_000 });
  const favIds = useMemo(() => [...(favs.favourites.keys() ?? [])].slice(0, 30), [favs.favourites]);
  const favNames = useConsultantNames(publishOpen ? favIds : []);

  useEffect(() => { if (initial) { setTerms(normalizeTerms(initial.terms)); setRequest({ ...emptyRequest(), ...initial.request } as SaRequest); } }, [initial]);

  const set = <K extends keyof SaTerms>(k: K, v: SaTerms[K]) => setTerms((p) => ({ ...p, [k]: v }));
  const setReq = <K extends keyof SaRequest>(k: K, v: SaRequest[K]) => setRequest((p) => ({ ...p, [k]: v }));
  const check = useMemo(() => draftChecklist(terms, settings, today(), serverProblems), [terms, settings, serverProblems]);
  const problemsIn = (s: SettingsSection) => check.problems.filter((p) => sectionOfProblem(p) === s);
  const fmtProblem = (p: string) => t(`agreements.problem.${p}`, { defaultValue: p, min: settings.min_term_months, max: p.startsWith('crew') ? settings.crew_max : p.startsWith('recip') || p.startsWith('escal') ? settings.contacts_max : settings.max_notice_days });
  const Problems = ({ s }: { s: SettingsSection }) => (problemsIn(s).length ? <ul className="space-y-0.5 text-xs text-destructive" aria-live="polite">{problemsIn(s).map((p) => <li key={p}>• {fmtProblem(p)}</li>)}</ul> : null);

  const pickSla = async (value: string) => {
    if (value === 'default') { set('sla', { policy_id: null, version: null, summary: '' }); return; }
    const p = policies.data?.policies.find((x) => x.id === value);
    if (!p) return;
    const version = p.active_version ?? p.current_version;
    try {
      const v = await slaApi.fetchPolicyVersion(p.id, version);
      set('sla', { policy_id: p.id, version, name: p.name, summary: slaSummary(p.name, version, v.body, lang) });
    } catch {
      set('sla', { policy_id: p.id, version, name: p.name, summary: slaSummary(p.name, version, null, lang) });
    }
  };

  const save = async (): Promise<string | null> => {
    setBusy(true); setServerProblems([]);
    try {
      const body = { ...terms, name: terms.name.trim(), language: request.language, timezone: request.timezone };
      if (id) { await api.saveDraft(id, request, body); return id; }
      const nid = await api.createAgreement(tenant?.id ?? null, request, body);
      setId(nid);
      return nid;
    } catch (e) {
      const err = e as api.SaError;
      const code = saErrorCode(err.message);
      setServerProblems(code === 'sa_sla_invalid' ? ['sla_invalid'] : code === 'sa_name_taken' ? ['name_taken'] : saProblemList(err.message));
      toast.error(t(`agreements.err.${code}`, { defaultValue: t('agreements.err.generic') }));
      return null;
    } finally { setBusy(false); }
  };

  const doPublish = async () => {
    const nid = await save();
    if (!nid) return;
    setBusy(true);
    try {
      await api.publish(nid, deadline ? new Date(deadline).toISOString() : null, inviteOnly, invite);
      toast.success(t('agreements.form.published'));
      setPublishOpen(false);
      onSaved(nid, true);
    } catch (e) {
      const err = e as api.SaError;
      setServerProblems(saProblemList(err.message));
      toast.error(t(`agreements.err.${saErrorCode(err.message)}`, { defaultValue: t('agreements.err.generic') }));
    } finally { setBusy(false); }
  };

  const sec = check.sections;
  const esc = terms.escalation_contacts ?? [];
  const setEsc = (v: EscalationContact[]) => set('escalation_contacts', v);
  const slaPolicies = (policies.data?.policies ?? []).filter((p) => p.status === 'active');

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      {/* Progress checklist */}
      <nav aria-label={t('agreements.form.progress')} className="lg:sticky lg:top-20 lg:self-start">
        <Card className="rounded-2xl"><CardContent className="space-y-3 p-4">
          <div><p className="text-sm font-semibold">{id ? t('agreements.form.editTitle') : t('agreements.form.newTitle')}</p>
            {reference && <p className="font-mono text-xs text-muted-foreground">{reference}</p>}</div>
          <div className="space-y-1"><Progress value={check.percent} aria-label={t('agreements.form.progress')} /><p className="text-xs text-muted-foreground">{t('agreements.form.percent', { pct: check.percent })}</p></div>
          <ol className="space-y-1">
            {SETTINGS_SECTIONS.map((s) => (
              <li key={s}><a href={`#sa-sec-${s}`} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {STATE_ICON[sec[s]]}<span className={cn(sec[s] === 'error' && 'text-destructive')}>{t(`agreements.sec.${s}`)}</span>
                {['rates', 'crew', 'escalation', 'documents'].includes(s) && <span className="ms-auto text-[10px] text-muted-foreground">{t('agreements.form.optional')}</span>}</a></li>
            ))}
          </ol>
          <Button className="w-full" variant="outline" disabled={busy} onClick={async () => { const nid = await save(); if (nid) { toast.success(t('agreements.form.saved')); onSaved(nid, false); } }}>
            {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Save className="me-1 h-4 w-4" />}{t('agreements.form.saveDraft')}</Button>
        </CardContent></Card>
      </nav>

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('agreements.form.intro')}</p>

        <Section id="basics" title={t('agreements.sec.basics')} state={sec.basics}>
          <div className="space-y-1.5"><Label htmlFor="sa-name">{t('agreements.f.name')}</Label>
            <Input id="sa-name" value={terms.name} maxLength={120} disabled={nameLocked} onChange={(e) => set('name', e.target.value)} placeholder={t('agreements.form.namePh')} aria-describedby="sa-name-hint" />
            <p id="sa-name-hint" className="text-xs text-muted-foreground">{nameLocked ? t('agreements.form.nameLocked') : t('agreements.form.nameHint')}</p></div>
          <ModulePicker label={t('agreements.f.modules')} value={terms.scope.modules} onChange={(m) => set('scope', { ...terms.scope, modules: m })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="sa-ver">{t('agreements.f.versions')}</Label>
              <Input id="sa-ver" defaultValue={terms.scope.versions.join(', ')} onBlur={(e) => set('scope', { ...terms.scope, versions: list(e.target.value) })} placeholder="S/4HANA 2023, ECC 6.0" /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-sys">{t('agreements.f.systems')}</Label>
              <Input id="sa-sys" defaultValue={terms.scope.systems.join(', ')} onBlur={(e) => set('scope', { ...terms.scope, systems: list(e.target.value) })} placeholder="PRD, QAS" /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="sa-cov">{t('agreements.f.covered')}</Label>
              <Textarea id="sa-cov" rows={3} maxLength={2000} value={terms.scope.covered} onChange={(e) => set('scope', { ...terms.scope, covered: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-ncov">{t('agreements.f.notCovered')}</Label>
              <Textarea id="sa-ncov" rows={3} maxLength={2000} value={terms.scope.not_covered} onChange={(e) => set('scope', { ...terms.scope, not_covered: e.target.value })} /></div>
          </div>
          <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="px-1 text-sm font-medium">{t('agreements.form.forApplicants')}</legend>
            <div className="space-y-1.5"><Label htmlFor="sa-eh">{t('agreements.f.expectedHours')}</Label>
              <Input id="sa-eh" type="number" min={0} value={request.expected_hours_per_month ?? ''} onChange={(e) => setReq('expected_hours_per_month', e.target.value ? Number(e.target.value) : null)} /></div>
            <div className="space-y-1.5"><Label>{t('agreements.f.language')}</Label>
              <Select value={request.language} onValueChange={(v) => setReq('language', v)}>
                <SelectTrigger aria-label={t('agreements.f.language')}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem><SelectItem value="both">English + العربية</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label htmlFor="sa-tz">{t('agreements.f.timezone')}</Label>
              <Input id="sa-tz" value={request.timezone ?? ''} placeholder="Asia/Riyadh" onChange={(e) => setReq('timezone', e.target.value || null)} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-bmin">{t('agreements.f.budgetMin')}</Label>
              <Input id="sa-bmin" type="number" min={0} value={request.budget?.min ?? ''} onChange={(e) => setReq('budget', { min: e.target.value ? Number(e.target.value) : null, max: request.budget?.max ?? null, currency: terms.rate.currency })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-bmax">{t('agreements.f.budgetMax')}</Label>
              <Input id="sa-bmax" type="number" min={0} value={request.budget?.max ?? ''} onChange={(e) => setReq('budget', { max: e.target.value ? Number(e.target.value) : null, min: request.budget?.min ?? null, currency: terms.rate.currency })} /></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={request.show_budget} onCheckedChange={(v) => setReq('show_budget', !!v)} /> {t('agreements.f.showBudget')}</label>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3"><Label htmlFor="sa-notes">{t('agreements.f.notes')}</Label>
              <Textarea id="sa-notes" rows={3} maxLength={2000} value={request.notes} onChange={(e) => setReq('notes', e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('agreements.form.contactHint')}</p></div>
          </fieldset>
          <Problems s="basics" />
        </Section>

        <Section id="term" title={t('agreements.sec.term')} state={sec.term} hint={t('agreements.form.termHint', { min: settings.min_term_months })}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5"><Label htmlFor="sa-start">{t('agreements.f.start')}</Label>
              <Input id="sa-start" type="date" min={today()} value={terms.term.start_date} onChange={(e) => set('term', { ...terms.term, start_date: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-end">{t('agreements.f.end')}</Label>
              <Input id="sa-end" type="date" disabled={terms.term.end_date === null} value={terms.term.end_date ?? ''} onChange={(e) => set('term', { ...terms.term, end_date: e.target.value || null })} />
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={terms.term.end_date === null} onCheckedChange={(v) => set('term', { ...terms.term, end_date: v ? null : terms.term.start_date })} /> {t('agreements.f.openEnded')}</label></div>
            <div className="space-y-1.5"><Label htmlFor="sa-notice">{t('agreements.f.noticeDays')}</Label>
              <Input id="sa-notice" type="number" min={0} max={settings.max_notice_days} value={terms.term.notice_days} onChange={(e) => set('term', { ...terms.term, notice_days: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-renew">{t('agreements.f.renewMonths')}</Label>
              <Input id="sa-renew" type="number" min={1} max={36} value={terms.term.renew_months} onChange={(e) => set('term', { ...terms.term, renew_months: Number(e.target.value) })} />
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={terms.term.auto_renew} onCheckedChange={(v) => set('term', { ...terms.term, auto_renew: !!v })} /> {t('agreements.f.autoRenewAsk')}</label></div>
          </div>
          <p className="text-xs text-muted-foreground">{t('agreements.form.terminationHint')}</p>
          <Problems s="term" />
        </Section>

        <Section id="rates" title={t('agreements.sec.rates')} state={sec.rates} hint={t('agreements.form.ratesHint', { min: settings.rate_min, max: settings.rate_max })}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5"><Label htmlFor="sa-rate">{t('agreements.f.targetRate')}</Label>
              <Input id="sa-rate" type="number" min={0} value={terms.rate.hourly_rate || ''} placeholder={t('agreements.form.ratePh')} onChange={(e) => set('rate', { ...terms.rate, hourly_rate: Number(e.target.value) || 0 })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-cur">{t('agreements.f.currency')}</Label>
              <Input id="sa-cur" maxLength={3} value={terms.rate.currency} onChange={(e) => { const c = e.target.value.toUpperCase(); set('rate', { ...terms.rate, currency: c }); setReq('budget', request.budget ? { ...request.budget, currency: c } : null); }} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-s1">{t('agreements.f.s1')}</Label>
              <Input id="sa-s1" type="number" min={1} max={settings.max_multiplier} step={0.05} value={terms.rate.s1_multiplier ?? ''} placeholder={t('agreements.form.multiplierPh')}
                onChange={(e) => set('rate', { ...terms.rate, s1_multiplier: e.target.value ? Number(e.target.value) : null })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-ooh">{t('agreements.f.ooh')}</Label>
              <Input id="sa-ooh" type="number" min={1} max={settings.max_multiplier} step={0.05} value={terms.rate.ooh_multiplier ?? ''} placeholder={t('agreements.form.multiplierPh')}
                onChange={(e) => set('rate', { ...terms.rate, ooh_multiplier: e.target.value ? Number(e.target.value) : null })} /></div>
            {terms.model === 'hours_bank' && terms.bank && (
              <div className="space-y-1.5"><Label htmlFor="sa-ov">{t('agreements.f.overage')}</Label>
                <Input id="sa-ov" type="number" min={0} value={terms.bank.overage_rate ?? ''} placeholder={t('agreements.f.overageSame')} onChange={(e) => set('bank', { ...terms.bank!, overage_rate: e.target.value ? Number(e.target.value) : null })} /></div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('agreements.form.multiplierHint')}</p>
          <Problems s="rates" />
        </Section>

        <Section id="commitment" title={t('agreements.sec.commitment')} state={sec.commitment}>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('agreements.f.model')}>
            {settings.models_enabled.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={terms.model === m} onClick={() => setTerms((p) => withModel(p, m as SaModel))}
                className={cn('rounded-xl border p-3 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', terms.model === m ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                <span className="font-medium">{t(`agreements.model.${m}`)}</span><span className="mt-1 block text-xs text-muted-foreground">{t(`agreements.modelHint.${m}`)}</span>
              </button>
            ))}
          </div>
          {terms.model === 'hours_bank' && terms.bank && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5"><Label htmlFor="sa-bh">{t('agreements.f.bankHours')}</Label>
                <Input id="sa-bh" type="number" min={1} max={744} value={terms.bank.hours_per_month} onChange={(e) => set('bank', { ...terms.bank!, hours_per_month: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>{t('agreements.f.rollover')}</Label>
                <Select value={terms.bank.rollover} onValueChange={(v) => set('bank', { ...terms.bank!, rollover: v as 'none' })}>
                  <SelectTrigger aria-label={t('agreements.f.rollover')}><SelectValue /></SelectTrigger>
                  <SelectContent>{(['none', 'hours', 'months'] as const).map((r) => <SelectItem key={r} value={r}>{t(`agreements.rollover.${r}`)}</SelectItem>)}</SelectContent>
                </Select></div>
              {terms.bank.rollover === 'hours' && <div className="space-y-1.5"><Label htmlFor="sa-rh">{t('agreements.f.rolloverHours')}</Label>
                <Input id="sa-rh" type="number" min={0} value={terms.bank.rollover_hours} onChange={(e) => set('bank', { ...terms.bank!, rollover_hours: Number(e.target.value) })} /></div>}
              {terms.bank.rollover === 'months' && <div className="space-y-1.5"><Label htmlFor="sa-rm">{t('agreements.f.rolloverMonths')}</Label>
                <Input id="sa-rm" type="number" min={1} max={12} value={terms.bank.rollover_months} onChange={(e) => set('bank', { ...terms.bank!, rollover_months: Number(e.target.value) })} /></div>}
              <div className="space-y-1.5"><Label>{t('agreements.f.unused')}</Label>
                <Select value={terms.bank.unused} onValueChange={(v) => set('bank', { ...terms.bank!, unused: v as 'charge' })}>
                  <SelectTrigger aria-label={t('agreements.f.unused')}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="charge">{t('agreements.unused.charge')}</SelectItem>{settings.allow_forfeit && <SelectItem value="forfeit">{t('agreements.unused.forfeit')}</SelectItem>}</SelectContent>
                </Select></div>
              <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">{t('agreements.form.bankHint')}</p>
            </div>
          )}
          {terms.model === 'availability' && (
            <div className="max-w-xs space-y-1.5"><Label htmlFor="sa-cap">{t('agreements.f.capacity')}</Label>
              <Input id="sa-cap" type="number" min={0.5} max={60} step={0.5} value={terms.capacity_hours_per_week ?? 0} onChange={(e) => set('capacity_hours_per_week', Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t('agreements.form.capacityHint')}</p></div>
          )}
          {!settings.allow_prepayment && <p className="text-xs text-muted-foreground">{t('agreements.form.prepaymentOff')}</p>}
          <Problems s="commitment" />
        </Section>

        <Section id="sla" title={t('agreements.sec.sla')} state={sec.sla} hint={t('agreements.form.slaStarts')}>
          <div className="space-y-1.5"><Label>{t('agreements.f.sla')}</Label>
            <Select value={terms.sla.policy_id ?? 'default'} onValueChange={pickSla}>
              <SelectTrigger aria-label={t('agreements.f.sla')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('agreements.f.slaDefault')}</SelectItem>
                {slaPolicies.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.scope === 'template' ? ` · ${t('agreements.form.template')}` : ''}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="rounded-xl border bg-muted/40 p-3 text-sm"><p className="text-xs font-medium text-muted-foreground">{t('agreements.form.slaPreview')}</p>
            <p className="mt-1">{terms.sla.summary || t('agreements.f.slaDefault')}</p></div>
          <p className="text-xs text-muted-foreground">{t('agreements.form.slaSnapshot')} <Link to="/client/sla" className="text-primary underline-offset-2 hover:underline">{t('agreements.form.slaManage')}</Link></p>
          <Problems s="sla" />
        </Section>

        <Section id="crew" title={t('agreements.sec.crew')} state={sec.crew} hint={t('agreements.form.crewHint')}>
          <CrewEditor value={(terms.team ?? []).filter((e) => e.role !== 'lead')} settings={settings} applicants={applicants}
            onChange={(v) => set('team', [...(terms.team ?? []).filter((e) => e.role === 'lead'), ...v])} />
          <label className="flex items-center gap-2 text-sm"><Switch checked={terms.nda_required} onCheckedChange={(v) => set('nda_required', v)} /> {t('agreements.f.nda')}</label>
          <Problems s="crew" />
        </Section>

        <Section id="reporting" title={t('agreements.sec.reporting')} state={sec.reporting} hint={t('agreements.form.reportingHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>{t('agreements.f.reporting')}</Label>
              <Select value={terms.reporting} onValueChange={(v) => set('reporting', v as 'monthly')}>
                <SelectTrigger aria-label={t('agreements.f.reporting')}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="weekly">{t('agreements.reporting.weekly')}</SelectItem><SelectItem value="monthly">{t('agreements.reporting.monthly')}</SelectItem></SelectContent>
              </Select></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={!!terms.statement_email} onCheckedChange={(v) => set('statement_email', v)} /> {t('agreements.f.statementEmail')}</label>
          </div>
          {terms.statement_email && (
            <div className="space-y-1.5"><Label htmlFor="sa-rec">{t('agreements.f.recipients')}</Label>
              <EmailList id="sa-rec" value={terms.statement_recipients ?? []} max={settings.contacts_max} onChange={(v) => set('statement_recipients', v)} />
              <p className="text-xs text-muted-foreground">{t('agreements.form.recipientsHint', { max: settings.contacts_max })}</p></div>
          )}
          <Problems s="reporting" />
        </Section>

        <Section id="escalation" title={t('agreements.sec.escalation')} state={sec.escalation} hint={t('agreements.form.escalationHint')}>
          {esc.map((c, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]">
              <div className="space-y-1"><Label htmlFor={`esc-e-${i}`} className="text-xs">{t('agreements.f.email')}</Label><Input id={`esc-e-${i}`} type="email" value={c.email} onChange={(e) => setEsc(esc.map((x, j) => (j === i ? { ...x, email: e.target.value.trim().toLowerCase() } : x)))} /></div>
              <div className="space-y-1"><Label className="text-xs">{t('agreements.f.level')}</Label>
                <Select value={String(c.level)} onValueChange={(v) => setEsc(esc.map((x, j) => (j === i ? { ...x, level: Number(v) as 1 } : x)))}>
                  <SelectTrigger aria-label={t('agreements.f.level')}><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3].map((l) => <SelectItem key={l} value={String(l)}>{t('agreements.f.levelN', { n: l })}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label htmlFor={`esc-t-${i}`} className="text-xs">{t('agreements.f.contactTitle')}</Label><Input id={`esc-t-${i}`} maxLength={80} value={c.title ?? ''} onChange={(e) => setEsc(esc.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></div>
              <Button type="button" variant="ghost" size="icon" aria-label={t('agreements.form.remove')} onClick={() => setEsc(esc.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={esc.length >= settings.contacts_max} onClick={() => setEsc([...esc, { email: '', level: (Math.min(3, esc.length + 1)) as 1, title: '' }])}><Plus className="me-1 h-4 w-4" />{t('agreements.form.addContact')}</Button>
          <Problems s="escalation" />
        </Section>

        <Section id="documents" title={t('agreements.sec.documents')} state={sec.documents}>
          <p className="text-sm text-muted-foreground">{id ? t('agreements.form.docsAfterSave') : t('agreements.form.docsSaveFirst')}</p>
          {id && <Button asChild variant="outline" size="sm"><Link to={`/client/agreements/${id}`}>{t('agreements.form.openDocuments')}</Link></Button>}
        </Section>

        <Section id="review" title={t('agreements.sec.review')} state={sec.review} hint={t('agreements.form.reviewHint')}>
          {check.problems.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm" aria-live="polite">
              {check.problems.map((p) => <li key={p}><a className="hover:underline" href={`#sa-sec-${sectionOfProblem(p)}`}>• {t(`agreements.sec.${sectionOfProblem(p)}`)}: {fmtProblem(p)}</a></li>)}
            </ul>
          ) : <p className="text-sm text-success">{t('agreements.form.readyToPublish')}</p>}
          <ProtectionBox compact />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>{t('agreements.cancel')}</Button>
            <Button variant="outline" disabled={busy} onClick={async () => { const nid = await save(); if (nid) { toast.success(t('agreements.form.saved')); onSaved(nid, false); } }}>
              {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Save className="me-1 h-4 w-4" />}{t('agreements.form.saveDraft')}</Button>
            {status === 'draft' && <Button disabled={busy || !check.canPublish} onClick={() => setPublishOpen(true)}><Send className="me-1 h-4 w-4" />{t('agreements.form.publish')}</Button>}
          </div>
        </Section>
      </div>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('agreements.form.publishTitle')}</DialogTitle><DialogDescription>{t('agreements.form.publishText')}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="sa-deadline">{t('agreements.f.deadline')}</Label>
              <Input id="sa-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('agreements.form.deadlineHint')}</p></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={inviteOnly} onCheckedChange={setInviteOnly} /> {t('agreements.form.inviteOnly')}</label>
            <div className="space-y-2">
              <Label>{t('agreements.form.inviteFavourites')}</Label>
              {!favIds.length && <p className="text-xs text-muted-foreground">{t('agreements.form.noFavourites')}</p>}
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {favIds.map((cid) => (
                  <label key={cid} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted">
                    <Checkbox checked={invite.includes(cid)} onCheckedChange={(v) => setInvite((p) => (v ? [...p, cid] : p.filter((x) => x !== cid)))} />
                    {favNames[cid] ?? '…'}
                  </label>
                ))}
              </div>
            </div>
            {inviteOnly && !invite.length && <p className="text-xs text-warning">{t('agreements.form.inviteNeeded')}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>{t('agreements.cancel')}</Button>
            <Button disabled={busy || (inviteOnly && !invite.length)} onClick={doPublish}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('agreements.form.publishNow')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
