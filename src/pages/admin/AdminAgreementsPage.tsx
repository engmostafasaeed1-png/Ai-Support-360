import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Handshake, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminAgreements, useRefreshAgreements } from '@/hooks/useAgreements';
import * as api from '@/lib/agreements/api';
import { feeExample, normalizeSaSettings, saErrorCode, SA_MODELS, type SaSettings } from '@/lib/agreements/model';
import { AgreementStatusBadge, fmtDate, money } from '@/components/agreements/AgreementBits';
import { safeRpc } from '@/lib/safeRpc';

export default function AdminAgreementsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const refresh = useRefreshAgreements();
  const [status, setStatus] = useState<string | null>(null);
  const rows = useAdminAgreements(status);
  const adminQ = useQuery({
    queryKey: ['sa-admin-settings'], retry: false,
    queryFn: async () => {
      const { data, error } = await safeRpc<{ settings: unknown; fees: { service_fee_percent: number; processing_fee_percent: number; vat_percent: number } }>('sa_admin_settings');
      if (error || !data) return null;
      return { settings: normalizeSaSettings(data.settings), fees: { service: Number(data.fees?.service_fee_percent ?? 10), processing: Number(data.fees?.processing_fee_percent ?? 5), vat: Number(data.fees?.vat_percent ?? 15) } };
    },
  });
  const settingsQ = { isLoading: adminQ.isLoading, data: adminQ.data?.settings ?? null, refetch: adminQ.refetch };
  const fees = { data: adminQ.data?.fees ?? null };
  const [draft, setDraft] = useState<SaSettings | null>(null);
  const [reason, setReason] = useState('');
  const [caps, setCaps] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { if (settingsQ.data) { setDraft(settingsQ.data); setCaps(JSON.stringify(settingsQ.data.rate_caps)); } }, [settingsQ.data]);

  const example = useMemo(() => {
    if (!fees.data) return null;
    const base = 40 * 100; // 40 approved hours x 100 per hour
    return { now: feeExample(base, fees.data.service, fees.data.processing, fees.data.vat), lower: feeExample(base, draft?.service_fee_percent ?? fees.data.service, fees.data.processing, fees.data.vat), seven: feeExample(base, 7, fees.data.processing, fees.data.vat), five: feeExample(base, 5, fees.data.processing, fees.data.vat) };
  }, [fees.data, draft?.service_fee_percent]);

  if (settingsQ.isLoading) return <div className="p-6"><Skeleton className="h-64 w-full rounded-2xl" /></div>;
  if (!settingsQ.data || !draft) {
    return <div className="space-y-4 p-4 md:p-6"><h1 className="flex items-center gap-2 text-2xl font-bold"><Handshake className="h-6 w-6 text-primary" aria-hidden /> {t('agreements.admin.title')}</h1>
      <Card className="rounded-2xl"><CardContent className="p-5 text-sm"><p className="font-medium">{t('agreements.notReady.title')}</p><p className="text-muted-foreground">{t('agreements.admin.notReady')}</p></CardContent></Card></div>;
  }

  const save = async () => {
    let parsedCaps: SaSettings['rate_caps'] = {};
    try { parsedCaps = caps.trim() ? JSON.parse(caps) : {}; } catch { toast.error(t('agreements.admin.capsInvalid')); return; }
    setBusy(true);
    try {
      await api.adminSaveSettings({ ...draft, rate_caps: parsedCaps }, reason);
      toast.success(t('agreements.saved')); setReason(''); settingsQ.refetch(); refresh();
    } catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); }
    finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); toast.success(t('agreements.saved')); setNote(''); refresh(); }
    catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); }
  };
  const set = <K extends keyof SaSettings>(k: K, v: SaSettings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const list = rows.data ?? [];
  const inactive = list.filter((r) => r.inactive);
  const review = list.filter((r) => r.admin_review === 'pending');
  const repl = list.filter((r) => r.replacement);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold"><Handshake className="h-6 w-6 text-primary" aria-hidden /> {t('agreements.admin.title')}</h1>
      {!draft.enabled && <p className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">{t('agreements.admin.offNote')}</p>}
      <Tabs defaultValue="list">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="list">{t('agreements.admin.tabList')} ({list.length})</TabsTrigger>
          <TabsTrigger value="review">{t('agreements.admin.tabReview')} ({review.length + repl.length})</TabsTrigger>
          <TabsTrigger value="alerts">{t('agreements.admin.tabAlerts')} ({inactive.length})</TabsTrigger>
          <TabsTrigger value="settings">{t('agreements.admin.tabSettings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3">
          <div className="flex flex-wrap gap-1.5">{[null, 'open', 'negotiating', 'agreed', 'active', 'renewal_due', 'suspended', 'terminated', 'expired'].map((s) => (
            <Button key={s ?? 'all'} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => setStatus(s)}>{s ? t(`agreements.status.${s}`) : t('agreements.admin.all')}</Button>))}</div>
          <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="p-3 text-start">{t('agreements.f.name')}</th><th className="p-3 text-start">{t('agreements.admin.company')}</th><th className="p-3 text-start">{t('agreements.role.lead')}</th><th className="p-3 text-start">{t('agreements.f.rate')}</th><th className="p-3 text-start">{t('agreements.admin.statusCol')}</th><th className="p-3 text-start">{t('agreements.admin.activity')}</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.id} className="border-t"><td className="p-3 font-medium">{r.name}</td><td className="p-3">{r.company ?? '—'}</td><td className="p-3">{r.consultant ?? '—'}</td>
                  <td className="p-3">{r.rate ? money(r.rate.hourly_rate, r.rate.currency, lang) : '—'}</td><td className="p-3"><AgreementStatusBadge status={r.status} /></td>
                  <td className="p-3">{fmtDate(r.last_activity_at, lang)}{r.inactive && <AlertTriangle className="ms-1 inline h-3.5 w-3.5 text-warning" aria-label={t('agreements.admin.inactive')} />}</td></tr>))}
                {!list.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{t('agreements.empty')}</td></tr>}</tbody></table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="review" className="space-y-3">
          <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('agreements.admin.notePh')} aria-label={t('agreements.admin.notePh')} />
          {!review.length && !repl.length && <p className="text-sm text-muted-foreground">{t('agreements.admin.noReview')}</p>}
          {review.map((r) => (
            <Card key={r.id} className="rounded-2xl"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <div><p className="font-medium">{r.name}</p><p className="text-muted-foreground">{r.company ?? '—'} · {r.consultant ?? '—'} · {r.rate ? money(r.rate.hourly_rate, r.rate.currency, lang) : '—'}</p></div>
              <div className="flex gap-2"><Button size="sm" onClick={() => act(() => api.adminReview(r.id, true, note))}>{t('agreements.admin.approve')}</Button>
                <Button size="sm" variant="destructive" disabled={note.trim().length < 5} onClick={() => act(() => api.adminReview(r.id, false, note))}>{t('agreements.admin.reject')}</Button></div>
            </CardContent></Card>
          ))}
          {repl.map((r) => (
            <Card key={r.replacement!.id} className="rounded-2xl"><CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <div><p className="font-medium">{t('agreements.admin.replacement', { name: r.name })}</p><p className="text-muted-foreground">{r.replacement!.reason}</p></div>
              <div className="flex gap-2"><Button size="sm" onClick={() => act(() => api.adminDecideReplacement(r.replacement!.id, true, note))}>{t('agreements.admin.approve')}</Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => api.adminDecideReplacement(r.replacement!.id, false, note))}>{t('agreements.admin.reject')}</Button></div>
            </CardContent></Card>
          ))}
        </TabsContent>

        <TabsContent value="alerts" className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('agreements.admin.alertsText', { weeks: draft.inactivity_weeks })}</p>
          {!inactive.length && <p className="text-sm text-muted-foreground">{t('agreements.admin.noAlerts')}</p>}
          {inactive.map((r) => <Card key={r.id} className="rounded-2xl border-warning/50"><CardContent className="p-4 text-sm"><p className="font-medium">{r.name}</p>
            <p className="text-muted-foreground">{r.company ?? '—'} · {r.consultant ?? '—'} · {t('agreements.admin.lastActivity', { date: fmtDate(r.last_activity_at, lang) })}</p></CardContent></Card>)}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.admin.switches')}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {(['enabled', 'needs_admin_review', 'draft_legal_flag', 'allow_prepayment', 'allow_forfeit'] as const).map((k) => (
                <label key={k} className="flex items-start gap-3 rounded-xl border p-3 text-sm"><Switch checked={draft[k]} onCheckedChange={(v) => set(k, v)} />
                  <span><span className="font-medium">{t(`agreements.admin.s.${k}`)}</span><span className="block text-xs text-muted-foreground">{t(`agreements.admin.h.${k}`)}</span></span></label>
              ))}
              <div className="space-y-1.5 rounded-xl border p-3 text-sm"><p className="font-medium">{t('agreements.admin.models')}</p>
                {SA_MODELS.map((m) => <label key={m} className="flex items-center gap-2"><Checkbox checked={draft.models_enabled.includes(m)} onCheckedChange={(v) => set('models_enabled', v ? [...draft.models_enabled, m] : draft.models_enabled.filter((x) => x !== m))} /> {t(`agreements.model.${m}`)}</label>)}</div>
            </CardContent></Card>
          <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.admin.limits')}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {(['rate_min', 'rate_max', 'max_multiplier', 'inactivity_weeks', 'min_term_months', 'max_notice_days', 'application_limit_per_day'] as const).map((k) => (
                <div key={k} className="space-y-1.5"><Label htmlFor={`s-${k}`}>{t(`agreements.admin.s.${k}`)}</Label><Input id={`s-${k}`} type="number" value={draft[k]} onChange={(e) => set(k, Number(e.target.value))} /></div>
              ))}
              <div className="space-y-1.5"><Label htmlFor="s-rem">{t('agreements.admin.s.renewal_reminder_days')}</Label>
                <Input id="s-rem" defaultValue={draft.renewal_reminder_days.join(', ')} onBlur={(e) => set('renewal_reminder_days', e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0))} /></div>
              <div className="space-y-1.5 sm:col-span-3"><Label htmlFor="s-caps">{t('agreements.admin.s.rate_caps')}</Label>
                <Textarea id="s-caps" rows={2} className="font-mono text-xs" value={caps} onChange={(e) => setCaps(e.target.value)} placeholder='{"FI": {"min": 40, "max": 250}}' />
                <p className="text-xs text-muted-foreground">{t('agreements.admin.h.rate_caps')}</p></div>
            </CardContent></Card>
          <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.admin.fee')}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="max-w-xs space-y-1.5"><Label htmlFor="s-fee">{t('agreements.admin.s.service_fee_percent')}</Label>
                <Input id="s-fee" type="number" min={0} max={50} step={0.5} value={draft.service_fee_percent ?? ''} placeholder={t('agreements.admin.feeSame', { pct: fees.data?.service ?? 10 })}
                  onChange={(e) => set('service_fee_percent', e.target.value === '' ? null : Number(e.target.value))} /></div>
              <p className="text-xs text-muted-foreground">{t('agreements.admin.feeOwner')}</p>
              {example && (
                <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="p-1 text-start">{t('agreements.admin.feeCol')}</th><th className="p-1 text-start">{t('agreements.admin.base')}</th><th className="p-1 text-start">{t('agreements.admin.portal')}</th><th className="p-1 text-start">{t('agreements.admin.payment')}</th><th className="p-1 text-start">VAT</th><th className="p-1 text-start">{t('agreements.admin.total')}</th></tr></thead>
                  <tbody>{([[`${fees.data?.service} % (${t('agreements.admin.today')})`, example.now], ['7 %', example.seven], ['5 %', example.five]] as const).map(([k, f]) => (
                    <tr key={k} className="border-t"><td className="p-1">{k}</td><td className="p-1">{f.base}</td><td className="p-1">{f.service_fee}</td><td className="p-1">{f.processing_fee}</td><td className="p-1">{f.vat}</td><td className="p-1 font-medium">{f.total}</td></tr>))}</tbody></table>
                  <p className="mt-1 text-xs text-muted-foreground">{t('agreements.admin.feeExample')}</p></div>
              )}
            </CardContent></Card>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1 space-y-1.5"><Label htmlFor="s-reason">{t('agreements.admin.reason')}</Label><Input id="s-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></div>
            <Button disabled={busy || reason.trim().length < 3} onClick={save}>{t('agreements.save')}</Button>
            <Button variant="outline" onClick={() => api.sendAgreementTestEmail(lang).then((r) => (r.ok ? toast.success(t('agreements.admin.testSent')) : toast.error(r.reason ?? t('agreements.err.generic')))).catch(() => toast.error(t('agreements.err.generic')))}>
              <Mail className="me-1 h-4 w-4" />{t('agreements.admin.testEmail')}</Button>
          </div>
          <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.admin.legal')}</CardTitle></CardHeader>
            <CardContent><ul className="grid gap-1 text-sm sm:grid-cols-2">{['term', 'termination', 'rate', 'circumvention', 'ip', 'liability', 'freelancer', 'tax', 'law'].map((k) => <li key={k}>• {t(`agreements.admin.clause.${k}`)}</li>)}</ul></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
