import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Search, Send, Save, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTenant } from '@/contexts/TenantContext';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import { safeRpc } from '@/lib/safeRpc';
import { ALL_SAP_AREAS } from '@/lib/sapAreas';
import * as slaApi from '@/lib/sla/api';
import * as api from '@/lib/agreements/api';
import {
  emptyRequest, emptyTerms, saErrorCode, saProblemList, slaSummary, termsProblems, withModel,
  type SaModel, type SaRequest, type SaSettings, type SaTerms,
} from '@/lib/agreements/model';
import { ProtectionBox } from './AgreementBits';

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
const today = () => new Date().toISOString().slice(0, 10);

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

interface Props {
  settings: SaSettings;
  agreementId?: string;
  initial?: { request: Partial<SaRequest>; terms: SaTerms } | null;
  onSaved: (id: string, published: boolean) => void;
  onCancel: () => void;
}

/** Client: create or edit a support agreement request (draft), then publish it for applications. */
export default function AgreementRequestForm({ settings, agreementId, initial, onSaved, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { tenant } = useTenant();
  const favs = useClientFavourites();
  const [terms, setTerms] = useState<SaTerms>(() => initial?.terms ?? emptyTerms(settings.models_enabled[0] ?? 'payg'));
  const [request, setRequest] = useState<SaRequest>(() => ({ ...emptyRequest(), ...(initial?.request ?? {}) } as SaRequest));
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [id, setId] = useState<string | undefined>(agreementId);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [inviteOnly, setInviteOnly] = useState(false);
  const [invite, setInvite] = useState<string[]>([]);

  const policies = useQuery({ queryKey: ['sla-my-policies', tenant?.id ?? null], queryFn: () => slaApi.fetchMyPolicies(tenant?.id ?? null), retry: false, staleTime: 60_000 });
  const favIds = useMemo(() => [...(favs.favourites.keys() ?? [])].slice(0, 30), [favs.favourites]);
  const favNames = useQuery({
    queryKey: ['sa-fav-names', favIds], enabled: favIds.length > 0 && publishOpen, staleTime: 300_000,
    queryFn: async () => Object.fromEntries(await Promise.all(favIds.map(async (cid) => [cid, (await safeRpc<string>('consultant_public_name', { _consultant_id: cid })).data ?? '—'] as const))),
  });

  useEffect(() => { if (initial) { setTerms(initial.terms); setRequest({ ...emptyRequest(), ...initial.request } as SaRequest); } }, [initial]);

  const set = <K extends keyof SaTerms>(k: K, v: SaTerms[K]) => setTerms((p) => ({ ...p, [k]: v }));
  const setReq = <K extends keyof SaRequest>(k: K, v: SaRequest[K]) => setRequest((p) => ({ ...p, [k]: v }));
  // Rates come from applications; the request itself is checked without them.
  const problems = useMemo(() => termsProblems({ ...terms, rate: { ...terms.rate, hourly_rate: settings.rate_min } }, settings, today()).filter((p) => !['rate_low', 'rate_high', 'overage_low'].includes(p)), [terms, settings]);

  const pickSla = async (value: string) => {
    if (value === 'default') { set('sla', { policy_id: null, version: null, summary: '' }); return; }
    const p = policies.data?.policies.find((x) => x.id === value);
    if (!p) return;
    const version = p.active_version ?? p.current_version;
    try {
      const v = await slaApi.fetchPolicyVersion(p.id, version);
      set('sla', { policy_id: p.id, version, summary: slaSummary(p.name, version, v.body, lang) });
    } catch {
      set('sla', { policy_id: p.id, version, summary: slaSummary(p.name, version, null, lang) });
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
      setServerProblems(saProblemList(err.message));
      toast.error(t(`agreements.err.${saErrorCode(err.message)}`, { defaultValue: t('agreements.err.generic') }));
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

  const allProblems = [...new Set([...problems, ...serverProblems])];

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">{id ? t('agreements.form.editTitle') : t('agreements.form.newTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('agreements.form.intro')}</p></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5"><Label htmlFor="sa-name">{t('agreements.f.name')}</Label>
            <Input id="sa-name" value={terms.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder={t('agreements.form.namePh')} /></div>

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

          <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="px-1 text-sm font-medium">{t('agreements.f.term')}</legend>
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
          </fieldset>

          <fieldset className="space-y-4 rounded-xl border p-4">
            <legend className="px-1 text-sm font-medium">{t('agreements.f.model')}</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('agreements.f.model')}>
              {settings.models_enabled.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={terms.model === m} onClick={() => setTerms((p) => withModel(p, m as SaModel))}
                  className={`rounded-xl border p-3 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${terms.model === m ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}>
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
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(['none', 'hours', 'months'] as const).map((r) => <SelectItem key={r} value={r}>{t(`agreements.rollover.${r}`)}</SelectItem>)}</SelectContent>
                  </Select></div>
                {terms.bank.rollover === 'hours' && <div className="space-y-1.5"><Label htmlFor="sa-rh">{t('agreements.f.rolloverHours')}</Label>
                  <Input id="sa-rh" type="number" min={0} value={terms.bank.rollover_hours} onChange={(e) => set('bank', { ...terms.bank!, rollover_hours: Number(e.target.value) })} /></div>}
                {terms.bank.rollover === 'months' && <div className="space-y-1.5"><Label htmlFor="sa-rm">{t('agreements.f.rolloverMonths')}</Label>
                  <Input id="sa-rm" type="number" min={1} max={12} value={terms.bank.rollover_months} onChange={(e) => set('bank', { ...terms.bank!, rollover_months: Number(e.target.value) })} /></div>}
                <div className="space-y-1.5"><Label>{t('agreements.f.unused')}</Label>
                  <Select value={terms.bank.unused} onValueChange={(v) => set('bank', { ...terms.bank!, unused: v as 'charge' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="sa-s1">{t('agreements.f.s1')}</Label>
                <Input id="sa-s1" type="number" min={1} max={settings.max_multiplier} step={0.05} value={terms.rate.s1_multiplier ?? ''} placeholder={t('agreements.form.multiplierPh')}
                  onChange={(e) => set('rate', { ...terms.rate, s1_multiplier: e.target.value ? Number(e.target.value) : null })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sa-ooh">{t('agreements.f.ooh')}</Label>
                <Input id="sa-ooh" type="number" min={1} max={settings.max_multiplier} step={0.05} value={terms.rate.ooh_multiplier ?? ''} placeholder={t('agreements.form.multiplierPh')}
                  onChange={(e) => set('rate', { ...terms.rate, ooh_multiplier: e.target.value ? Number(e.target.value) : null })} /></div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t('agreements.form.multiplierHint')}</p>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>{t('agreements.f.sla')}</Label>
              <Select value={terms.sla.policy_id ?? 'default'} onValueChange={pickSla}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t('agreements.f.slaDefault')}</SelectItem>
                  {(policies.data?.policies ?? []).filter((p) => p.status === 'active').map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {terms.sla.summary && <p className="text-xs text-muted-foreground">{terms.sla.summary}</p>}</div>
            <div className="space-y-1.5"><Label>{t('agreements.f.reporting')}</Label>
              <Select value={terms.reporting} onValueChange={(v) => set('reporting', v as 'monthly')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="weekly">{t('agreements.reporting.weekly')}</SelectItem><SelectItem value="monthly">{t('agreements.reporting.monthly')}</SelectItem></SelectContent>
              </Select></div>
          </div>

          <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="px-1 text-sm font-medium">{t('agreements.form.forApplicants')}</legend>
            <div className="space-y-1.5"><Label htmlFor="sa-eh">{t('agreements.f.expectedHours')}</Label>
              <Input id="sa-eh" type="number" min={0} value={request.expected_hours_per_month ?? ''} onChange={(e) => setReq('expected_hours_per_month', e.target.value ? Number(e.target.value) : null)} /></div>
            <div className="space-y-1.5"><Label>{t('agreements.f.language')}</Label>
              <Select value={request.language} onValueChange={(v) => setReq('language', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem><SelectItem value="both">English + العربية</SelectItem></SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label htmlFor="sa-tz">{t('agreements.f.timezone')}</Label>
              <Input id="sa-tz" value={request.timezone ?? ''} placeholder="Asia/Riyadh" onChange={(e) => setReq('timezone', e.target.value || null)} /></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Switch checked={terms.nda_required} onCheckedChange={(v) => set('nda_required', v)} /> {t('agreements.f.nda')}</label>
            <div className="space-y-1.5"><Label htmlFor="sa-bmin">{t('agreements.f.budgetMin')}</Label>
              <Input id="sa-bmin" type="number" min={0} value={request.budget?.min ?? ''} onChange={(e) => setReq('budget', { min: e.target.value ? Number(e.target.value) : null, max: request.budget?.max ?? null, currency: request.budget?.currency ?? 'USD' })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-bmax">{t('agreements.f.budgetMax')}</Label>
              <Input id="sa-bmax" type="number" min={0} value={request.budget?.max ?? ''} onChange={(e) => setReq('budget', { max: e.target.value ? Number(e.target.value) : null, min: request.budget?.min ?? null, currency: request.budget?.currency ?? 'USD' })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sa-cur">{t('agreements.f.currency')}</Label>
              <Input id="sa-cur" maxLength={3} value={terms.rate.currency} onChange={(e) => { const c = e.target.value.toUpperCase(); set('rate', { ...terms.rate, currency: c }); setReq('budget', request.budget ? { ...request.budget, currency: c } : null); }} /></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={request.show_budget} onCheckedChange={(v) => setReq('show_budget', !!v)} /> {t('agreements.f.showBudget')}</label>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4"><Label htmlFor="sa-notes">{t('agreements.f.notes')}</Label>
              <Textarea id="sa-notes" rows={3} maxLength={2000} value={request.notes} onChange={(e) => setReq('notes', e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('agreements.form.contactHint')}</p></div>
          </fieldset>

          {allProblems.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm" aria-live="polite">
              {allProblems.map((p) => <li key={p}>• {t(`agreements.problem.${p}`, { defaultValue: p, min: settings.min_term_months, max: settings.max_notice_days })}</li>)}
            </ul>
          )}
          <ProtectionBox compact />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>{t('agreements.cancel')}</Button>
            <Button variant="outline" disabled={busy} onClick={async () => { const nid = await save(); if (nid) { toast.success(t('agreements.form.saved')); onSaved(nid, false); } }}>
              {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Save className="me-1 h-4 w-4" />}{t('agreements.form.saveDraft')}</Button>
            <Button disabled={busy || problems.length > 0} onClick={() => setPublishOpen(true)}><Send className="me-1 h-4 w-4" />{t('agreements.form.publish')}</Button>
          </div>
        </CardContent>
      </Card>

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
                    {favNames.data?.[cid] ?? '…'}
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
