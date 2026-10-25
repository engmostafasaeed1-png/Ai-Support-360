// "Agreement documents": generated documents (summary PDF with acceptances and fingerprint, SLA snapshot, agreed rate
// records, crew list, NDA references, monthly statements, change/renewal/termination notices) and the uploaded
// supporting files (SOW, scope annex, access plan, escalation matrix) with versions and the download log.
// Access, type/size checks and logging are decided by the database (sa_document_* in docs/sql/support-agreements.sql).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Archive, Download, FileText, History, Loader2, Lock, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTenant } from '@/contexts/TenantContext';
import { useRefreshAgreements } from '@/hooks/useAgreements';
import * as api from '@/lib/agreements/api';
import { DOC_KINDS, docSizeOk, docTypeOk, saErrorCode, secretOk, type DocKind, type SaSettings } from '@/lib/agreements/model';
import { agreementPdfBlob, slaSnapshotPdfBlob, statementPdfBlob } from '@/lib/agreements/pdf';
import { fmtDate, money } from './AgreementBits';

const ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp';
const NOTICE_KINDS = new Set(['status', 'termination_requested', 'renewed', 'rate_change_proposed', 'rate_change_accepted', 'rate_change_declined', 'rate_in_force',
  'month_settled', 'month_statement', 'lead_replaced', 'member_invited', 'member_joined', 'member_declined', 'member_removed', 'member_left', 'admin_approved', 'admin_rejected', 'handover_note']);
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = name; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = (s: string) => s.replace(/[^\w-]+/g, '-').slice(0, 40);

export default function AgreementDocuments({ a, settings }: { a: api.SaDetail; settings: SaSettings }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { tenant } = useTenant();
  const refresh = useRefreshAgreements();
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | { documentId: string | null; kind: DocKind; title: string }>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [noSecrets, setNoSecrets] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const terms = a.terms;
  const base = `${slug(a.name)}-${a.reference ?? ''}`;
  const members = a.confirmation?.members ?? a.members ?? [];

  const gen = async (key: string, fn: () => Promise<Blob>, name: string) => {
    setBusy(key);
    try { save(await fn(), name); } catch { toast.error(t('agreements.err.pdf')); } finally { setBusy(null); }
  };
  const summaryPdf = () => gen('summary', () => agreementPdfBlob({
    name: a.name, reference: a.reference, status: t(`agreements.status.${a.status}`), version: a.version ?? 0, hash: a.content_hash ?? null,
    clientName: tenant?.name ?? t('agreements.role.client'), consultantName: a.consultant_name ?? null, terms: terms!,
    acceptances: a.acceptances ?? [], legalDraft: a.legal_draft, fees: a.fees ?? null,
    crew: members.map((m) => ({ name: m.name ?? '—', role: t(`agreements.memberRole.${m.role}`, { defaultValue: m.role }), capacity: m.capacity_hours_per_week, required: m.required, status: m.status, slaAt: m.sla_accepted_at, ndaAt: m.nda_signed_at })),
  }, lang), `agreement-${base}-v${a.version}.pdf`);
  const slaPdf = () => gen('sla', () => slaSnapshotPdfBlob({ name: a.name, reference: a.reference, sla: terms!.sla, legalDraft: a.legal_draft }, lang), `sla-${base}.pdf`);
  const statementPdf = () => gen('stmt', () => statementPdfBlob({
    name: a.name, reference: a.reference, clientName: tenant?.name ?? t('agreements.role.client'), consultantName: a.consultant_name ?? null, currency: terms?.rate.currency ?? 'USD',
    legalDraft: a.legal_draft, months: (a.usage?.months ?? []).map((m) => ({ month: m.month, used_hours: m.used_hours, committed: m.committed, expired_hours: m.expired_hours, charge_hours: m.charge_hours, amount: m.base_amount })),
    tickets: a.usage?.tickets ?? 0, slaPct: a.usage?.sla?.pct ?? null, spend: a.usage?.spend ?? 0,
  }, lang), `statement-${base}.pdf`);

  const open = async (documentId: string, version: number | null) => {
    setBusy(`open:${documentId}:${version}`);
    try {
      const r = await api.openDocument(documentId, version);
      const el = document.createElement('a'); el.href = r.url; el.rel = 'noopener'; el.click();
      refresh();
    } catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); }
    finally { setBusy(null); }
  };
  const fileProblem = file ? (!docTypeOk(file.name, file.type) ? 'sa_doc_type' : !docSizeOk(file.size, settings) ? 'sa_doc_size' : null) : null;
  const textProblem = dlg && (!secretOk(`${dlg.title} ${note}`) ? 'sa_secret_details' : null);
  const upload = async () => {
    if (!dlg || !file) return;
    setBusy('upload');
    try {
      await api.uploadDocument(a.id, file, { documentId: dlg.documentId, kind: dlg.documentId ? null : dlg.kind, title: dlg.documentId ? null : dlg.title.trim(), note: note.trim(), noSecrets });
      toast.success(t('agreements.docs.uploaded'));
      setDlg(null); setFile(null); setNote(''); setNoSecrets(false); refresh();
    } catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); }
    finally { setBusy(null); }
  };

  const docs = (a.documents ?? []).filter((d) => !d.archived_at);
  const archived = (a.documents ?? []).filter((d) => d.archived_at);
  const notices = (a.events ?? []).filter((e) => NOTICE_KINDS.has(e.kind)).slice(0, 30);
  const docTitle = (id: string) => a.documents?.find((d) => d.id === id)?.title ?? '—';

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.docs.generated')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <GenTile title={t('agreements.docs.summary')} text={a.version ? t('agreements.docs.summaryText', { v: a.version, hash: (a.content_hash ?? '').slice(0, 12) }) : t('agreements.docs.notYet')}
            disabled={!a.version || !terms} busy={busy === 'summary'} onClick={summaryPdf} label={t('agreements.detail.pdf')} />
          <GenTile title={t('agreements.docs.sla')} text={terms?.sla.name ? `${terms.sla.name} v${terms.sla.version ?? '—'}` : t('agreements.f.slaDefault')} disabled={!terms} busy={busy === 'sla'} onClick={slaPdf} label={t('agreements.docs.download')} />
          <GenTile title={t('agreements.docs.statement')} text={a.usage?.months.length ? t('agreements.docs.statementText', { count: a.usage.months.length }) : t('agreements.usage.noMonths')}
            disabled={!a.usage} busy={busy === 'stmt'} onClick={statementPdf} label={t('agreements.docs.download')} />
        </CardContent></Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.docs.rates')}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">{!(a.rates ?? []).length ? <p className="text-muted-foreground">{t('agreements.docs.notYet')}</p>
            : a.rates!.map((r) => <p key={r.id}>#{r.seq} · <span className="font-medium">{money(r.hourly_rate, r.currency, lang)}</span> · {t('agreements.rates.from')} {fmtDate(r.effective_from, lang)} · {t(`agreements.party.${r.proposed_role}`, { defaultValue: r.proposed_role })}</p>)}
            <p className="pt-1 text-xs text-muted-foreground">{t('agreements.rates.immutable')}</p></CardContent></Card>
        <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.docs.crewNda')}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">{!members.length ? <p className="text-muted-foreground">{t('agreements.crew.none')}</p>
            : members.map((m) => <p key={m.consultant_id}>{m.name ?? '—'} · {t(`agreements.memberRole.${m.role}`, { defaultValue: m.role })} · {terms?.nda_required ? (m.nda_ok ? t('agreements.crew.ndaOn', { date: fmtDate(m.nda_signed_at, lang) }) : t('agreements.crew.ndaMissing')) : t('agreements.crew.ndaNotNeeded')}</p>)}
          </CardContent></Card>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{t('agreements.docs.files')}</CardTitle>
          {a.can_upload && <Button size="sm" onClick={() => setDlg({ documentId: null, kind: 'sow', title: '' })}><Upload className="me-1 h-4 w-4" />{t('agreements.docs.upload')}</Button>}</CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3 text-xs text-foreground" role="note"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />{t('agreements.docs.noSecrets')}</p>
          {a.documents_locked ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" aria-hidden />{t('agreements.docs.locked')}</p>
          ) : !docs.length ? <p className="text-sm text-muted-foreground">{t('agreements.docs.none')}</p> : docs.map((d) => (
            <div key={d.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-primary" aria-hidden />{d.title} <Badge variant="outline">{t(`agreements.docs.kind.${d.kind}`)}</Badge> <span className="text-xs font-normal text-muted-foreground">v{d.current_version}</span></p>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" busy={!!busy} onClick={() => open(d.id, null)}>{busy === `open:${d.id}:null` ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Download className="me-1 h-4 w-4" />}{t('agreements.docs.download')}</Button>
                  {a.can_upload && <Button size="sm" variant="ghost" onClick={() => setDlg({ documentId: d.id, kind: d.kind, title: d.title })}><Upload className="me-1 h-4 w-4" />{t('agreements.docs.newVersion')}</Button>}
                  {a.role === 'client' && <Button size="sm" variant="ghost" aria-label={t('agreements.docs.archive')} busy={!!busy}
                    onClick={async () => { try { await api.archiveDocument(d.id); refresh(); } catch (e) { toast.error(t(`agreements.err.${saErrorCode((e as Error).message)}`, { defaultValue: t('agreements.err.generic') })); } }}><Archive className="h-4 w-4" /></Button>}
                </div>
              </div>
              <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground"><History className="me-1 inline h-3 w-3" aria-hidden />{t('agreements.docs.versions', { count: d.versions.length })}</summary>
                <ul className="mt-1 space-y-1">{d.versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center justify-between gap-2">
                    <span>v{v.version} · {v.file_name} · {kb(v.size_bytes)} · {v.by} ({t(`agreements.party.${v.by_role}`, { defaultValue: v.by_role })}) · {new Date(v.at).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB')}{v.note ? ` · ${v.note}` : ''}</span>
                    <Button size="sm" variant="ghost" className="h-7" busy={!!busy} onClick={() => open(d.id, v.version)}>{t('agreements.docs.download')}</Button>
                  </li>))}</ul></details>
            </div>
          ))}
          {archived.length > 0 && <p className="text-xs text-muted-foreground">{t('agreements.docs.archived', { count: archived.length })}</p>}
        </CardContent>
      </Card>

      {a.downloads && (
        <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.docs.log')}</CardTitle></CardHeader>
          <CardContent className="max-h-72 space-y-1 overflow-y-auto text-xs">{!a.downloads.length ? <p className="text-muted-foreground">{t('agreements.docs.noDownloads')}</p>
            : a.downloads.map((l, i) => <p key={i}>{new Date(l.at).toLocaleString(lang === 'ar' ? 'ar' : 'en-GB')} · {l.by} ({t(`agreements.party.${l.role}`, { defaultValue: l.role })}) · {docTitle(l.document_id)} v{l.version}</p>)}</CardContent></Card>
      )}

      <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">{t('agreements.docs.notices')}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">{!notices.length ? <p className="text-muted-foreground">{t('agreements.docs.notYet')}</p>
          : notices.map((e, i) => <p key={i}><span className="text-muted-foreground">{fmtDate(e.at, lang)}</span> · {t(`agreements.event.${e.kind}`, { defaultValue: e.kind.replace(/_/g, ' ') })}{e.kind === 'status' && e.data?.to ? `: ${t(`agreements.status.${String(e.data.to)}`)}` : ''}</p>)}</CardContent></Card>

      <Dialog open={!!dlg} onOpenChange={(v) => { if (!v) { setDlg(null); setFile(null); setNote(''); setNoSecrets(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dlg?.documentId ? t('agreements.docs.newVersion') : t('agreements.docs.upload')}</DialogTitle>
            <DialogDescription>{t('agreements.docs.uploadText', { mb: settings.doc_max_mb })}</DialogDescription></DialogHeader>
          {dlg && (
            <div className="space-y-3">
              {!dlg.documentId && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label>{t('agreements.docs.kindLabel')}</Label>
                    <Select value={dlg.kind} onValueChange={(v) => setDlg({ ...dlg, kind: v as DocKind })}><SelectTrigger aria-label={t('agreements.docs.kindLabel')}><SelectValue /></SelectTrigger>
                      <SelectContent>{DOC_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`agreements.docs.kind.${k}`)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label htmlFor="doc-title">{t('agreements.docs.title')}</Label><Input id="doc-title" maxLength={120} value={dlg.title} onChange={(e) => setDlg({ ...dlg, title: e.target.value })} /></div>
                </div>
              )}
              <div className="space-y-1"><Label htmlFor="doc-file">{t('agreements.docs.file')}</Label>
                <Input id="doc-file" ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                {fileProblem && <p className="text-xs text-destructive">{t(`agreements.err.${fileProblem}`, { mb: settings.doc_max_mb })}</p>}</div>
              <div className="space-y-1"><Label htmlFor="doc-note">{t('agreements.docs.note')}</Label><Textarea id="doc-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              {textProblem && <p className="text-xs text-destructive">{t(`agreements.err.${textProblem}`)}</p>}
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={noSecrets} onCheckedChange={(v) => setNoSecrets(!!v)} className="mt-0.5" /> {t('agreements.docs.confirmNoSecrets')}</label>
            </div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setDlg(null)}>{t('agreements.cancel')}</Button>
            <Button busy={busy === 'upload'} disabled={!file || !!fileProblem || !!textProblem || !noSecrets || (!dlg?.documentId && !dlg?.title.trim())} onClick={upload}>
              {busy === 'upload' && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('agreements.docs.uploadCta')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GenTile({ title, text, onClick, disabled, busy, label }: { title: string; text: string; onClick: () => void; disabled?: boolean; busy?: boolean; label: string }) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border p-3">
      <div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{text}</p></div>
      <Button size="sm" variant="outline" busy={busy} disabled={disabled} onClick={onClick}>{busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Download className="me-1 h-4 w-4" />}{label}</Button>
    </div>
  );
}
