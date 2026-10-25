import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Mail, ShieldCheck, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSlaReport, useSlaSettings } from '@/hooks/useSla';
import * as api from '@/lib/sla/api';
import { CHANNELS, COVERAGE_MODES, PAUSE_KEYS, SEVERITY_KEYS, START_RULES, URGENCIES, type SlaSettings } from '@/lib/sla/policy';
import SlaPolicyEditor from '@/components/sla/SlaPolicyEditor';
import { ComplianceView } from '@/components/sla/SlaComplianceCards';
import { fmtAt, langOf, slaErrorText } from '@/components/sla/slaUi';

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export default function AdminSlaPage() {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const qc = useQueryClient();
  const { data: settings, isLoading } = useSlaSettings();
  const [draft, setDraft] = useState<SlaSettings | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [openPolicy, setOpenPolicy] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [hList, setHList] = useState('SA');
  const [hDay, setHDay] = useState('');
  const [hEn, setHEn] = useState('');
  const [hAr, setHAr] = useState('');
  const [simTicket, setSimTicket] = useState('');
  const [sim, setSim] = useState<Awaited<ReturnType<typeof api.simulate>> | null>(null);
  const [testKind, setTestKind] = useState('reminder');

  useEffect(() => { if (settings) setDraft(settings); }, [settings]);
  const policies = useQuery({ queryKey: ['sla-admin-policies'], queryFn: () => api.fetchAdminPolicies(null, null), enabled: !!settings?.ready, retry: false });
  const holidays = useQuery({ queryKey: ['sla-holidays'], queryFn: api.fetchHolidays, enabled: !!settings?.ready, retry: false });
  const report = useSlaReport('admin', days);

  if (isLoading || !draft) return <div className="p-6"><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  if (!settings?.ready) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Timer className="h-6 w-6 text-primary" aria-hidden /> {t('sla.admin.title')}</h1>
        <Card className="rounded-2xl"><CardContent className="space-y-2 p-5 text-sm"><p className="font-medium">{t('sla.admin.notReadyTitle')}</p><p className="text-muted-foreground">{t('sla.admin.notReadyText')}</p></CardContent></Card>
      </div>
    );
  }
  if (openPolicy) return <div className="p-4 md:p-6"><SlaPolicyEditor policyId={openPolicy} tenantId={null} onClose={() => setOpenPolicy(null)} /></div>;

  const saveSettings = async (patch: Partial<SlaSettings>) => {
    setBusy(true);
    try {
      await api.saveAdminSettings(patch, reason);
      toast.success(t('sla.admin.saved'));
      setReason('');
      await qc.invalidateQueries({ queryKey: ['sla-settings'] });
    } catch (e) { toast.error(slaErrorText(t, e)); } finally { setBusy(false); }
  };
  const b = draft.bounds;
  const setB = (patch: Partial<SlaSettings['bounds']>) => setDraft({ ...draft, bounds: { ...b, ...patch } });
  const exportCsv = () => {
    const rows = report.data?.breaches ?? [];
    const head = ['ticket', 'company', 'consultant', 'severity', 'clock', 'reason', 'target_min', 'used_min', 'breached_at', 'met_at', 'acknowledged', 'had_pauses'];
    const body = rows.map((r) => [r.title, r.company, r.consultant, r.severity, r.kind, r.reason, Math.round(r.target), Math.round(r.used), r.breached_at, r.met_at, r.acknowledged, r.had_pauses].map(csvCell).join(','));
    const blob = new Blob([`\uFEFF${[head.join(','), ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sla-breaches-${days}d.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Timer className="h-6 w-6 text-primary" aria-hidden /> {t('sla.admin.title')}</h1>
        <Badge variant={settings.enabled ? 'default' : 'outline'}>{settings.enabled ? t('sla.admin.on') : t('sla.admin.off')}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t('sla.admin.intro')}</p>

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="settings">{t('sla.admin.tabSettings')}</TabsTrigger>
          <TabsTrigger value="policies">{t('sla.admin.tabPolicies')}</TabsTrigger>
          <TabsTrigger value="holidays">{t('sla.admin.tabHolidays')}</TabsTrigger>
          <TabsTrigger value="compliance">{t('sla.admin.tabCompliance')}</TabsTrigger>
          <TabsTrigger value="simulate">{t('sla.admin.tabSimulate')}</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="space-y-4">
          <Card className="rounded-2xl">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <Switch id="sla-enabled" checked={settings.enabled} disabled={busy} onCheckedChange={(v) => saveSettings({ enabled: v })} />
              <Label htmlFor="sla-enabled" className="flex-1"><span className="font-medium">{t('sla.admin.enabled')}</span><span className="block text-xs text-muted-foreground">{t('sla.admin.enabledHint')}</span></Label>
              <Input className="h-8 max-w-xs" placeholder={t('sla.admin.reason')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('sla.admin.reason')} />
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.admin.severities')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.admin.severitiesHint')}</p></CardHeader>
            <CardContent className="space-y-3">
              {draft.severities.map((s, i) => (
                <div key={s.key} className="grid gap-2 rounded-xl border border-border/60 p-3 text-xs md:grid-cols-4">
                  <div className="font-semibold">{s.key}
                    <Select value={s.color} onValueChange={(v) => setDraft({ ...draft, severities: draft.severities.map((x, j) => (j === i ? { ...x, color: v as typeof s.color } : x)) })}>
                      <SelectTrigger className="mt-1 h-8" aria-label={t('sla.admin.colour')}><SelectValue /></SelectTrigger>
                      <SelectContent>{(['destructive', 'warning', 'info', 'muted'] as const).map((c) => <SelectItem key={c} value={c}>{t(`sla.admin.colourName.${c}`)}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label className="text-[11px]">{t('sla.admin.labelEn')}</Label><Input className="h-8" value={s.label_en} onChange={(e) => setDraft({ ...draft, severities: draft.severities.map((x, j) => (j === i ? { ...x, label_en: e.target.value } : x)) })} />
                    <Label className="text-[11px]">{t('sla.admin.labelAr')}</Label><Input dir="rtl" className="h-8" value={s.label_ar} onChange={(e) => setDraft({ ...draft, severities: draft.severities.map((x, j) => (j === i ? { ...x, label_ar: e.target.value } : x)) })} /></div>
                  <div><Label className="text-[11px]">{t('sla.admin.defEn')}</Label><Textarea rows={3} value={s.definition_en} onChange={(e) => setDraft({ ...draft, severities: draft.severities.map((x, j) => (j === i ? { ...x, definition_en: e.target.value } : x)) })} /></div>
                  <div><Label className="text-[11px]">{t('sla.admin.defAr')}</Label><Textarea dir="rtl" rows={3} value={s.definition_ar} onChange={(e) => setDraft({ ...draft, severities: draft.severities.map((x, j) => (j === i ? { ...x, definition_ar: e.target.value } : x)) })} /></div>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-muted-foreground">{t('sla.admin.mapping')}</span>
                {URGENCIES.map((u) => (
                  <label key={u} className="flex items-center gap-1">{t(`sla.urgency.${u}`)} →
                    <Select value={draft.urgency_map[u]} onValueChange={(v) => setDraft({ ...draft, urgency_map: { ...draft.urgency_map, [u]: v as typeof draft.urgency_map.low } })}>
                      <SelectTrigger className="h-7 w-16"><SelectValue /></SelectTrigger>
                      <SelectContent>{SEVERITY_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                    </Select></label>
                ))}
              </div>
              <Button size="sm" busy={busy} onClick={() => saveSettings({ severities: draft.severities, urgency_map: draft.urgency_map })}>{t('sla.admin.save')}</Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.admin.bounds')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.admin.boundsHint')}</p></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <table className="w-full max-w-lg"><thead><tr className="text-muted-foreground"><th className="text-start">{t('sla.editor.severity')}</th><th className="text-start">{t('sla.admin.minResponse')}</th><th className="text-start">{t('sla.admin.minResolution')}</th></tr></thead>
                <tbody>{SEVERITY_KEYS.map((k) => (
                  <tr key={k}><td className="py-1">{k}</td>
                    <td><Input type="number" min={1} className="h-8 w-24" value={b.min_response[k]} onChange={(e) => setB({ min_response: { ...b.min_response, [k]: Math.max(1, Number(e.target.value) || 1) } })} /></td>
                    <td><Input type="number" min={1} className="h-8 w-24" value={b.min_resolution[k]} onChange={(e) => setB({ min_resolution: { ...b.min_resolution, [k]: Math.max(1, Number(e.target.value) || 1) } })} /></td></tr>
                ))}</tbody></table>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">{t('sla.admin.maxSteps')}<Input type="number" min={1} max={20} className="h-8 w-16" value={b.max_escalations} onChange={(e) => setB({ max_escalations: Number(e.target.value) || 1 })} /></label>
                <label className="flex items-center gap-2">{t('sla.admin.maxRepeats')}<Input type="number" min={0} max={24} className="h-8 w-16" value={b.max_repeats} onChange={(e) => setB({ max_repeats: Number(e.target.value) || 0 })} /></label>
                <label className="flex items-center gap-2">{t('sla.admin.minRepeat')}<Input type="number" min={30} className="h-8 w-20" value={b.min_repeat_min} onChange={(e) => setB({ min_repeat_min: Math.max(30, Number(e.target.value) || 30) })} /></label>
                <label className="flex items-center gap-2">{t('sla.admin.premiumS1')}<Input type="number" min={1} className="h-8 w-20" value={b.premium.find((p) => p.severity === 'S1')?.under_min ?? 60}
                  onChange={(e) => setB({ premium: [{ severity: 'S1', field: 'response', under_min: Math.max(1, Number(e.target.value) || 60), requires: 'critical_service' }] })} /></label>
              </div>
              <div className="flex flex-wrap gap-4">
                <span className="text-muted-foreground">{t('sla.admin.allowedCoverage')}</span>
                {COVERAGE_MODES.map((m) => <label key={m} className="flex items-center gap-1"><Checkbox checked={b.allowed_coverage.includes(m)} onCheckedChange={(v) => setB({ allowed_coverage: v ? [...b.allowed_coverage, m] : b.allowed_coverage.filter((x) => x !== m) })} />{t(`sla.coverage.${m === '24x7' ? 'mode24' : 'modeBusiness'}`)}</label>)}
              </div>
              <div className="flex flex-wrap gap-4">
                <span className="text-muted-foreground">{t('sla.admin.allowedStart')}</span>
                {START_RULES.map((m) => <label key={m} className="flex items-center gap-1"><Checkbox checked={b.allowed_start.includes(m)} onCheckedChange={(v) => setB({ allowed_start: v ? [...b.allowed_start, m] : b.allowed_start.filter((x) => x !== m) })} />{t(`sla.start.${m}`)}</label>)}
              </div>
              <div className="flex flex-wrap gap-4">
                <span className="text-muted-foreground">{t('sla.admin.allowedPause')}</span>
                {PAUSE_KEYS.map((m) => <label key={m} className="flex items-center gap-1"><Checkbox checked={b.allowed_pause.includes(m)} onCheckedChange={(v) => setB({ allowed_pause: v ? [...b.allowed_pause, m] : b.allowed_pause.filter((x) => x !== m) })} />{t(`sla.pause.${m}`)}</label>)}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">{t('sla.admin.atRisk')}<Input type="number" min={50} max={99} className="h-8 w-16" value={draft.at_risk_pct} onChange={(e) => setDraft({ ...draft, at_risk_pct: Number(e.target.value) || 75 })} /></label>
                <label className="flex items-center gap-2">{t('sla.admin.alertPct')}<Input type="number" min={1} max={100} className="h-8 w-16" value={draft.compliance_alert_pct} onChange={(e) => setDraft({ ...draft, compliance_alert_pct: Number(e.target.value) || 90 })} /></label>
                <label className="flex items-center gap-2">{t('sla.admin.quiet')}<Input type="time" className="h-8 w-24" value={draft.quiet_hours.start} onChange={(e) => setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, start: e.target.value } })} />–<Input type="time" className="h-8 w-24" value={draft.quiet_hours.end} onChange={(e) => setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, end: e.target.value } })} /></label>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2"><Switch checked={draft.require_acceptance} onCheckedChange={(v) => setDraft({ ...draft, require_acceptance: v })} />{t('sla.admin.requireAcceptance')}</label>
                <label className="flex items-center gap-2"><Switch checked={draft.unpausable_allowed} onCheckedChange={(v) => setDraft({ ...draft, unpausable_allowed: v })} />{t('sla.admin.unpausable')}</label>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-muted-foreground">{t('sla.admin.channels')}</span>
                {CHANNELS.map((c) => <label key={c} className="flex items-center gap-1"><Checkbox checked={draft.channels_enabled[c]} onCheckedChange={(v) => setDraft({ ...draft, channels_enabled: { ...draft.channels_enabled, [c]: v === true } })} />{t(`sla.channel.${c}`)}</label>)}
                <span className="text-muted-foreground">{t('sla.admin.noSms')}</span>
              </div>
              <Button size="sm" busy={busy} onClick={() => saveSettings({ bounds: draft.bounds, at_risk_pct: draft.at_risk_pct, compliance_alert_pct: draft.compliance_alert_pct, quiet_hours: draft.quiet_hours, require_acceptance: draft.require_acceptance, unpausable_allowed: draft.unpausable_allowed, channels_enabled: draft.channels_enabled })}>{t('sla.admin.save')}</Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.admin.testTitle')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.admin.testHint')}</p></CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <Select value={testKind} onValueChange={setTestKind}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{['reminder', 'escalation', 'breach', 'after_breach'].map((k) => <SelectItem key={k} value={k}>{t(`sla.template.${k}`)}</SelectItem>)}</SelectContent></Select>
              {(['en', 'ar'] as const).map((l) => (
                <Button key={l} size="sm" variant="outline" busy={busy} onClick={async () => {
                  try { const r = await api.sendSlaTestEmail(testKind, l); if (r.ok) toast.success(t('sla.admin.testSent')); else toast.error(r.reason ?? t('sla.err.generic')); } catch (e) { toast.error(slaErrorText(t, e)); }
                }}><Mail className="me-1 h-3.5 w-3.5" aria-hidden /> {t('sla.admin.testSend', { lang: l.toUpperCase() })}</Button>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies">
          {policies.isLoading ? <Skeleton className="h-40 w-full rounded-2xl" /> : (
            <div className="overflow-x-auto rounded-2xl border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start">{t('sla.editor.name')}</th><th className="text-start">{t('sla.admin.scope')}</th><th className="text-start">{t('sla.admin.owner')}</th><th className="text-start">{t('sla.admin.status')}</th><th /></tr></thead>
                <tbody>{(policies.data ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-border/50">
                    <td className="px-3 py-2 font-medium">{p.name}{p.is_default && <Badge className="ms-2">{t('sla.editor.platformDefault')}</Badge>}</td>
                    <td className="text-xs">{t(`sla.scope.${p.scope}`)}</td><td className="text-xs">{p.owner_name ?? '—'}</td>
                    <td className="text-xs">{t(`sla.status.${p.status}`)} · v{p.current_version}</td>
                    <td className="px-3 text-end"><Button size="sm" variant="outline" onClick={() => setOpenPolicy(p.id)}>{p.scope === 'client' ? t('sla.admin.override') : t('sla.center.edit')}</Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="holidays" className="space-y-3">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.admin.holidaysTitle')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.admin.holidaysHint')}</p></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <div><Label>{t('sla.admin.list')}</Label><Input className="h-8 w-24" maxLength={24} value={hList} onChange={(e) => setHList(e.target.value.toUpperCase())} /></div>
                <div><Label>{t('sla.admin.day')}</Label><Input type="date" className="h-8" value={hDay} onChange={(e) => setHDay(e.target.value)} /></div>
                <div><Label>{t('sla.admin.labelEn')}</Label><Input className="h-8" value={hEn} onChange={(e) => setHEn(e.target.value)} /></div>
                <div><Label>{t('sla.admin.labelAr')}</Label><Input dir="rtl" className="h-8" value={hAr} onChange={(e) => setHAr(e.target.value)} /></div>
                <Button size="sm" reason={[!hList && 'choose_option_first', !hDay && 'choose_date_first']} onClick={async () => {
                  try { await api.setHoliday(hList, hDay, hEn, hAr, false); setHDay(''); setHEn(''); setHAr(''); await holidays.refetch(); void qc.invalidateQueries({ queryKey: ['sla-settings'] }); } catch (e) { toast.error(slaErrorText(t, e)); }
                }}>{t('sla.editor.add')}</Button>
              </div>
              <ul className="space-y-1 text-xs">{(holidays.data ?? []).map((h) => (
                <li key={`${h.list}-${h.day}`} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1">
                  <Badge variant="outline">{h.list}</Badge><span>{h.day}</span><span className="flex-1 text-muted-foreground">{lang === 'ar' ? h.label_ar || h.label_en : h.label_en || h.label_ar}</span>
                  <Button size="sm" variant="ghost" onClick={async () => { try { await api.setHoliday(h.list, h.day, '', '', true); await holidays.refetch(); } catch (e) { toast.error(slaErrorText(t, e)); } }}>{t('sla.editor.remove')}</Button>
                </li>
              ))}</ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {[30, 90, 365].map((d) => <Button key={d} size="sm" variant={days === d ? 'default' : 'outline'} onClick={() => setDays(d)}>{t('sla.report.days', { count: d })}</Button>)}
            <Button size="sm" variant="outline" className="ms-auto" reason={!report.data?.breaches?.length && 'nothing_to_export'} onClick={exportCsv}><Download className="me-1 h-3.5 w-3.5" aria-hidden /> {t('sla.admin.export')}</Button>
          </div>
          {report.isLoading || !report.data ? <Skeleton className="h-40 w-full rounded-2xl" /> : (
            <>
              {report.data.pct !== null && report.data.alert_pct != null && report.data.pct < report.data.alert_pct && (
                <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{t('sla.admin.alert', { pct: report.data.pct, alert: report.data.alert_pct })}</p>
              )}
              <ComplianceView report={report.data} linkBase="/admin/tickets?ticket=" />
              <div className="grid gap-3 lg:grid-cols-2">
                {(['by_company', 'by_consultant'] as const).map((k) => (
                  <Card key={k} className="rounded-2xl"><CardHeader className="pb-2"><CardTitle className="text-sm">{t(`sla.admin.${k}`)}</CardTitle></CardHeader>
                    <CardContent><table className="w-full text-xs"><tbody>{(report.data![k] ?? []).map((r, i) => (
                      <tr key={i} className="border-t border-border/50"><td className="py-1">{r.name ?? '—'}</td><td>{r.pct ?? '—'}{r.pct != null ? ' %' : ''}</td><td className="text-muted-foreground">{r.measured}</td></tr>
                    ))}</tbody></table></CardContent></Card>
                ))}
              </div>
              <Card className="rounded-2xl"><CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.admin.breaches')}</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-muted-foreground"><tr><th className="text-start">{t('sla.admin.ticket')}</th><th className="text-start">{t('sla.admin.owner')}</th><th className="text-start">{t('sla.editor.severity')}</th><th className="text-start">{t('sla.admin.reasonCode')}</th><th className="text-start">{t('sla.admin.breachedAt')}</th></tr></thead>
                  <tbody>{(report.data.breaches ?? []).slice(0, 200).map((r) => (
                    <tr key={`${r.ticket_id}-${r.kind}`} className="border-t border-border/50"><td className="py-1">{r.title}</td><td>{r.company ?? '—'}</td><td>{r.severity}</td>
                      <td>{t(`sla.reasonCode.${r.reason}`, { defaultValue: r.reason ?? '' })}{r.acknowledged ? ` · ${t('sla.admin.acked')}` : ''}{r.had_pauses ? ` · ${t('sla.admin.hadPauses')}` : ''}</td><td>{fmtAt(r.breached_at, undefined, lang)}</td></tr>
                  ))}</tbody></table></CardContent></Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="simulate" className="space-y-3">
          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('sla.admin.simTitle')}</CardTitle><p className="text-xs text-muted-foreground">{t('sla.admin.simHint')}</p></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input className="h-8 max-w-sm" placeholder={t('sla.admin.ticketId')} value={simTicket} onChange={(e) => setSimTicket(e.target.value.trim())} aria-label={t('sla.admin.ticketId')} />
                <Button size="sm" reason={!/^[0-9a-f-]{36}$/i.test(simTicket) && 'invalid_value'} onClick={async () => { try { setSim(await api.simulate(simTicket, null, null)); } catch (e) { toast.error(slaErrorText(t, e)); } }}>{t('sla.admin.simRun')}</Button>
              </div>
              {sim && (
                <div className="space-y-1 text-xs">
                  <p>{t('sla.admin.simResult', { sev: sim.severity, response: fmtAt(sim.response_due, sim.data.calendar.tz, lang), resolution: fmtAt(sim.resolution_due, sim.data.calendar.tz, lang) })}</p>
                  <ul className="list-disc ps-5">{sim.plan.map((p, i) => (
                    <li key={i}>{fmtAt(p.at, sim.data.calendar.tz, lang)} · {t(`sla.template.${String(p.step.template)}`)} · {t(`sla.clock.${String(p.step.clock)}`)} · {t('sla.admin.simRecipients', { count: p.recipients })}</li>
                  ))}</ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <p className="text-[11px] text-muted-foreground"><ShieldCheck className="me-1 inline h-3.5 w-3.5" aria-hidden />{t('sla.disclaimer')}</p>
    </div>
  );
}
