import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, FileSignature, FolderOpen, Handshake, History, Loader2, MessageSquare, PauseCircle, PlayCircle, Repeat, Scale, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTenant } from '@/contexts/TenantContext';
import { useRefreshAgreements } from '@/hooks/useAgreements';
import * as api from '@/lib/agreements/api';
import { feeExample, offerPatch, rateChangeEffectiveOk, saErrorCode, type SaSettings } from '@/lib/agreements/model';
import { agreementPdfBlob } from '@/lib/agreements/pdf';
import { AgreementStatusBadge, AgreementSteps, fmtDate, LegalDraftBanner, money, ProtectionBox, TermsSummary } from './AgreementBits';
import ApplyDialog from './ApplyDialog';
import AgreementDocuments from './AgreementDocuments';
import { CrewPanel, TeamConfirmation } from './AgreementCrew';

const todayIso = () => new Date().toISOString().slice(0, 10);

function useAct() {
  const { t } = useTranslation();
  const refresh = useRefreshAgreements();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); refresh(); return true; }
    catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); return false; }
    finally { setBusy(null); }
  };
  return { busy, run };
}

/** One agreement for the viewer's role: overview, applications, negotiation + acceptance, usage, rates, team, messages, history. */
export default function AgreementWorkspace({ a, settings, portal }: { a: api.SaDetail; settings: SaSettings; portal: 'client' | 'consultant' }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { tenant } = useTenant();
  const { busy, run } = useAct();
  const party = ['client', 'client_member', 'lead', 'team', 'admin'].includes(a.role);
  const isClient = a.role === 'client';
  const isLead = a.role === 'lead';
  const [applyOpen, setApplyOpen] = useState(false);
  const [dialog, setDialog] = useState<null | 'terminate' | 'suspend' | 'rate' | 'reopen' | 'replace'>(null);
  const [text, setText] = useState('');
  const [dateVal, setDateVal] = useState('');
  const [rateVal, setRateVal] = useState<number>(a.rate_in_force?.hourly_rate ?? a.terms?.rate.hourly_rate ?? 0);
  const [typedName, setTypedName] = useState('');
  const [accept, setAccept] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgTo, setMsgTo] = useState<string | null>(null);
  const [counter, setCounter] = useState<{ hourly_rate?: number; hours_per_month?: number; capacity?: number; start_date?: string; end_date?: string | null; notice_days?: number }>({});
  const [counterNote, setCounterNote] = useState('');
  const [handover, setHandover] = useState(a.termination?.handover_note ?? '');
  const [pdfBusy, setPdfBusy] = useState(false);

  const myParty = isClient ? 'client' : isLead ? 'consultant' : null;
  const accepted = useMemo(() => new Set((a.acceptances ?? []).filter((x) => x.version === a.version).map((x) => x.party)), [a]);
  const openOffer = (a.offers ?? []).find((o) => o.status === 'open');
  const terms = a.terms;
  const live = ['active', 'renewal_due', 'suspended'].includes(a.status);
  const close = () => { setDialog(null); setText(''); setDateVal(''); };

  const downloadPdf = async () => {
    if (!terms || !a.version) return;
    setPdfBusy(true);
    try {
      const blob = await agreementPdfBlob({
        name: a.name, reference: a.reference, status: t(`agreements.status.${a.status}`), version: a.version, hash: a.content_hash ?? null,
        crew: (a.confirmation?.members ?? []).map((m) => ({ name: m.name ?? '—', role: t(`agreements.memberRole.${m.role}`, { defaultValue: m.role }), capacity: m.capacity_hours_per_week, required: m.required, status: m.status, slaAt: m.sla_accepted_at, ndaAt: m.nda_signed_at })),
        clientName: tenant?.name ?? t('agreements.role.client'), consultantName: a.consultant_name ?? null, terms,
        acceptances: a.acceptances ?? [], legalDraft: a.legal_draft, fees: a.fees ?? null,
      }, lang);
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = `agreement-${a.name.replace(/[^\w-]+/g, '-').slice(0, 40)}-${a.reference ?? ''}-v${a.version}.pdf`; el.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast.error(t('agreements.err.pdf')); } finally { setPdfBusy(false); }
  };

  const fee = a.fees ? feeExample(100 * (a.rate_in_force?.hourly_rate ?? terms?.rate.hourly_rate ?? 0) / 100, a.fees.service_fee_percent, a.fees.processing_fee_percent, a.fees.vat_percent) : null;

  // ---------------------------------------------------------------- applicant view (request only, own application)
  if (!party) {
    const app = a.my_application;
    return (
      <div className="space-y-4">
        <Header a={a} />
        <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.detail.request')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TermsSummary terms={{ ...a.terms_public, scope: a.terms_public.scope }} showRate={false} />
            <RequestFacts a={a} />
            {app ? (
              <div className="rounded-xl border p-3 text-sm">
                <p className="font-medium">{t('agreements.apply.yours')} · <Badge variant="outline">{t(`agreements.appStatus.${app.status}`, { defaultValue: app.status })}</Badge></p>
                <p className="mt-1 text-muted-foreground">{money(app.hourly_rate, app.currency, lang)} / {t('agreements.f.hour')} · {t(`agreements.model.${app.model}`)}</p>
                {a.status === 'open' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setApplyOpen(true)}>{t('agreements.apply.update')}</Button>
                    <Button size="sm" variant="ghost" busy={!!busy} onClick={() => run('withdraw', () => api.withdrawApplication(a.id), t('agreements.apply.withdrawn'))}>{t('agreements.apply.withdraw')}</Button>
                  </div>
                )}
              </div>
            ) : a.status === 'open' && <Button onClick={() => setApplyOpen(true)}><Handshake className="me-1 h-4 w-4" />{t('agreements.apply.cta')}</Button>}
            <ProtectionBox />
          </CardContent></Card>
        <Messages a={a} msg={msg} setMsg={setMsg} send={() => run('msg', () => api.postMessage(a.id, null, msg), t('agreements.msg.sent')).then((ok) => ok && setMsg(''))} busy={busy === 'msg'} />
        <ApplyDialog open={applyOpen} onOpenChange={setApplyOpen} agreementId={a.id} name={a.name} modules={a.modules} model={a.terms_public.model} sla={a.terms_public.sla}
          settings={settings} existing={app} onDone={() => undefined} />
      </div>
    );
  }

  // ---------------------------------------------------------------- parties
  return (
    <div className="space-y-4">
      <Header a={a} />
      {a.legal_draft && a.status !== 'draft' && <LegalDraftBanner />}
      {a.admin_review === 'pending' && <p className="rounded-xl border border-info/40 bg-info/10 p-3 text-sm">{t('agreements.detail.adminReview')}</p>}
      {a.status === 'agreed' && <TeamConfirmation a={a} lang={lang} />}
      {a.termination && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">{t('agreements.detail.ending', { date: fmtDate(a.termination.end, lang) })}</p>
          <p className="text-muted-foreground">{t('agreements.detail.reason')}: {a.termination.reason}</p>
          {a.termination.handover_until && <p className="text-muted-foreground">{t('agreements.detail.handoverUntil', { date: fmtDate(a.termination.handover_until, lang) })}</p>}
          {isLead && (
            <div className="mt-2 space-y-2">
              <Label htmlFor="sa-ho">{t('agreements.detail.handoverNote')}</Label>
              <Textarea id="sa-ho" rows={3} maxLength={4000} value={handover} onChange={(e) => setHandover(e.target.value)} />
              <Button size="sm" busy={!!busy} disabled={!handover.trim()} onClick={() => run('ho', () => api.saveHandoverNote(a.id, handover), t('agreements.saved'))}>{t('agreements.save')}</Button>
            </div>
          )}
          {!isLead && a.termination.handover_note && <p className="mt-2 whitespace-pre-wrap">{a.termination.handover_note}</p>}
        </div>
      )}

      <Tabs defaultValue={a.my_member?.status === 'invited' ? 'crew' : a.status === 'open' && isClient ? 'applications' : a.status === 'negotiating' ? 'negotiation' : live ? 'usage' : 'overview'}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="overview"><FileSignature className="me-1 h-4 w-4" />{t('agreements.tab.overview')}</TabsTrigger>
          {a.applications && <TabsTrigger value="applications"><Users className="me-1 h-4 w-4" />{t('agreements.tab.applications')} ({a.applications.length})</TabsTrigger>}
          {['negotiating', 'agreed'].includes(a.status) && <TabsTrigger value="negotiation"><Scale className="me-1 h-4 w-4" />{t('agreements.tab.negotiation')}</TabsTrigger>}
          {a.usage && <TabsTrigger value="usage"><Wallet className="me-1 h-4 w-4" />{t('agreements.tab.usage')}</TabsTrigger>}
          {(a.rates?.length ?? 0) > 0 && <TabsTrigger value="rates"><Repeat className="me-1 h-4 w-4" />{t('agreements.tab.rates')}</TabsTrigger>}
          {(a.confirmation?.members.length ?? 0) > 0 && <TabsTrigger value="crew"><ShieldCheck className="me-1 h-4 w-4" />{t('agreements.tab.crew')}</TabsTrigger>}
          <TabsTrigger value="documents"><FolderOpen className="me-1 h-4 w-4" />{t('agreements.tab.documents')}</TabsTrigger>
          <TabsTrigger value="messages"><MessageSquare className="me-1 h-4 w-4" />{t('agreements.tab.messages')}</TabsTrigger>
          <TabsTrigger value="history"><History className="me-1 h-4 w-4" />{t('agreements.tab.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="rounded-2xl"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{t('agreements.detail.terms')} {a.version ? `· v${a.version}` : ''}</CardTitle>
            {a.version ? <Button size="sm" variant="outline" disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Download className="me-1 h-4 w-4" />}{t('agreements.detail.pdf')}</Button> : null}</CardHeader>
            <CardContent className="space-y-4">
              {terms && <TermsSummary terms={terms} />}
              {a.consultant_name && <p className="text-sm"><span className="text-muted-foreground">{t('agreements.role.lead')}:</span> <span className="font-medium">{a.consultant_name}</span></p>}
              {fee && (a.rate_in_force || terms?.rate.hourly_rate) ? (
                <p className="text-xs text-muted-foreground">{t('agreements.detail.feeLine', { base: money(fee.base, terms?.rate.currency, lang), total: money(fee.total, terms?.rate.currency, lang), s: a.fees?.service_fee_percent, p: a.fees?.processing_fee_percent, v: a.fees?.vat_percent })}</p>
              ) : null}
              <ProtectionBox compact />
            </CardContent></Card>

          {a.my_member?.status === 'invited' && (
            <p className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">{t('agreements.crew.invitedBanner')}</p>
          )}
          {['draft', 'open', 'negotiating'].includes(a.status) && (terms?.team ?? []).some((e) => e.role !== 'lead') && (
            <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.crew.planned')}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">{t('agreements.crew.plannedText', { count: (terms?.team ?? []).filter((e) => e.role !== 'lead').length })}</CardContent></Card>
          )}

          {(isClient || isLead) && (
            <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.detail.actions')}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                {live && (
                  <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                    <Switch checked={isClient ? !!a.auto_renew?.client : !!a.auto_renew?.consultant} onCheckedChange={(v) => run('renew', () => api.setAutoRenew(a.id, v), t('agreements.saved'))} />
                    {t('agreements.detail.autoRenewMine')} <span className="text-xs text-muted-foreground">({t('agreements.detail.autoRenewBoth')})</span>
                  </label>
                )}
                {isClient && ['active', 'renewal_due'].includes(a.status) && <Button size="sm" variant="outline" onClick={() => setDialog('suspend')}><PauseCircle className="me-1 h-4 w-4" />{t('agreements.detail.suspend')}</Button>}
                {isClient && a.status === 'suspended' && <Button size="sm" variant="outline" onClick={() => run('resume', () => api.resume(a.id), t('agreements.saved'))}><PlayCircle className="me-1 h-4 w-4" />{t('agreements.detail.resume')}</Button>}
                {live && <Button size="sm" variant="outline" onClick={() => setDialog('rate')}><Repeat className="me-1 h-4 w-4" />{t('agreements.detail.proposeRate')}</Button>}
                {isClient && live && !a.replacement && <Button size="sm" variant="outline" onClick={() => setDialog('replace')}>{t('agreements.detail.replace')}</Button>}
                {a.status === 'negotiating' && <Button size="sm" variant="ghost" onClick={() => setDialog('reopen')}>{t('agreements.detail.reopen')}</Button>}
                {['agreed', 'active', 'renewal_due', 'suspended'].includes(a.status) && !a.termination && <Button size="sm" variant="destructive" onClick={() => setDialog('terminate')}>{t('agreements.detail.terminate')}</Button>}
                {isClient && a.status === 'draft' && <Button size="sm" asChild><Link to={`/client/agreements/${a.id}?edit=1`}>{t('agreements.detail.editDraft')}</Link></Button>}
              </CardContent></Card>
          )}
          {a.replacement && <p className="rounded-xl border p-3 text-sm">{t('agreements.detail.replacementPending', { status: t(`agreements.replStatus.${a.replacement.status}`, { defaultValue: a.replacement.status }) })}</p>}
        </TabsContent>

        {a.applications && (
          <TabsContent value="applications" className="space-y-3">
            {!a.applications.length && <p className="text-sm text-muted-foreground">{t('agreements.detail.noApplications')}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {a.applications.map((p) => (
                <Card key={p.id} className="rounded-2xl"><CardContent className="space-y-2 p-4 text-sm">
                  <div className="flex items-center justify-between gap-2"><p className="font-semibold">{p.name ?? '—'}</p><Badge variant="outline">{t(`agreements.appStatus.${p.status}`, { defaultValue: p.status })}</Badge></div>
                  <p className="text-lg font-bold">{money(p.hourly_rate, p.currency, lang)} <span className="text-xs font-normal text-muted-foreground">/ {t('agreements.f.hour')}</span></p>
                  <p className="text-muted-foreground">{t(`agreements.model.${p.model}`)}{p.capacity_hours_per_week ? ` · ${t('agreements.f.hoursWeek', { count: p.capacity_hours_per_week })}` : ''}</p>
                  {p.availability_note && <p className="text-muted-foreground">{t('agreements.apply.availability')}: {p.availability_note}</p>}
                  {p.message && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-2">{p.message}</p>}
                  <p className="text-xs text-success">{t('agreements.detail.slaAccepted', { date: fmtDate(p.sla_accepted_at, lang) })}</p>
                  {isClient && a.status === 'open' && ['pending', 'shortlisted'].includes(p.status) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" busy={!!busy} onClick={() => run('sel', () => api.selectApplication(p.id), t('agreements.detail.selected'))}>{t('agreements.detail.select')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setMsgTo(p.consultant_id); document.getElementById('sa-msg')?.focus(); }}>{t('agreements.detail.ask')}</Button>
                    </div>
                  )}
                </CardContent></Card>
              ))}
            </div>
          </TabsContent>
        )}

        {['negotiating', 'agreed'].includes(a.status) && terms && (
          <TabsContent value="negotiation" className="space-y-4">
            {openOffer && (
              <Card className="rounded-2xl border-warning/50"><CardContent className="space-y-2 p-4 text-sm">
                <p className="font-medium">{t('agreements.neg.openOffer', { by: t(`agreements.party.${openOffer.by}`) })}</p>
                <PatchText patch={openOffer.patch} currency={terms.rate.currency} />
                {openOffer.note && <p className="text-muted-foreground">{openOffer.note}</p>}
                {myParty && openOffer.by !== myParty && (
                  <div className="flex gap-2"><Button size="sm" busy={!!busy} onClick={() => run('ro', () => api.respondOffer(openOffer.id, true), t('agreements.neg.accepted'))}>{t('agreements.accept')}</Button>
                    <Button size="sm" variant="ghost" busy={!!busy} onClick={() => run('ro', () => api.respondOffer(openOffer.id, false))}>{t('agreements.decline')}</Button></div>
                )}
              </CardContent></Card>
            )}
            {myParty && a.status === 'negotiating' && (
              <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.neg.counter')}</CardTitle></CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="c-rate">{t('agreements.f.rate')}</Label><Input id="c-rate" type="number" defaultValue={terms.rate.hourly_rate} onChange={(e) => setCounter((c) => ({ ...c, hourly_rate: Number(e.target.value) }))} /></div>
                  {terms.model === 'hours_bank' && <div className="space-y-1.5"><Label htmlFor="c-bh">{t('agreements.f.bankHours')}</Label><Input id="c-bh" type="number" defaultValue={terms.bank?.hours_per_month} onChange={(e) => setCounter((c) => ({ ...c, hours_per_month: Number(e.target.value) }))} /></div>}
                  {terms.model === 'availability' && <div className="space-y-1.5"><Label htmlFor="c-cap">{t('agreements.f.capacity')}</Label><Input id="c-cap" type="number" defaultValue={terms.capacity_hours_per_week ?? 0} onChange={(e) => setCounter((c) => ({ ...c, capacity: Number(e.target.value) }))} /></div>}
                  <div className="space-y-1.5"><Label htmlFor="c-start">{t('agreements.f.start')}</Label><Input id="c-start" type="date" defaultValue={terms.term.start_date} onChange={(e) => setCounter((c) => ({ ...c, start_date: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label htmlFor="c-end">{t('agreements.f.end')}</Label><Input id="c-end" type="date" defaultValue={terms.term.end_date ?? ''} onChange={(e) => setCounter((c) => ({ ...c, end_date: e.target.value || null }))} /></div>
                  <div className="space-y-1.5"><Label htmlFor="c-notice">{t('agreements.f.noticeDays')}</Label><Input id="c-notice" type="number" defaultValue={terms.term.notice_days} onChange={(e) => setCounter((c) => ({ ...c, notice_days: Number(e.target.value) }))} /></div>
                  <div className="space-y-1.5 sm:col-span-3"><Label htmlFor="c-note">{t('agreements.neg.note')}</Label><Textarea id="c-note" rows={2} maxLength={1000} value={counterNote} onChange={(e) => setCounterNote(e.target.value)} /></div>
                  <div className="sm:col-span-3"><Button size="sm" busy={!!busy} disabled={!Object.keys(offerPatch(terms, counter)).length}
                    onClick={() => run('offer', () => api.makeOffer(a.id, offerPatch(terms, counter), counterNote), t('agreements.neg.sent')).then((ok) => ok && (setCounter({}), setCounterNote('')))}>{t('agreements.neg.send')}</Button></div>
                </CardContent></Card>
            )}
            {myParty && a.status === 'negotiating' && a.version && a.content_hash && (
              <Card className="rounded-2xl border-primary/40"><CardHeader><CardTitle className="text-base">{t('agreements.acc.title', { v: a.version })}</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {a.legal_draft && <LegalDraftBanner />}
                  <p className="text-muted-foreground">{t('agreements.acc.text')}</p>
                  <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{t('agreements.acc.hash')}: {a.content_hash}</p>
                  <p>{t('agreements.acc.state', { client: accepted.has('client') ? t('agreements.yes') : t('agreements.no'), consultant: accepted.has('consultant') ? t('agreements.yes') : t('agreements.no') })}</p>
                  {accepted.has(myParty) ? <p className="font-medium text-success">{t('agreements.acc.done')}</p> : (
                    <>
                      <label className="flex items-start gap-2"><Checkbox checked={accept} onCheckedChange={(v) => setAccept(!!v)} className="mt-0.5" /> {t('agreements.acc.check')}</label>
                      <div className="max-w-sm space-y-1.5"><Label htmlFor="acc-name">{t('agreements.acc.name')}</Label><Input id="acc-name" value={typedName} maxLength={120} onChange={(e) => setTypedName(e.target.value)} autoComplete="name" /></div>
                      <Button busy={!!busy} disabled={!accept || typedName.trim().length < 3} onClick={() => run('acc', () => api.acceptTerms(a.id, a.version!, a.content_hash!, typedName.trim()), t('agreements.acc.saved'))}>
                        <FileSignature className="me-1 h-4 w-4" />{t('agreements.acc.cta')}</Button>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">{t('agreements.acc.esign')}</p>
                </CardContent></Card>
            )}
          </TabsContent>
        )}

        {a.usage && (
          <TabsContent value="usage" className="space-y-4"><Usage a={a} lang={lang} /></TabsContent>
        )}

        {(a.rates?.length ?? 0) > 0 && (
          <TabsContent value="rates" className="space-y-4">
            <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.rates.title')}</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-start text-xs text-muted-foreground"><th className="p-2 text-start">#</th><th className="p-2 text-start">{t('agreements.f.rate')}</th><th className="p-2 text-start">{t('agreements.rates.from')}</th><th className="p-2 text-start">{t('agreements.rates.by')}</th><th className="p-2 text-start">{t('agreements.rates.at')}</th></tr></thead>
                <tbody>{a.rates!.map((r) => <tr key={r.id} className="border-t"><td className="p-2">{r.seq}</td><td className="p-2 font-medium">{money(r.hourly_rate, r.currency, lang)}{r.s1_multiplier ? ` · S1 ×${r.s1_multiplier}` : ''}</td><td className="p-2">{fmtDate(r.effective_from, lang)}</td><td className="p-2">{t(`agreements.party.${r.proposed_role}`, { defaultValue: r.proposed_role })}</td><td className="p-2">{fmtDate(r.created_at, lang)}</td></tr>)}</tbody>
              </table><p className="mt-2 text-xs text-muted-foreground">{t('agreements.rates.immutable')}</p></CardContent></Card>
            {(a.rate_changes ?? []).map((c) => (
              <Card key={c.id} className="rounded-2xl"><CardContent className="space-y-2 p-4 text-sm">
                <p className="font-medium">{t('agreements.rates.change', { rate: money(c.hourly_rate, terms?.rate.currency, lang), date: fmtDate(c.effective_from, lang) })} · <Badge variant="outline">{t(`agreements.changeStatus.${c.status}`, { defaultValue: c.status })}</Badge></p>
                {c.reason && <p className="text-muted-foreground">{c.reason}</p>}
                {c.status === 'pending' && myParty && c.by !== myParty && (
                  <div className="flex gap-2"><Button size="sm" busy={!!busy} onClick={() => run('rc', () => api.decideRateChange(c.id, true), t('agreements.saved'))}>{t('agreements.accept')}</Button>
                    <Button size="sm" variant="ghost" busy={!!busy} onClick={() => run('rc', () => api.decideRateChange(c.id, false))}>{t('agreements.decline')}</Button></div>
                )}
              </CardContent></Card>
            ))}
          </TabsContent>
        )}

        {(a.confirmation?.members.length ?? 0) > 0 && (
          <TabsContent value="crew" className="space-y-4">
            {a.status !== 'agreed' && <TeamConfirmation a={a} lang={lang} />}
            <CrewPanel a={a} settings={settings} />
          </TabsContent>
        )}

        <TabsContent value="documents"><AgreementDocuments a={a} settings={settings} /></TabsContent>

        <TabsContent value="messages">
          <Messages a={a} msg={msg} setMsg={setMsg} to={msgTo} setTo={isClient ? setMsgTo : undefined}
            send={() => run('msg', () => api.postMessage(a.id, isClient ? (msgTo ?? a.consultant_id ?? null) : null, msg), t('agreements.msg.sent')).then((ok) => ok && setMsg(''))} busy={busy === 'msg'} />
        </TabsContent>

        <TabsContent value="history">
          <Card className="rounded-2xl"><CardContent className="p-4">
            <ol className="relative space-y-3 border-s ps-4">
              {(a.events ?? []).map((e, i) => (
                <li key={i} className="text-sm"><span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border border-background bg-primary" aria-hidden />
                  <p className="font-medium">{t(`agreements.event.${e.kind}`, { defaultValue: e.kind.replace(/_/g, ' ') })}{e.role ? ` · ${t(`agreements.party.${e.role}`, { defaultValue: e.role })}` : ''}</p>
                  <p className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB')}</p></li>
              ))}
            </ol>
            {(a.acceptances?.length ?? 0) > 0 && (
              <div className="mt-4 space-y-1 text-xs text-muted-foreground"><p className="font-medium text-foreground">{t('agreements.acc.record')}</p>
                {a.acceptances!.map((x, i) => <p key={i}>v{x.version} · {t(`agreements.party.${x.party}`, { defaultValue: x.party })} · {x.name} · {new Date(x.at).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB')} · {x.hash.slice(0, 12)}</p>)}</div>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog ? t(`agreements.dlg.${dialog}.title`) : ''}</DialogTitle><DialogDescription>{dialog ? t(`agreements.dlg.${dialog}.text`, { days: terms?.term.notice_days ?? 0 }) : ''}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {dialog === 'rate' && <div className="space-y-1.5"><Label htmlFor="d-rate">{t('agreements.f.rate')}</Label><Input id="d-rate" type="number" value={rateVal || ''} onChange={(e) => setRateVal(Number(e.target.value))} /></div>}
            {(dialog === 'rate' || dialog === 'suspend') && <div className="space-y-1.5"><Label htmlFor="d-date">{dialog === 'rate' ? t('agreements.dlg.rate.effective') : t('agreements.dlg.suspend.until')}</Label>
              <Input id="d-date" type="date" min={todayIso()} value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
              {dialog === 'rate' && dateVal && !rateChangeEffectiveOk(dateVal, todayIso()) && <p className="text-xs text-destructive">{t('agreements.problem.retroactive')}</p>}</div>}
            {dialog === 'replace' && <div className="space-y-1.5"><Label htmlFor="d-to">{t('agreements.dlg.replace.to')}</Label>
              <select id="d-to" className="w-full rounded-md border bg-background p-2 text-sm" value={msgTo ?? ''} onChange={(e) => setMsgTo(e.target.value || null)}>
                <option value="">—</option>{(a.members ?? []).filter((m) => m.status === 'active' && m.consultant_id !== a.consultant_id).map((m) => <option key={m.consultant_id} value={m.consultant_id}>{m.name ?? m.consultant_id.slice(0, 8)}</option>)}
              </select><p className="text-xs text-muted-foreground">{t('agreements.dlg.replace.hint')}</p></div>}
            <div className="space-y-1.5"><Label htmlFor="d-text">{t('agreements.dlg.reason')}</Label><Textarea id="d-text" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={close}>{t('agreements.cancel')}</Button>
            <Button variant={dialog === 'terminate' ? 'destructive' : 'default'} busy={!!busy} disabled={text.trim().length < (dialog === 'rate' ? 0 : 5) || ((dialog === 'rate' || dialog === 'suspend') && !dateVal) || (dialog === 'replace' && !msgTo)}
              onClick={async () => {
                const ok = dialog === 'terminate' ? await run('d', () => api.requestTermination(a.id, text), t('agreements.dlg.terminate.done'))
                  : dialog === 'suspend' ? await run('d', () => api.suspend(a.id, dateVal, text), t('agreements.saved'))
                  : dialog === 'rate' ? await run('d', () => api.proposeRateChange(a.id, { rate: rateVal, s1: a.rate_in_force?.s1_multiplier ?? null, ooh: a.rate_in_force?.ooh_multiplier ?? null, overage: a.rate_in_force?.overage_rate ?? null, effective: dateVal, reason: text }), t('agreements.dlg.rate.done'))
                  : dialog === 'reopen' ? await run('d', () => api.reopen(a.id, text), t('agreements.saved'))
                  : dialog === 'replace' ? await run('d', () => api.requestReplacement(a.id, msgTo!, text), t('agreements.dlg.replace.done')) : false;
                if (ok) close();
              }}>{busy === 'd' && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('agreements.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({ a }: { a: api.SaDetail }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{a.name}</h1>
        {a.reference && <Badge variant="secondary" className="font-mono">{a.reference}</Badge>}<AgreementStatusBadge status={a.status} />
        <Badge variant="outline">{t(`agreements.role.${a.role}`)}</Badge></div>
      <AgreementSteps status={a.status} />
    </div>
  );
}

function RequestFacts({ a }: { a: api.SaDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const r = a.request;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {r.expected_hours_per_month ? <Badge variant="secondary">{t('agreements.f.hoursMonth', { count: r.expected_hours_per_month })}</Badge> : null}
      {r.language && <Badge variant="secondary">{t('agreements.f.language')}: {r.language}</Badge>}
      {r.timezone && <Badge variant="secondary">{r.timezone}</Badge>}
      {r.budget && (r.budget.min || r.budget.max) ? <Badge variant="secondary">{t('agreements.f.budget')}: {money(r.budget.min, r.budget.currency, lang)} – {money(r.budget.max, r.budget.currency, lang)}</Badge> : null}
      {a.deadline && <Badge variant="secondary">{t('agreements.f.deadline')}: {fmtDate(a.deadline, lang)}</Badge>}
      {r.notes && <p className="w-full whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</p>}
    </div>
  );
}

function PatchText({ patch, currency }: { patch: Record<string, unknown>; currency: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const p = patch as { rate?: { hourly_rate?: number }; bank?: { hours_per_month?: number }; capacity_hours_per_week?: number; term?: { start_date?: string; end_date?: string | null; notice_days?: number } };
  return (
    <ul className="space-y-0.5">
      {p.rate?.hourly_rate !== undefined && <li>{t('agreements.f.rate')}: <strong>{money(p.rate.hourly_rate, currency, lang)}</strong></li>}
      {p.bank?.hours_per_month !== undefined && <li>{t('agreements.f.bankHours')}: <strong>{p.bank.hours_per_month}</strong></li>}
      {p.capacity_hours_per_week !== undefined && <li>{t('agreements.f.capacity')}: <strong>{p.capacity_hours_per_week}</strong></li>}
      {p.term?.start_date && <li>{t('agreements.f.start')}: <strong>{fmtDate(p.term.start_date, lang)}</strong></li>}
      {p.term && 'end_date' in p.term && <li>{t('agreements.f.end')}: <strong>{p.term.end_date ? fmtDate(p.term.end_date, lang) : t('agreements.f.openEnded')}</strong></li>}
      {p.term?.notice_days !== undefined && <li>{t('agreements.f.noticeDays')}: <strong>{p.term.notice_days}</strong></li>}
    </ul>
  );
}

function Usage({ a, lang }: { a: api.SaDetail; lang: 'en' | 'ar' }) {
  const { t } = useTranslation();
  const u = a.usage!;
  const cur = a.terms?.rate.currency ?? 'USD';
  const pct = u.committed ? Math.min(100, Math.round((u.used_hours / u.committed) * 100)) : null;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl"><CardContent className="space-y-2 p-4"><p className="text-xs text-muted-foreground">{t('agreements.usage.thisMonth')}</p>
          <p className="text-2xl font-bold">{u.used_hours} h{u.committed ? <span className="text-sm font-normal text-muted-foreground"> / {u.committed} h</span> : null}</p>
          {pct !== null && <Progress value={pct} aria-label={t('agreements.usage.thisMonth')} />}
          {u.capacity_hours_per_week ? <p className="text-xs text-muted-foreground">{t('agreements.usage.capacity', { count: u.capacity_hours_per_week })}</p> : null}</CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('agreements.usage.rollover')}</p><p className="text-2xl font-bold">{u.rollover_balance} h</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('agreements.usage.sla')}</p>
          <p className="text-2xl font-bold">{u.sla?.pct !== null && u.sla?.pct !== undefined ? `${u.sla.pct} %` : '—'}</p>
          <p className="text-xs text-muted-foreground">{u.sla?.measured ? t('agreements.usage.slaMet', { met: u.sla.met, total: u.sla.measured }) : t('agreements.usage.slaNone')}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('agreements.usage.spend')}</p><p className="text-2xl font-bold">{money(u.spend, cur, lang)}</p>
          <p className="text-xs text-muted-foreground">{u.end_date ? t('agreements.usage.renewal', { date: fmtDate(u.termination_end ?? u.end_date, lang) }) : t('agreements.f.openEnded')}</p></CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.usage.recent', { count: u.tickets })}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">{!u.recent.length && <p className="text-muted-foreground">{t('agreements.usage.noTickets')}</p>}
            {u.recent.map((r) => <Link key={r.id} to={a.role === 'lead' || a.role === 'team' ? `/consultant/cases/${r.id}` : `/client/tickets/${r.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-muted"><span className="truncate">{r.title}</span><span className="shrink-0 text-xs text-muted-foreground">{fmtDate(r.created_at, lang)}</span></Link>)}</CardContent></Card>
        <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.usage.statements')}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">{!u.months.length ? <p className="text-sm text-muted-foreground">{t('agreements.usage.noMonths')}</p> : (
            <table className="w-full text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="p-1 text-start">{t('agreements.usage.month')}</th><th className="p-1 text-start">{t('agreements.usage.used')}</th><th className="p-1 text-start">{t('agreements.usage.expired')}</th><th className="p-1 text-start">{t('agreements.usage.charged')}</th><th className="p-1 text-start">{t('agreements.usage.amount')}</th></tr></thead>
              <tbody>{u.months.map((m) => <tr key={m.month} className="border-t"><td className="p-1">{m.month.slice(0, 7)}</td><td className="p-1">{m.used_hours}</td><td className="p-1">{m.expired_hours}</td><td className="p-1">{m.charge_hours}</td><td className="p-1">{m.base_amount ? money(m.base_amount, cur, lang) : '—'}</td></tr>)}</tbody></table>
          )}<p className="mt-2 text-xs text-muted-foreground">{t('agreements.usage.statementHint')}</p></CardContent></Card>
      </div>
    </>
  );
}

function Messages({ a, msg, setMsg, send, busy, to, setTo }: { a: api.SaDetail; msg: string; setMsg: (v: string) => void; send: () => void; busy: boolean; to?: string | null; setTo?: (v: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const names = new Map((a.applications ?? []).map((p) => [p.consultant_id, p.name ?? '—']));
  const shown = setTo && to ? a.messages.filter((m) => m.consultant_id === to) : a.messages;
  return (
    <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.msg.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {setTo && names.size > 0 && (
          <div className="flex flex-wrap gap-1.5">{[...names].map(([cid, n]) => <Button key={cid} size="sm" variant={to === cid ? 'default' : 'outline'} onClick={() => setTo(to === cid ? null : cid)}>{n}</Button>)}</div>
        )}
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {!shown.length && <p className="text-sm text-muted-foreground">{t('agreements.msg.none')}</p>}
          {shown.map((m, i) => (
            <div key={i} className={`max-w-[85%] rounded-xl p-2 text-sm ${m.role === 'client' ? 'ms-auto bg-primary/10' : 'bg-muted'}`}>
              <p className="text-[11px] text-muted-foreground">{t(`agreements.party.${m.role}`, { defaultValue: m.role })} · {new Date(m.at).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB')}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
        <Label htmlFor="sa-msg" className="sr-only">{t('agreements.msg.write')}</Label>
        <Textarea id="sa-msg" rows={2} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('agreements.msg.write')} />
        <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{t('agreements.form.contactHint')}</p>
          <Button size="sm" busy={busy} disabled={!msg.trim() || (!!setTo && a.status === 'open' && !to)} onClick={send}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('agreements.msg.send')}</Button></div>
      </CardContent></Card>
  );
}
