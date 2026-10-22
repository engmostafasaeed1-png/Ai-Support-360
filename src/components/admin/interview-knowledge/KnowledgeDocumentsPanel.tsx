import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Eye, FileText, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ALL_SAP_AREAS } from '@/lib/sapAreas';
import { extractFileText } from '@/lib/extractFileText';
import {
  DOCUMENT_LANGUAGES, hasPersonalData, KNOWLEDGE_ACCEPT, parseTags, precheckFile, scanPersonalData, versionChoices,
  type KnowledgeDocument, type PiiFindings,
} from '@/lib/interviewKnowledge';
import { callKnowledge, uploadKnowledgeDocument, useDocumentExcerpts, useKnowledgeDocuments, useVersionOptions } from '@/hooks/useInterviewKnowledge';

const STATUS_CLASS: Record<string, string> = {
  uploaded: 'bg-muted text-muted-foreground',
  extracting: 'bg-primary/10 text-primary',
  ready: 'bg-primary text-primary-foreground',
  no_text: 'bg-secondary text-secondary-foreground',
  failed: 'bg-destructive/10 text-destructive',
};

const emptyForm = { title: '', sap_module: '', sap_version: '', language: 'en', tags: '', enabled: true, notes: '', rights: false };

function piiText(t: (k: string, o?: any) => string, p: Partial<PiiFindings> | null | undefined) {
  const parts: string[] = [];
  if (p?.emails) parts.push(t('ik.pii.emails', { count: p.emails, defaultValue: '{{count}} e-mail address(es)' }));
  if (p?.phones) parts.push(t('ik.pii.phones', { count: p.phones, defaultValue: '{{count}} phone number(s)' }));
  if (p?.longNumbers) parts.push(t('ik.pii.numbers', { count: p.longNumbers, defaultValue: '{{count}} long number(s)' }));
  return parts.join(', ');
}

export default function KnowledgeDocumentsPanel({ ready }: { ready: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const docs = useKnowledgeDocuments(ready);
  const versionRows = useVersionOptions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [piiWarn, setPiiWarn] = useState<PiiFindings | null>(null);
  const [toDelete, setToDelete] = useState<KnowledgeDocument | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [excerptsOf, setExcerptsOf] = useState<KnowledgeDocument | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const excerpts = useDocumentExcerpts(excerptsOf?.id ?? null);
  const versions = useMemo(() => (form.sap_module ? versionChoices(form.sap_module, versionRows.data ?? []) : []), [form.sap_module, versionRows.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ik', 'documents'] }); qc.invalidateQueries({ queryKey: ['ik', 'coverage'] }); };
  const dateFmt = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const pick = (f: File | null) => {
    if (!f) return;
    const check = precheckFile(f);
    if (check !== 'ok') { toast.error(t(`ik.upload.${check}`, check === 'too_large' ? 'The file is larger than 10 MB.' : 'Only PDF, DOCX, TXT and MD files are accepted.')); return; }
    setFile(f);
    setForm({ ...emptyForm, title: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200) });
    setOpen(true);
  };

  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadKnowledgeDocument(file, {
        title: form.title.trim(), sap_module: form.sap_module.trim(), sap_version: form.sap_version.trim() || null, language: form.language,
        tags: parseTags(form.tags), enabled: form.enabled, notes: form.notes.trim() || null, rights_confirmed: true,
      });
      setOpen(false);
      setFile(null);
      if (res.status === 'ready') toast.success(t('ik.upload.ready', { count: res.chunks ?? 0, defaultValue: 'Document ready: {{count}} excerpts.' }));
      else if (res.status === 'no_text') toast.warning(t('ik.status_reason.no_text', 'No text found. This looks like a scanned PDF or an image-only file.'));
      else toast.error(t('ik.upload.failed', 'The text could not be read. Use Re-extract or upload the file again.'));
      if (res.pii && hasPersonalData(res.pii)) toast.warning(t('ik.pii.after', { what: piiText(t, res.pii), defaultValue: 'The text seems to contain {{what}}. Delete the document if it holds client data.' }));
      refresh();
    } catch (e: any) {
      toast.error(e?.code ? t(`ik.errors.${e.code}`, e.message) : e?.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!file || !form.rights || !form.title.trim() || !form.sap_module.trim()) return;
    // Look for personal data in the browser first, so the admin can cancel before anything is stored.
    let findings: PiiFindings | null = null;
    try { findings = scanPersonalData(await extractFileText(file)); } catch { findings = null; }
    if (findings && hasPersonalData(findings)) { setPiiWarn(findings); return; }
    await send();
  };

  const toggle = async (d: KnowledgeDocument, enabled: boolean) => {
    setWorking(d.id);
    try { await callKnowledge({ action: 'update', document_id: d.id, enabled }); refresh(); }
    catch (e: any) { toast.error(e.message); }
    finally { setWorking(null); }
  };
  const reextract = async (d: KnowledgeDocument) => {
    setWorking(d.id);
    try {
      const res = await callKnowledge<{ status: string; chunks?: number }>({ action: 'reextract', document_id: d.id });
      if (res.status === 'busy') toast.info(t('ik.docs.busy', 'This document is being read right now. Try again in a few minutes.'));
      else toast.success(t('ik.docs.reextracted', 'Text read again.'));
      refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setWorking(null); }
  };
  const remove = async () => {
    if (!toDelete || deleteReason.trim().length < 3) return;
    setWorking(toDelete.id);
    try {
      await callKnowledge({ action: 'delete', document_id: toDelete.id, reason: deleteReason.trim() });
      toast.success(t('ik.docs.deleted', 'Document, file and excerpts deleted.'));
      setToDelete(null);
      setDeleteReason('');
      refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setWorking(null); }
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> {t('ik.docs.title', 'Knowledge documents')}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{t('ik.docs.subtitle', 'Private to administrators. Short excerpts feed the interview questions; candidates never see the documents.')}</p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept={KNOWLEDGE_ACCEPT} className="sr-only" aria-label={t('ik.docs.upload', 'Upload document')} onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <Button onClick={() => fileRef.current?.click()} disabled={!ready}><Upload className="h-4 w-4 me-1.5" />{t('ik.docs.upload', 'Upload document')}</Button>
          <p className="text-[11px] text-muted-foreground mt-1">{t('ik.docs.types', 'PDF, DOCX, TXT or MD, up to 10 MB')}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {docs.isLoading && <Skeleton className="h-24" />}
        {docs.error && <p role="alert" className="text-sm text-destructive">{(docs.error as Error).message}</p>}
        {ready && docs.data?.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">{t('ik.docs.empty', 'No documents yet. Without documents the interviewer uses the question library and general SAP knowledge.')}</p>}
        <ul className="grid gap-3 lg:grid-cols-2">
          {(docs.data ?? []).map((d) => {
            const pii = piiText(t, d.pii_flags);
            return (
              <li key={d.id} className={`rounded-xl border border-border/60 p-4 space-y-2 ${d.enabled ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground break-words">{d.title}</p>
                    <p className="text-xs text-muted-foreground">{d.sap_module}{d.sap_version ? ` · ${d.sap_version}` : ''} · {d.language.toUpperCase()} · {d.file_kind.toUpperCase()} · {(d.size_bytes / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <Badge className={`shrink-0 ${STATUS_CLASS[d.status] ?? ''}`} variant="secondary">
                    {d.status === 'extracting' && <Loader2 className="h-3 w-3 me-1 animate-spin" />}
                    {t(`ik.status.${d.status}`, d.status)}
                  </Badge>
                </div>
                {d.status_reason && d.status !== 'ready' && <p className="text-xs text-muted-foreground">{t(`ik.status_reason.${d.status === 'no_text' ? 'no_text' : 'failed'}`, d.status_reason)}</p>}
                {d.tags.length > 0 && <div className="flex flex-wrap gap-1">{d.tags.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}</div>}
                {pii && <p className="text-xs text-destructive flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{t('ik.pii.card', { what: pii, defaultValue: 'May contain {{what}}.' })}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {t('ik.docs.chunks', { count: d.chunk_count, defaultValue: '{{count}} excerpts' })} · {t('ik.docs.uploaded_at', { date: dateFmt.format(new Date(d.created_at)), defaultValue: 'Uploaded {{date}}' })}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs me-auto">
                    <Switch checked={d.enabled} disabled={working === d.id} onCheckedChange={(v) => toggle(d, v)} aria-label={t('ik.docs.enabled', 'Enabled')} />
                    {t('ik.docs.enabled', 'Enabled')}
                  </label>
                  <Button size="sm" variant="outline" disabled={!d.chunk_count} onClick={() => setExcerptsOf(d)}><Eye className="h-3.5 w-3.5 me-1" />{t('ik.docs.excerpts', 'Preview excerpts')}</Button>
                  <Button size="sm" variant="outline" disabled={working === d.id} onClick={() => reextract(d)}><RefreshCw className="h-3.5 w-3.5 me-1" />{t('ik.docs.reextract', 'Re-extract')}</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={working === d.id} onClick={() => setToDelete(d)} aria-label={t('ik.docs.delete', 'Delete')}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('ik.upload.title', 'Upload a knowledge document')}</DialogTitle>
            <DialogDescription className="break-all">{file?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="ik-title">{t('ik.upload.doc_title', 'Title')}</Label><Input id="ik-title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ik-module">{t('ik.upload.module', 'SAP module')}</Label>
                <Input id="ik-module" list="ik-modules" value={form.sap_module} maxLength={120} onChange={(e) => setForm({ ...form, sap_module: e.target.value })} placeholder="SAP FI" />
                <datalist id="ik-modules">{ALL_SAP_AREAS.map((a) => <option key={a.name} value={a.name} />)}</datalist>
              </div>
              <div>
                <Label htmlFor="ik-version">{t('ik.upload.version', 'Version / release (optional)')}</Label>
                <Input id="ik-version" list="ik-versions" value={form.sap_version} maxLength={60} onChange={(e) => setForm({ ...form, sap_version: e.target.value })} />
                <datalist id="ik-versions">{versions.map((v) => <option key={v} value={v} />)}</datalist>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t('ik.upload.language', 'Language')}</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DOCUMENT_LANGUAGES.map((l) => <SelectItem key={l} value={l}>{t(`ik.lang.${l}`, l)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="ik-tags">{t('ik.upload.tags', 'Tags (comma-separated)')}</Label><Input id="ik-tags" value={form.tags} maxLength={500} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="ik-notes">{t('ik.upload.notes', 'Notes (only for administrators)')}</Label><Textarea id="ik-notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />{t('ik.docs.enabled', 'Enabled')}</label>
            <label className="flex items-start gap-2 rounded-lg border border-border/60 p-3 text-sm">
              <Checkbox checked={form.rights} onCheckedChange={(v) => setForm({ ...form, rights: v === true })} className="mt-0.5" aria-required="true" />
              <span>{t('ik.upload.rights', 'I confirm I may use this document for training the interviewer (no confidential client data, copyright respected).')}</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={submit} disabled={busy || !form.rights || !form.title.trim() || !form.sap_module.trim()}>
              {busy && <Loader2 className="h-4 w-4 me-1.5 animate-spin" />}{busy ? t('ik.upload.working', 'Uploading and reading…') : t('ik.docs.upload', 'Upload document')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!piiWarn} onOpenChange={(v) => { if (!v) setPiiWarn(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ik.pii.title', 'This document may contain personal data')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ik.pii.body', { what: piiText(t, piiWarn), defaultValue: 'We found {{what}}. Knowledge documents must not contain confidential client data. Cancel and remove it, or upload anyway if these are public examples.' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('ik.pii.cancel', 'Cancel upload')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setPiiWarn(null); void send(); }}>{t('ik.pii.continue', 'Upload anyway')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!toDelete} onOpenChange={(v) => { if (!v) { setToDelete(null); setDeleteReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ik.delete.title', 'Delete this document?')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ik.delete.body', { title: toDelete?.title ?? '', defaultValue: '"{{title}}", its file and all its excerpts are deleted. Questions already asked keep their history. This is recorded in the audit log.' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="ik-del-reason">{t('ik.delete.reason', 'Reason (required)')}</Label>
            <Textarea id="ik-del-reason" rows={2} maxLength={300} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteReason.trim().length < 3} onClick={(e) => { e.preventDefault(); void remove(); }}>
              {t('ik.docs.delete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!excerptsOf} onOpenChange={(v) => { if (!v) setExcerptsOf(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('ik.docs.excerpts', 'Preview excerpts')}</DialogTitle>
            <DialogDescription>{excerptsOf?.title}</DialogDescription>
          </DialogHeader>
          {excerpts.isLoading ? <Skeleton className="h-32" /> : (
            <ol className="space-y-3">
              {(excerpts.data ?? []).map((c) => (
                <li key={c.id} className="rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words" dir="auto">
                  <span className="font-semibold text-foreground">#{c.chunk_no} </span>{c.body.slice(0, 900)}{c.body.length > 900 ? ' …' : ''}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
