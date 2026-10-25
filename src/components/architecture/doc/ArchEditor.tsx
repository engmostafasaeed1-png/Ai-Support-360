import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Eye, EyeOff, FileDown, Paperclip, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import RichTextField from '@/components/brd/RichTextField';
import BrdComments from '@/components/brd/BrdComments';
import { downloadText } from '@/lib/brd/exportDoc';
import {
  saveArchDraft, saveArchVersion, setArchStatus, setArchLinks, updateArchMeta, unattachArch, downloadAttachedArch,
  type ArchAsset, type ArchState,
} from '@/lib/architecture/api';
import { archPdfBlob } from '@/lib/architecture/pdf';
import { useClientTickets } from '@/hooks/useClientTickets';
import {
  LIMITS, SECTION_TITLES, allowedStatuses, archFileName, archProblems, normalizeArchContent, traceMatrix,
  type ArchContent, type ArchStatus,
} from '../../../../supabase/functions/_shared/archModel';
import ArchStatusBadge from '../ArchStatusBadge';
import DiagramBlocks from './DiagramBlocks';
import TracePicker from './TracePicker';
import ArchVersions from './ArchVersions';
import ArchAttachDialog from './ArchAttachDialog';
import ArchAiDialog, { type AiChange } from './ArchAiDialog';
import { archCommentApi, draftOf, metaOf, refOf } from './archShared';
import { NoSecretsWarning } from '../LandscapeRegister';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error' | 'conflict';

/** Editor for the owning company's writers and admins: autosaved draft, immutable versions, status, sharing. */
export default function ArchEditor({ state, onReload }: { state: ArchState; onReload: () => void }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const qc = useQueryClient();
  const doc = state.doc!;
  const [content, setContent] = useState<ArchContent>(() => draftOf(state));
  const [assets, setAssets] = useState<ArchAsset[]>(state.assets ?? []);
  const rev = useRef<number | null>(doc.draft_rev ?? null);
  const [save, setSave] = useState<SaveState>('saved');
  const timer = useRef<number | null>(null);
  const latest = useRef(content);
  latest.current = content;
  const [versionDlg, setVersionDlg] = useState(false);
  const [note, setNote] = useState('');
  const [attachDlg, setAttachDlg] = useState(false);
  const [aiDlg, setAiDlg] = useState(false);
  const [statusDlg, setStatusDlg] = useState<ArchStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [linksDlg, setLinksDlg] = useState(false);
  const [busy, setBusy] = useState(false);
  const dir = content.language === 'ar' ? 'rtl' : 'ltr';
  const lang = content.language;
  const versions = state.versions ?? [];
  const latestVersion = versions[0]?.version ?? 0;
  const problems = archProblems(content);
  const matrix = traceMatrix(content, state.requirements ?? []);
  const writable = state.can_write;

  const flush = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (!writable) return true;
    setSave('saving');
    const r = await saveArchDraft(doc.id, latest.current, rev.current);
    if (r.error) {
      const conflict = /conflict|another tab/i.test(r.error.message);
      setSave(conflict ? 'conflict' : 'error');
      if (!conflict) toast.error(r.error.message);
      return false;
    }
    rev.current = r.data?.rev ?? rev.current;
    if (r.data?.masked && r.data.content) { setContent(normalizeArchContent(r.data.content, doc.type)); toast.info(t('arch.editor.masked')); }
    setSave('saved');
    return true;
  }, [doc.id, doc.type, writable, t]);

  const change = (next: ArchContent) => {
    setContent(next);
    setSave('dirty');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, 2000);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save === 'dirty' || save === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  const setSection = (key: string, patch: Partial<ArchContent['sections'][number]>) =>
    change({ ...content, sections: content.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) });

  const saveVersion = async () => {
    setBusy(true);
    const r = await saveArchVersion(doc.id, content, note.trim(), rev.current);
    setBusy(false);
    if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return; }
    rev.current = r.data.rev;
    setSave('saved');
    toast.success(t('arch.editor.versionSaved', { v: r.data.version }));
    setVersionDlg(false); setNote('');
    onReload();
  };
  const changeStatus = async () => {
    if (!statusDlg) return;
    if (!(await flush())) return;
    setBusy(true);
    const r = await setArchStatus(doc.id, statusDlg, statusNote.trim());
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    toast.success(t('arch.editor.statusChanged', { status: t(`arch.status.${statusDlg}`) }));
    setStatusDlg(null); setStatusNote('');
    void qc.invalidateQueries({ queryKey: ['arch-list'] });
    onReload();
  };
  const meta = async (patch: Parameters<typeof updateArchMeta>[1]) => {
    const r = await updateArchMeta(doc.id, patch);
    if (r.error) { toast.error(r.error.message); return; }
    void qc.invalidateQueries({ queryKey: ['arch-list'] });
    onReload();
  };
  const exportPdf = async () => {
    if (!(await flush())) return;
    setBusy(true);
    try {
      const blob = await archPdfBlob(content, { ref: refOf(state), meta: metaOf(state), version: null, versions, systems: (state.systems ?? []).filter((s) => content.systems.includes(s.id!)) }, assets);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = archFileName(doc.type, refOf(state), Math.max(1, latestVersion)).replace('.pdf', '_draft.pdf');
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast.error(t('arch.common.failed')); } finally { setBusy(false); }
  };
  const applyAi = (changes: AiChange[]) => {
    change({
      ...content,
      sections: content.sections.map((s) => {
        const c = changes.find((x) => x.key === s.key);
        if (!c) return s;
        const trace = [...s.trace, ...c.trace.filter((x) => !s.trace.some((y) => y.req_id === x.req_id && y.ticket_ref === x.ticket_ref))].slice(0, LIMITS.tracePerSection);
        return { ...s, html: c.html, trace };
      }),
    });
    toast.success(t('arch.ai.applied', { count: changes.length }));
  };

  const saveLabel = { saved: t('arch.editor.saved'), saving: t('arch.editor.saving'), dirty: t('arch.editor.unsaved'), error: t('arch.editor.saveError'), conflict: t('arch.editor.conflict') }[save];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 sticky top-2 z-10">
          <span className={`text-xs ${save === 'error' || save === 'conflict' ? 'text-destructive' : 'text-muted-foreground'}`} role="status" aria-live="polite">{saveLabel}</span>
          {save === 'conflict' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReload}>{t('arch.editor.reload')}</Button>}
          <div className="ms-auto flex flex-wrap gap-1.5">
            {state.ai_enabled && writable && <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => setAiDlg(true)}><Sparkles className="h-3.5 w-3.5" />{t('arch.ai.button')}</Button>}
            <Button size="sm" variant="outline" className="gap-1 h-8" disabled={busy} onClick={() => void exportPdf()}><FileDown className="h-3.5 w-3.5" />{t('arch.editor.pdf')}</Button>
            {writable && <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => setAttachDlg(true)}><Paperclip className="h-3.5 w-3.5" />{t('arch.attach.button')}</Button>}
            {writable && <Button size="sm" className="gap-1 h-8" disabled={problems.length > 0} onClick={() => setVersionDlg(true)}><Save className="h-3.5 w-3.5" />{t('arch.editor.saveVersion')}</Button>}
          </div>
        </div>
        {problems.length > 0 && <p className="text-sm text-destructive" role="alert">{t('arch.editor.problems')}</p>}

        {content.sections.map((s, i) => (
          <section key={s.key} id={`sec-${s.key}`} className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby={`h-${s.key}`}>
            <div className="flex items-center gap-2">
              <h2 id={`h-${s.key}`} className={`text-base font-semibold ${s.hidden ? 'text-muted-foreground line-through' : ''}`}>{i + 1}. {SECTION_TITLES[s.key][lang]}</h2>
              {writable && (
                <Button size="icon" variant="ghost" className="h-7 w-7 ms-auto" aria-label={s.hidden ? t('arch.editor.show') : t('arch.editor.hide')} aria-pressed={!!s.hidden}
                  onClick={() => setSection(s.key, { hidden: !s.hidden })}>{s.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
              )}
            </div>
            {!s.hidden && (
              <>
                <RichTextField value={s.html} onChange={(html) => setSection(s.key, { html })} dir={dir} label={SECTION_TITLES[s.key][lang]} max={LIMITS.sectionChars} readOnly={!writable} />
                <TracePicker value={s.trace} requirements={state.requirements ?? []} onChange={(trace) => setSection(s.key, { trace })} readOnly={!writable} />
                {writable ? (
                  <DiagramBlocks docId={doc.id} diagrams={s.diagrams} assets={assets} onAsset={(a) => setAssets((x) => [...x, a])} onChange={(diagrams) => setSection(s.key, { diagrams })} />
                ) : null}
                {latestVersion > 0 && (
                  <BrdComments ticketId="" version={latestVersion} section={s.key} comments={state.comments ?? []} canSuggest={false} canDecide={writable}
                    onChanged={onReload} dir={dir} api={archCommentApi(doc.id)}
                    onAcceptSuggestion={(c) => { if (c.suggested_text) setSection(s.key, { html: `<p>${c.suggested_text.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]!))}</p>` }); }} />
                )}
              </>
            )}
          </section>
        ))}
      </div>

      <aside className="space-y-4" aria-label={t('arch.editor.panel')}>
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2"><ArchStatusBadge status={doc.status} />{doc.approved_version && <Badge variant="outline" className="text-[10px]">{t('arch.editor.approvedV', { v: doc.approved_version })}</Badge>}</div>
          {writable && (
            <Select value="" onValueChange={(v) => setStatusDlg(v as ArchStatus)}>
              <SelectTrigger className="h-8" aria-label={t('arch.editor.changeStatus')}><SelectValue placeholder={t('arch.editor.changeStatus')} /></SelectTrigger>
              <SelectContent>{allowedStatuses(doc.status, latestVersion).map((s) => <SelectItem key={s} value={s}>{t(`arch.status.${s}`)}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {doc.status === 'archived' && writable === false && state.role !== 'consultant' && (
            <Button size="sm" variant="outline" onClick={() => setStatusDlg('draft')}>{t('arch.editor.unarchive')}</Button>
          )}
          <div className="space-y-1">
            <Label className="text-xs">{t('arch.fields.conf')}</Label>
            <Select value={doc.confidentiality} disabled={!writable} onValueChange={(v) => void meta({ confidentiality: v as 'private' | 'shared' })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="private">{t('arch.conf.private')}</SelectItem><SelectItem value="shared">{t('arch.conf.shared')}</SelectItem></SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t(doc.confidentiality === 'shared' ? 'arch.conf.sharedHint' : 'arch.conf.privateHint')}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between"><Label className="text-xs">{t('arch.fields.tickets')}</Label>
              {writable && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setLinksDlg(true)}>{t('arch.common.edit')}</Button>}</div>
            {doc.links.length === 0 ? <p className="text-xs text-muted-foreground">{t('arch.editor.noLinks')}</p> : (
              <ul className="text-xs space-y-0.5">{doc.links.map((l) => <li key={l.ticket_id}><span className="font-mono">{l.ref}</span> · {l.title}</li>)}</ul>
            )}
          </div>
          {(state.systems ?? []).length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">{t('arch.editor.systems')}</Label>
              <ul className="space-y-1">
                {(state.systems ?? []).map((sy) => (
                  <li key={sy.id}>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox disabled={!writable} checked={content.systems.includes(sy.id!)}
                        onCheckedChange={(v) => change({ ...content, systems: v ? [...content.systems, sy.id!] : content.systems.filter((x) => x !== sy.id) })} />
                      {sy.name} {sy.sid && <span className="font-mono">({sy.sid})</span>} · {sy.role}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <Tabs defaultValue="versions" className="rounded-2xl border border-border bg-card p-3">
          <TabsList className="w-full flex-wrap h-auto">
            <TabsTrigger value="versions" className="text-xs">{t('arch.editor.versions')}</TabsTrigger>
            <TabsTrigger value="trace" className="text-xs">{t('arch.editor.trace')}</TabsTrigger>
            <TabsTrigger value="files" className="text-xs">{t('arch.editor.attached')}</TabsTrigger>
            <TabsTrigger value="log" className="text-xs">{t('arch.editor.log')}</TabsTrigger>
          </TabsList>
          <TabsContent value="versions">
            <ArchVersions docId={doc.id} type={doc.type} versions={versions} assets={assets} canWrite={writable}
              onRestored={(c, r) => { setContent(c); rev.current = r; setSave('saved'); onReload(); }} />
          </TabsContent>
          <TabsContent value="trace" className="space-y-2 text-xs">
            {(state.requirements ?? []).length === 0 ? <p className="text-muted-foreground">{t('arch.trace.none')}</p> : (
              <>
                <p className="text-muted-foreground">{t('arch.trace.summary', { covered: matrix.rows.length - matrix.uncovered.length, total: matrix.rows.length })}</p>
                <ul className="space-y-1">
                  {matrix.rows.map((r) => (
                    <li key={`${r.ticket_ref}${r.req_id}`} className={r.sections.length ? '' : 'text-destructive'}>
                      <span className="font-mono">{r.ticket_ref} {r.req_id}</span> → {r.sections.length ? r.sections.map((k) => SECTION_TITLES[k][lang]).join(', ') : t('arch.trace.uncovered')}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {matrix.unknown.length > 0 && <p className="text-muted-foreground">{t('arch.trace.unknownCount', { count: matrix.unknown.length })}</p>}
          </TabsContent>
          <TabsContent value="files" className="space-y-2">
            {(state.attachments ?? []).length === 0 ? <p className="text-xs text-muted-foreground">{t('arch.attach.none')}</p> : (
              <ul className="space-y-2 text-xs">
                {(state.attachments ?? []).map((a) => (
                  <li key={a.id} className="rounded-lg border border-border p-2 space-y-1">
                    <div className="flex items-center gap-1"><span className="font-mono">{a.ticket_ref}</span> · v{a.version}{a.unattached_at && <Badge variant="outline" className="text-[10px] ms-1">{t('arch.attach.removed')}</Badge>}</div>
                    <p className="truncate">{a.file_name}</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={async () => { const e = await downloadAttachedArch(doc.id, a); if (e) toast.error(e); }}><Download className="h-3 w-3" />{t('arch.attach.download')}</Button>
                      {writable && !a.unattached_at && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={async () => {
                        if (!window.confirm(t('arch.attach.unattachConfirm'))) return;
                        const r = await unattachArch(a.id, 'removed by client'); if (r.error) toast.error(r.error.message); else onReload();
                      }}>{t('arch.attach.unattach')}</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="log" className="space-y-2 text-xs">
            <h3 className="font-semibold">{t('arch.editor.opened')}</h3>
            {(state.access_log ?? []).length === 0 ? <p className="text-muted-foreground">{t('arch.editor.noOpens')}</p> : (
              <ul className="space-y-0.5">{(state.access_log ?? []).slice(0, 50).map((l, i) => (
                <li key={i}>{l.viewer} ({t(`brd.role.${l.role}`)}) · v{l.version} · {t(`arch.editor.action_${l.action}`)} · {new Date(l.at).toLocaleString(ar ? 'ar' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</li>
              ))}</ul>
            )}
            <h3 className="font-semibold pt-2">{t('arch.editor.audit')}</h3>
            <ul className="space-y-0.5">{(state.events ?? []).slice(0, 50).map((e, i) => (
              <li key={i}>{t(`arch.timeline.${e.action}`, e.action)}{e.version ? ` v${e.version}` : ''} · {e.actor} · {new Date(e.at).toLocaleString(ar ? 'ar' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</li>
            ))}</ul>
            <button type="button" className="text-primary underline" onClick={() => downloadText(`ARCH_${refOf(state)}_audit.csv`,
              ['when,action,version,by', ...(state.events ?? []).map((e) => [e.at, e.action, e.version ?? '', `"${(e.actor ?? '').replace(/"/g, '""')}"`].join(','))].join('\n'), 'text/csv')}>
              {t('arch.editor.auditCsv')}
            </button>
          </TabsContent>
        </Tabs>
        {writable && <NoSecretsWarning />}
      </aside>

      <Dialog open={versionDlg} onOpenChange={setVersionDlg}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('arch.editor.saveVersionTitle', { v: latestVersion + 1 })}</DialogTitle>
            <DialogDescription>{doc.status === 'approved' ? t('arch.editor.backToReview') : t('arch.editor.versionHint')}</DialogDescription>
          </DialogHeader>
          <Input value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} placeholder={t('arch.versions.note')} aria-label={t('arch.versions.note')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVersionDlg(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={saveVersion} disabled={busy}>{t('arch.editor.saveVersion')}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!statusDlg} onOpenChange={(o) => !o && setStatusDlg(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('arch.editor.statusTitle', { status: statusDlg ? t(`arch.status.${statusDlg}`) : '' })}</DialogTitle>
            <DialogDescription>{statusDlg === 'approved' ? t('arch.editor.approveHint', { v: latestVersion }) : statusDlg === 'archived' ? t('arch.editor.archiveHint') : t('arch.editor.statusHint')}</DialogDescription>
          </DialogHeader>
          <Input value={statusNote} maxLength={300} onChange={(e) => setStatusNote(e.target.value)} placeholder={statusDlg === 'archived' ? t('arch.editor.reason') : t('arch.versions.note')} aria-label={t('arch.versions.note')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStatusDlg(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={changeStatus} disabled={busy || (statusDlg === 'archived' && statusNote.trim().length < 3)}>{t('arch.common.confirm')}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {linksDlg && <LinksDialog current={doc.links.map((l) => l.ticket_id)} projects={doc.projects.map((p) => p.project_id)} onClose={() => setLinksDlg(false)}
        onSave={async (ids, pr) => { const r = await setArchLinks(doc.id, ids, pr); if (r.error) toast.error(r.error.message); else { setLinksDlg(false); onReload(); } }} />}
      {attachDlg && <ArchAttachDialog state={state} open={attachDlg} onOpenChange={setAttachDlg} onDone={onReload} />}
      {aiDlg && <ArchAiDialog open={aiDlg} onOpenChange={setAiDlg} docId={doc.id} content={content} links={doc.links} usage={state.usage} onApply={applyAi} />}
    </div>
  );
}

function LinksDialog({ current, projects, onClose, onSave }: { current: string[]; projects: string[]; onClose: () => void; onSave: (t: string[], p: string[]) => void }) {
  const { t } = useTranslation();
  const { data: tickets = [] } = useClientTickets();
  const [ids, setIds] = useState(current);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('arch.fields.tickets')}</DialogTitle><DialogDescription>{t('arch.editor.linksHint')}</DialogDescription></DialogHeader>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {tickets.map((tk) => (
            <label key={tk.id} className="flex items-center gap-2 p-2 text-sm">
              <Checkbox checked={ids.includes(tk.id)} onCheckedChange={(v) => setIds(v ? [...ids, tk.id].slice(0, LIMITS.links) : ids.filter((x) => x !== tk.id))} />
              <span className="truncate">{tk.title}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={() => onSave(ids, projects)}>{t('arch.common.save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
