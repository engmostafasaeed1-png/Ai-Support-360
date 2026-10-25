import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Copy, History, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useInvalidatePolicies, usePolicy, useSlaSettings } from '@/hooks/useSla';
import * as api from '@/lib/sla/api';
import {
  APPLIES_KINDS, CHANNELS, CLOCK_KINDS, diffPolicies, hasErrors, hoursPerDay, normalizeBody, PAUSE_KEYS, policyProblems, previewDue, RECIPIENTS,
  resolveCalendar, SEVERITY_KEYS, START_RULES, STEP_TEMPLATES, STOP_RULES, zonedToUtc, type EscalationStep, type PolicyBody, type PolicyMeta, type PolicyProblem,
  type SeverityKey, DEFAULT_BOUNDS,
} from '@/lib/sla/policy';
import { coverageText, dayLabel, fmtAt, langOf, slaErrorText } from './slaUi';

type Unit = 'min' | 'h' | 'd';

/** Number + unit; "d" is a business day (the window length) for business-hour policies, else 24 h. */
function DurationInput({ id, value, onChange, mode, hpd, allowEmpty }: {
  id: string; value: number | null; onChange: (v: number | null) => void; mode: PolicyBody['coverage']['mode']; hpd: number; allowEmpty?: boolean;
}) {
  const { t } = useTranslation();
  const dayMin = mode === 'business' && hpd > 0 ? hpd * 60 : 1440;
  const pickUnit = (v: number | null): Unit => (v && v % dayMin === 0 ? 'd' : v && v % 60 === 0 ? 'h' : 'min');
  const [unit, setUnit] = useState<Unit>(pickUnit(value));
  const factor = unit === 'd' ? dayMin : unit === 'h' ? 60 : 1;
  const shown = value === null ? '' : String(Math.round((value / factor) * 100) / 100);
  return (
    <div className="flex gap-1">
      <Input id={id} type="number" min={0} step="any" inputMode="decimal" className="h-8 w-20 text-xs" value={shown}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '' && allowEmpty) return onChange(null);
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * factor));
        }} />
      <Select value={unit} onValueChange={(u) => setUnit(u as Unit)}>
        <SelectTrigger className="h-8 w-32 text-xs" aria-label={t('sla.editor.unit')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="min">{t('sla.unit.min')}</SelectItem>
          <SelectItem value="h">{t('sla.unit.h')}</SelectItem>
          <SelectItem value="d">{mode === 'business' ? t('sla.unit.bd') : t('sla.unit.d')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

const newStep = (): EscalationStep => ({ clock: 'response', kind: 'percent', value: 75, who: ['lead'], channels: ['in_app'], template: 'reminder', repeat_min: null, until_ack: false, unpausable: false });

export default function SlaPolicyEditor({ policyId, tenantId, onClose }: { policyId: string; tenantId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const { data: p, isLoading, refetch } = usePolicy(policyId);
  const settings = useSlaSettings().data;
  const invalidate = useInvalidatePolicies();
  const [body, setBody] = useState<PolicyBody | null>(null);
  const [meta, setMeta] = useState<PolicyMeta | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<PolicyProblem[]>([]);
  const [sevTab, setSevTab] = useState<SeverityKey>('S1');
  const [activateOpen, setActivateOpen] = useState(false);
  const [effective, setEffective] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffWith, setDiffWith] = useState<number | null>(null);
  const [diffBody, setDiffBody] = useState<{ body: PolicyBody; meta: PolicyMeta } | null>(null);
  const [newHoliday, setNewHoliday] = useState('');
  const [contact, setContact] = useState('');
  const [prevSev, setPrevSev] = useState<SeverityKey>('S2');
  const [prevAt, setPrevAt] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(17, 0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T17:00`;
  });

  useEffect(() => {
    if (p?.body) { setBody(normalizeBody(p.body)); setMeta({ name: p.meta?.name ?? p.name, description: p.meta?.description ?? p.description ?? '', applies_to: p.meta?.applies_to ?? p.applies_to }); setServerProblems(p.problems ?? []); }
  }, [p?.id, p?.current_version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (diffWith === null) { setDiffBody(null); return; }
    void api.fetchPolicyVersion(policyId, diffWith).then((v) => setDiffBody({ body: normalizeBody(v.body), meta: v.meta })).catch(() => setDiffBody(null));
  }, [diffWith, policyId]);

  const bounds = settings?.bounds ?? DEFAULT_BOUNDS;
  const problems = useMemo(() => (body && meta ? policyProblems(body, meta, {
    bounds, unpausableAllowed: settings?.unpausable_allowed ?? true,
    allowedDomains: p?.company_domain ? [p.company_domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase()] : [],
    memberEmails: p?.member_emails ?? undefined,
  }) : []), [body, meta, bounds, settings?.unpausable_allowed, p?.company_domain, p?.member_emails]);

  if (isLoading || !p || !body || !meta) return <Skeleton className="h-96 w-full rounded-2xl" />;
  const readOnly = !p.can_manage || p.status === 'archived';
  const cov = body.coverage;
  const hpd = hoursPerDay(cov);
  const cal = resolveCalendar(cov, null);
  const sev = body.severities[sevTab];
  const setSevField = (k: SeverityKey, patch: Partial<PolicyBody['severities'][SeverityKey]>) =>
    setBody({ ...body, severities: { ...body.severities, [k]: { ...body.severities[k], ...patch } } });
  const setStep = (i: number, patch: Partial<EscalationStep>) => setSevField(sevTab, { escalations: sev.escalations.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allProblems = [...problems, ...serverProblems.filter((s) => s.code.startsWith('contact_') && !problems.some((x) => x.code === s.code && x.params?.email === s.params?.email))];
  const errors = hasErrors(allProblems);
  const sevLabel = (k: SeverityKey) => {
    const d = settings?.severities.find((x) => x.key === k);
    return `${k} · ${d ? (lang === 'ar' ? d.label_ar : d.label_en) : ''}`;
  };

  // The preview time is a wall-clock time in the policy's counting time zone (not the browser's).
  const pm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(prevAt);
  const opened = pm ? zonedToUtc(+pm[1], +pm[2], +pm[3], +pm[4], +pm[5], cal.tz) : NaN;
  const due = Number.isFinite(opened) ? previewDue(body, prevSev, opened, cal) : null;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.savePolicy({ id: p.id, tenant: p.tenant_id ?? tenantId, meta, body, note, lock: p.lock_version });
      setServerProblems(r.problems ?? []);
      toast.success(r.unchanged ? t('sla.editor.unchanged') : t('sla.editor.saved', { version: r.version }));
      setNote('');
      invalidate(); await refetch();
    } catch (e) { toast.error(slaErrorText(t, e)); } finally { setBusy(false); }
  };
  const activate = async () => {
    setBusy(true);
    try {
      const r = await api.activatePolicy(p.id, p.current_version, effective ? new Date(effective).toISOString() : null, applyOpen);
      toast.success(t('sla.editor.activated', { count: r.tickets_updated }));
      setActivateOpen(false); invalidate(); await refetch();
    } catch (e) { toast.error(slaErrorText(t, e)); } finally { setBusy(false); }
  };
  const dirty = JSON.stringify(normalizeBody(p.body)) !== JSON.stringify(body) || p.name !== meta.name || (p.description ?? '') !== meta.description || JSON.stringify(p.applies_to) !== JSON.stringify(meta.applies_to);

  return (
    <div className="space-y-4" data-testid="sla-editor">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden /> {t('sla.editor.back')}</Button>
        <h2 className="text-lg font-semibold">{meta.name}</h2>
        <Badge variant="outline">{t(`sla.status.${p.status}`)}</Badge>
        <Badge variant="secondary">v{p.current_version}{p.active_version ? ` · ${t('sla.editor.activeV', { v: p.active_version })}` : ''}</Badge>
        {p.is_default && <Badge>{t('sla.editor.platformDefault')}</Badge>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}><History className="me-1 h-4 w-4" aria-hidden /> {t('sla.editor.history')}</Button>
          {p.scope === 'client' && p.can_manage && (
            <Button variant="outline" size="sm" busy={busy} onClick={async () => {
              try { await api.duplicatePolicy(p.id, p.tenant_id ?? tenantId, null); invalidate(); toast.success(t('sla.editor.duplicated')); } catch (e) { toast.error(slaErrorText(t, e)); }
            }}><Copy className="me-1 h-4 w-4" aria-hidden /> {t('sla.editor.duplicate')}</Button>
          )}
        </div>
      </div>
      {readOnly && <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t('sla.editor.readOnly')}</p>}

      <fieldset disabled={readOnly} className="space-y-4">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.basics')}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="sla-name">{t('sla.editor.name')}</Label><Input id="sla-name" maxLength={120} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></div>
            <div className="space-y-1">
              <Label htmlFor="sla-applies">{t('sla.editor.appliesTo')}</Label>
              <div className="flex gap-2">
                <Select value={meta.applies_to.kind} onValueChange={(v) => setMeta({ ...meta, applies_to: { kind: v as PolicyMeta['applies_to']['kind'], values: v === 'all' ? [] : meta.applies_to.values } })}>
                  <SelectTrigger id="sla-applies" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{APPLIES_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`sla.applies.${k}`)}</SelectItem>)}</SelectContent>
                </Select>
                {meta.applies_to.kind !== 'all' && (
                  <Input aria-label={t('sla.editor.appliesValues')} placeholder="FI, MM" value={meta.applies_to.values.join(', ')}
                    onChange={(e) => setMeta({ ...meta, applies_to: { ...meta.applies_to, values: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20) } })} />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('sla.editor.tagNote')}</p>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="sla-desc">{t('sla.editor.description')}</Label><Textarea id="sla-desc" rows={2} maxLength={1000} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.targets')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.editor.targetsHint')}</p></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead><tr className="text-muted-foreground"><th className="py-1 text-start">{t('sla.editor.severity')}</th><th className="text-start">{t('sla.clock.response')}</th><th className="text-start">{t('sla.clock.workaround')}</th><th className="text-start">{t('sla.clock.resolution')}</th></tr></thead>
              <tbody>
                {SEVERITY_KEYS.map((k) => (
                  <tr key={k} className="border-t border-border/50">
                    <td className="py-2 font-medium">{sevLabel(k)}<p className="text-[10px] font-normal text-muted-foreground">{t('sla.editor.minimum', { r: bounds.min_response[k], res: bounds.min_resolution[k] })}</p></td>
                    <td><DurationInput id={`sla-${k}-r`} value={body.severities[k].response_min} mode={cov.mode} hpd={hpd} onChange={(v) => setSevField(k, { response_min: v ?? 0 })} /></td>
                    <td><DurationInput id={`sla-${k}-w`} value={body.severities[k].workaround_min} allowEmpty mode={cov.mode} hpd={hpd} onChange={(v) => setSevField(k, { workaround_min: v })} /></td>
                    <td><DurationInput id={`sla-${k}-res`} value={body.severities[k].resolution_min} mode={cov.mode} hpd={hpd} onChange={(v) => setSevField(k, { resolution_min: v ?? 0 })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.coverage')}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex flex-wrap gap-2">
                {(['24x7', 'business'] as const).map((m) => (
                  <Button key={m} type="button" size="sm" variant={cov.mode === m ? 'default' : 'outline'} disabled={!bounds.allowed_coverage.includes(m)}
                    onClick={() => setBody({ ...body, coverage: { ...cov, mode: m, ...(m === '24x7' ? {} : { days: cov.days.length === 7 ? [0, 1, 2, 3, 4] : cov.days, start: cov.start === '00:00' ? '09:00' : cov.start, end: cov.end === '23:59' ? '17:00' : cov.end }) } })}>
                    {t(`sla.coverage.${m === '24x7' ? 'mode24' : 'modeBusiness'}`)}
                  </Button>
                ))}
              </div>
              {cov.mode === 'business' && (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('sla.editor.days')}>
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <Button key={d} type="button" size="sm" className="h-7 px-2 text-xs" variant={cov.days.includes(d) ? 'default' : 'outline'} aria-pressed={cov.days.includes(d)}
                        onClick={() => setBody({ ...body, coverage: { ...cov, days: toggle(cov.days.map(String), String(d)).map(Number).sort() } })}>{dayLabel(t, d)}</Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div><Label htmlFor="sla-start">{t('sla.editor.start')}</Label><Input id="sla-start" type="time" className="h-8 w-28" value={cov.start} onChange={(e) => setBody({ ...body, coverage: { ...cov, start: e.target.value } })} /></div>
                    <div><Label htmlFor="sla-end">{t('sla.editor.end')}</Label><Input id="sla-end" type="time" className="h-8 w-28" value={cov.end} onChange={(e) => setBody({ ...body, coverage: { ...cov, end: e.target.value } })} /></div>
                    <div className="flex-1"><Label htmlFor="sla-tz">{t('sla.editor.tz')}</Label><Input id="sla-tz" className="h-8" placeholder={t('sla.coverage.companyTz')} value={cov.tz ?? ''} onChange={(e) => setBody({ ...body, coverage: { ...cov, tz: e.target.value.trim() || null } })} /></div>
                  </div>
                  <div className="space-y-1">
                    <Label>{t('sla.editor.holidays')}</Label>
                    {(settings?.holiday_lists ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-3">{settings!.holiday_lists.map((l) => (
                        <label key={l} className="flex items-center gap-1.5"><Checkbox checked={cov.holiday_lists.includes(l)} onCheckedChange={() => setBody({ ...body, coverage: { ...cov, holiday_lists: toggle(cov.holiday_lists, l) } })} />{t('sla.editor.nationalList', { list: l })}</label>
                      ))}</div>
                    )}
                    <div className="flex gap-2"><Input type="date" className="h-8 w-40" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} aria-label={t('sla.editor.addHoliday')} />
                      <Button type="button" size="sm" variant="outline" disabled={!newHoliday} onClick={() => { setBody({ ...body, coverage: { ...cov, holidays: [...new Set([...cov.holidays, newHoliday])].sort() } }); setNewHoliday(''); }}><Plus className="h-3.5 w-3.5" aria-hidden /> {t('sla.editor.addHoliday')}</Button></div>
                    <div className="flex flex-wrap gap-1">{cov.holidays.map((h) => (
                      <Badge key={h} variant="secondary" className="gap-1">{h}<button type="button" aria-label={t('sla.editor.remove')} onClick={() => setBody({ ...body, coverage: { ...cov, holidays: cov.holidays.filter((x) => x !== h) } })}>×</button></Badge>
                    ))}</div>
                  </div>
                </>
              )}
              <p className="text-muted-foreground">{coverageText(t, cal)}</p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.clock')}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>{t('sla.editor.startRule')}</Label>
                  <Select value={body.clock.start} onValueChange={(v) => setBody({ ...body, clock: { ...body.clock, start: v as PolicyBody['clock']['start'] } })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{START_RULES.filter((r) => bounds.allowed_start.includes(r)).map((r) => <SelectItem key={r} value={r}>{t(`sla.start.${r}`)}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>{t('sla.editor.stopRule')}</Label>
                  <Select value={body.clock.stop} onValueChange={(v) => setBody({ ...body, clock: { ...body.clock, stop: v as PolicyBody['clock']['stop'] } })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{STOP_RULES.map((r) => <SelectItem key={r} value={r}>{t(`sla.stop.${r}`)}</SelectItem>)}</SelectContent>
                  </Select></div>
              </div>
              <div className="space-y-1.5"><Label>{t('sla.editor.pauses')}</Label>
                {PAUSE_KEYS.filter((k) => bounds.allowed_pause.includes(k)).map((k) => (
                  <label key={k} className="flex items-center gap-2"><Checkbox checked={body.clock.pause.includes(k)} onCheckedChange={() => setBody({ ...body, clock: { ...body.clock, pause: toggle(body.clock.pause, k) } })} />{t(`sla.pause.${k}`)}</label>
                ))}
                <p className="text-muted-foreground">{t('sla.editor.outsideNote')}</p>
              </div>
              <div className="space-y-1.5"><Label>{t('sla.editor.breach')}</Label>
                {(['notify', 'flag', 'ask_client', 'offer_replacement'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2"><Checkbox checked={body.breach[k]} onCheckedChange={(v) => setBody({ ...body, breach: { ...body.breach, [k]: v === true } })} />{t(`sla.breach.${k}`)}</label>
                ))}
                <p className="text-muted-foreground">{t('sla.editor.noPenalty')}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.ladder')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.editor.ladderHint', { max: bounds.max_escalations })}</p></CardHeader>
          <CardContent className="space-y-3">
            <Tabs value={sevTab} onValueChange={(v) => setSevTab(v as SeverityKey)}>
              <TabsList>{SEVERITY_KEYS.map((k) => <TabsTrigger key={k} value={k}>{k}</TabsTrigger>)}</TabsList>
              <TabsContent value={sevTab} className="space-y-2">
                {sev.escalations.map((st, i) => (
                  <div key={i} className="grid gap-2 rounded-xl border border-border/60 p-2.5 text-xs md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
                    <div><Label className="text-[11px]">{t('sla.step.clock')}</Label>
                      <Select value={st.clock} onValueChange={(v) => setStep(i, { clock: v as EscalationStep['clock'] })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{CLOCK_KINDS.map((c) => <SelectItem key={c} value={c}>{t(`sla.clock.${c}`)}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label className="text-[11px]">{t('sla.step.when')}</Label>
                      <div className="flex gap-1">
                        <Input type="number" className="h-8 w-16" value={st.value} min={1} onChange={(e) => setStep(i, { value: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('sla.step.value')} />
                        <Select value={st.kind} onValueChange={(v) => setStep(i, { kind: v as EscalationStep['kind'] })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="percent">{t('sla.step.percent')}</SelectItem><SelectItem value="after_breach">{t('sla.step.afterBreach')}</SelectItem></SelectContent></Select>
                      </div></div>
                    <div><Label className="text-[11px]">{t('sla.step.template')}</Label>
                      <Select value={st.template} onValueChange={(v) => setStep(i, { template: v as EscalationStep['template'] })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>{STEP_TEMPLATES.map((x) => <SelectItem key={x} value={x}>{t(`sla.template.${x}`)}</SelectItem>)}</SelectContent></Select></div>
                    <div><Label className="text-[11px]">{t('sla.step.repeat')}</Label>
                      <Input type="number" className="h-8" min={30} placeholder={t('sla.step.once')} value={st.repeat_min ?? ''} onChange={(e) => setStep(i, { repeat_min: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                    <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={t('sla.editor.remove')} onClick={() => setSevField(sevTab, { escalations: sev.escalations.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    <div className="md:col-span-5 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">{t('sla.step.who')}:</span>
                      {RECIPIENTS.map((w) => <label key={w} className="flex items-center gap-1"><Checkbox checked={st.who.includes(w)} onCheckedChange={() => setStep(i, { who: toggle(st.who, w) })} />{t(`sla.who.${w}`)}</label>)}
                    </div>
                    <div className="md:col-span-5 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="text-muted-foreground">{t('sla.step.channels')}:</span>
                      {CHANNELS.map((c) => <label key={c} className="flex items-center gap-1"><Checkbox checked={st.channels.includes(c)} onCheckedChange={() => setStep(i, { channels: toggle(st.channels, c) })} />{t(`sla.channel.${c}`)}</label>)}
                      <label className="flex items-center gap-1"><Checkbox checked={st.until_ack} onCheckedChange={(v) => setStep(i, { until_ack: v === true })} />{t('sla.step.untilAck')}</label>
                      {sevTab === 'S1' && (settings?.unpausable_allowed ?? true) && <label className="flex items-center gap-1"><Checkbox checked={st.unpausable} onCheckedChange={(v) => setStep(i, { unpausable: v === true })} />{t('sla.step.unpausable')}</label>}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={sev.escalations.length >= bounds.max_escalations} onClick={() => setSevField(sevTab, { escalations: [...sev.escalations, newStep()] })}><Plus className="me-1 h-3.5 w-3.5" aria-hidden /> {t('sla.editor.addStep')}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setBody({ ...body, severities: Object.fromEntries(SEVERITY_KEYS.map((k) => [k, { ...body.severities[k], escalations: k === 'S1' ? sev.escalations : sev.escalations.map((s) => ({ ...s, unpausable: false })) }])) as PolicyBody['severities'] })}>{t('sla.editor.copyAll')}</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{t('sla.editor.noSms')}</p>
              </TabsContent>
            </Tabs>
            <div className="space-y-1 text-xs">
              <Label htmlFor="sla-extra">{t('sla.editor.extra')}</Label>
              <div className="flex gap-2"><Input id="sla-extra" type="email" className="h-8" value={contact} onChange={(e) => setContact(e.target.value)} placeholder={p.company_domain ? `name@${p.company_domain}` : ''} />
                <Button type="button" size="sm" variant="outline" disabled={!contact.includes('@')} onClick={() => { setBody({ ...body, extra_contacts: [...new Set([...body.extra_contacts, contact.trim().toLowerCase()])] }); setContact(''); }}>{t('sla.editor.add')}</Button></div>
              <div className="flex flex-wrap gap-1">{body.extra_contacts.map((e) => <Badge key={e} variant="secondary" className="gap-1">{e}<button type="button" aria-label={t('sla.editor.remove')} onClick={() => setBody({ ...body, extra_contacts: body.extra_contacts.filter((x) => x !== e) })}>×</button></Badge>)}</div>
              <p className="text-muted-foreground">{t('sla.editor.extraHint')}</p>
            </div>
          </CardContent>
        </Card>
      </fieldset>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.preview')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              <Select value={prevSev} onValueChange={(v) => setPrevSev(v as SeverityKey)}><SelectTrigger className="h-8 w-28" aria-label={t('sla.editor.severity')}><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITY_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select>
              <Input type="datetime-local" className="h-8 w-56" value={prevAt} onChange={(e) => setPrevAt(e.target.value)} aria-label={t('sla.editor.openedAt')} />
            </div>
            {due && (
              <p className="rounded-xl bg-muted/50 p-3 text-foreground" aria-live="polite">
                {t('sla.editor.previewLine', { sev: prevSev, opened: fmtAt(opened, cal.tz, lang), response: fmtAt(due.response, cal.tz, lang), resolution: fmtAt(due.resolution, cal.tz, lang) })}
                {due.workaround && ` ${t('sla.editor.previewWorkaround', { at: fmtAt(due.workaround, cal.tz, lang) })}`}
              </p>
            )}
            <p className="text-muted-foreground">{t('sla.editor.previewTz', { tz: cal.tz })}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.editor.checks')}</CardTitle></CardHeader>
          <CardContent className="text-xs">
            {allProblems.length === 0 ? <p className="text-success">{t('sla.editor.allGood')}</p> : (
              <ul className="space-y-1">{allProblems.map((x, i) => (
                <li key={`${x.code}-${i}`} className={x.level === 'error' ? 'text-destructive' : 'text-foreground'}>
                  {x.level === 'error' ? '✕' : '!'} {t(`sla.problem.${x.code}`, { ...x.params, defaultValue: x.code })}
                </li>
              ))}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="me-1 inline h-3.5 w-3.5" aria-hidden />{t('sla.disclaimer')}</p>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-end gap-2 rounded-2xl border border-border/60 bg-background/95 p-3 backdrop-blur">
          <div className="min-w-[200px] flex-1"><Label htmlFor="sla-note" className="text-xs">{t('sla.editor.changeNote')}</Label><Input id="sla-note" className="h-8" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button variant="outline" busy={busy} disabled={!dirty} onClick={save}><Save className="me-1 h-4 w-4" aria-hidden /> {t('sla.editor.saveDraft')}</Button>
          <Button busy={busy} disabled={dirty || errors} onClick={() => setActivateOpen(true)} title={dirty ? t('sla.editor.saveFirst') : errors ? t('sla.editor.fixFirst') : undefined}>{t('sla.editor.activate')}</Button>
          {p.scope !== 'platform' && p.status !== 'archived' && (
            <Button variant="ghost" className="text-destructive" busy={busy} onClick={async () => {
              try { await api.archivePolicy(p.id, ''); invalidate(); toast.success(t('sla.editor.archived')); onClose(); } catch (e) { toast.error(slaErrorText(t, e)); }
            }}>{t('sla.editor.archive')}</Button>
          )}
        </div>
      )}

      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader className="text-start"><DialogTitle>{t('sla.editor.activateTitle', { v: p.current_version })}</DialogTitle>
            <DialogDescription>{t('sla.editor.activateText')}</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><Label htmlFor="sla-eff">{t('sla.editor.effective')}</Label><Input id="sla-eff" type="datetime-local" value={effective} onChange={(e) => { setEffective(e.target.value); if (e.target.value) setApplyOpen(false); }} />
              <p className="text-xs text-muted-foreground">{t('sla.editor.effectiveHint')}</p></div>
            {p.scope === 'client' && (
              <label className="flex items-start gap-2"><Switch checked={applyOpen} disabled={!!effective} onCheckedChange={setApplyOpen} /><span className="text-xs">{t('sla.editor.applyOpen')}</span></label>
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setActivateOpen(false)}>{t('sla.action.cancel')}</Button><Button busy={busy} onClick={activate}>{t('sla.editor.activateConfirm')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={(o) => { setHistoryOpen(o); if (!o) setDiffWith(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader className="text-start"><DialogTitle>{t('sla.editor.history')}</DialogTitle><DialogDescription>{t('sla.editor.historyText')}</DialogDescription></DialogHeader>
          <ul className="space-y-2 text-xs">
            {p.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 p-2">
                <Badge variant={v.version === p.active_version ? 'default' : 'outline'}>v{v.version}</Badge>
                <span className="text-muted-foreground">{fmtAt(v.created_at, undefined, lang)}{v.by_admin ? ` · ${t('sla.editor.byAdmin')}` : ''}</span>
                <span className="flex-1">{v.change_note}</span>
                {v.version !== p.current_version && <Button size="sm" variant="ghost" onClick={() => setDiffWith(v.version)}>{t('sla.editor.compare')}</Button>}
                {v.version !== p.current_version && p.can_manage && p.status !== 'archived' && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    try { await api.restorePolicy(p.id, v.version); invalidate(); await refetch(); toast.success(t('sla.editor.restored', { v: v.version })); setHistoryOpen(false); } catch (e) { toast.error(slaErrorText(t, e)); }
                  }}><RotateCcw className="me-1 h-3.5 w-3.5" aria-hidden /> {t('sla.editor.restore')}</Button>
                )}
              </li>
            ))}
          </ul>
          {diffBody && (
            <div className="space-y-1 text-xs">
              <p className="font-medium">{t('sla.editor.diffTitle', { a: diffWith, b: p.current_version })}</p>
              <table className="w-full"><tbody>
                {diffPolicies({ body: diffBody.body, meta: diffBody.meta }, { body: normalizeBody(p.body), meta: p.meta }).map((d) => (
                  <tr key={d.path} className="border-t border-border/50"><td className="py-1 pe-2 font-mono text-[10px] text-muted-foreground">{d.path}</td><td className="text-destructive line-through">{String(d.before ?? '—')}</td><td className="text-success">{String(d.after ?? '—')}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
