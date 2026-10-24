import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Save, FileDown, Share2, Sparkles, GripVertical, ChevronDown, Eye, EyeOff, Lock, Loader2, CheckCircle2, AlertTriangle, Wand2, Scissors, Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { adminBrdUnlock, runBrdAi, saveBrdDraft, saveBrdVersion, type BrdCommentRow, type BrdState } from '@/lib/brd/api';
import { brdPdfBlob } from '@/lib/brd/pdf';
import { brdMarkdown, brdWordHtml, downloadText } from '@/lib/brd/exportDoc';
import { textToHtml } from '@/lib/brd/sanitize';
import RichTextField from './RichTextField';
import RequirementsTable from './RequirementsTable';
import BrdQuestions from './BrdQuestions';
import SectionAiDialog, { type SectionAiMode } from './SectionAiDialog';
import BrdVersionsPanel from './BrdVersionsPanel';
import BrdAttachDialog from './BrdAttachDialog';
import BrdAttachments from './BrdAttachments';
import BrdComments from './BrdComments';
import BrdAccessLog from './BrdAccessLog';
import { announceReport, aiErrorText } from './aiFeedback';
import { cleanContent } from '../../../supabase/functions/_shared/brdSafety';
import {
  AI_SECTION_KEYS, LIMITS, SECTION_TITLES, brdFileName, contentProblems, countTbc, normalizeContent,
  type BrdContent, type BrdSection, type SectionKey,
} from '../../../supabase/functions/_shared/brdModel';
import type { IncludeFlags } from '../../../supabase/functions/_shared/brdTicketParts';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

interface Props {
  state: BrdState;
  initial: BrdContent;
  initialRev: number | null;
  /** True right after the wizard: the first autosave creates the BRD. */
  fresh?: boolean;
  isAdmin: boolean;
  refresh: () => void;
}

function SortableSection({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'relative z-10 shadow-xl rounded-2xl' : ''}>
      {children(
        <button type="button" className="cursor-grab text-muted-foreground p-1 rounded focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('brd.editor.dragSection')} {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>,
      )}
    </div>
  );
}

/** The client's (and admin's) BRD editor: autosaved draft, versions, PDF/Word/Markdown export, attach, comments. */
export default function BrdWorkspace({ state, initial, initialRev, fresh, isAdmin, refresh }: Props) {
  const { t, i18n } = useTranslation();
  const ticket = state.ticket!;
  const [content, setContent] = useState<BrdContent>(initial);
  const [rev, setRev] = useState<number | null>(initialRev);
  const [save, setSave] = useState<SaveState>(fresh ? 'unsaved' : 'saved');
  const [savedAt, setSavedAt] = useState<string | null>(state.brd?.draft_saved_at ?? null);
  const [tab, setTab] = useState('document');
  const [include] = useState<IncludeFlags>({});
  const [ai, setAi] = useState<{ section: SectionKey; mode: SectionAiMode; deep: boolean } | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [note, setNote] = useState('');
  const [vStatus, setVStatus] = useState<'draft' | 'final'>('draft');
  const [attachOpen, setAttachOpen] = useState<number | null | false>(false);
  const [exporting, setExporting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [suggestion, setSuggestion] = useState<BrdCommentRow | null>(null);
  const dirty = useRef(!!fresh);
  const inflight = useRef(false);
  const latest = useRef(content);
  latest.current = content;
  const revRef = useRef(rev);
  revRef.current = rev;

  const lang = content.language === 'ar' ? 'ar' : 'en';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const uiLang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const closed = ticket.status === 'closed' && !state.can_write;
  const canWrite = !!state.can_write;
  const isFinal = content.control.status === 'final';
  const readOnly = !canWrite || isFinal;
  const versions = state.versions ?? [];
  const problems = contentProblems(content);

  // ------------------------------------------------------------ autosave (single flight, conflict-safe)
  const flush = useCallback(async () => {
    if (!canWrite || inflight.current || !dirty.current) return;
    inflight.current = true;
    dirty.current = false;
    setSave('saving');
    const snapshot = latest.current;
    const r = await saveBrdDraft(ticket.id, snapshot, revRef.current);
    inflight.current = false;
    if (r.error || !r.data) {
      if (r.error?.code === '40001') { setSave('conflict'); return; }
      dirty.current = true;
      setSave('error');
      return;
    }
    setRev(r.data.rev);
    setSavedAt(r.data.saved_at);
    if (r.data.masked && r.data.content) {
      setContent(normalizeContent(r.data.content));
      toast.info(t('brd.save.masked'));
    }
    if (revRef.current === null) refresh();
    setSave(dirty.current ? 'unsaved' : 'saved');
  }, [canWrite, ticket.id, refresh, t]);

  useEffect(() => {
    if (!dirty.current) return;
    const id = window.setTimeout(() => { void flush(); }, 1500);
    return () => window.clearTimeout(id);
  }, [content, flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current || inflight.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const change = (next: BrdContent) => {
    if (readOnly) return;
    dirty.current = true;
    setSave('unsaved');
    setContent(next);
  };
  const patchSection = (key: SectionKey, patch: Partial<BrdSection>) =>
    change({ ...content, sections: content.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) });

  // ------------------------------------------------------------ sections order
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const movable = content.sections.filter((s) => s.key !== 'change_log');
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const keys = movable.map((s) => s.key as string);
    const moved = arrayMove(movable, keys.indexOf(String(e.active.id)), keys.indexOf(String(e.over.id)));
    change({ ...content, sections: [...moved, ...content.sections.filter((s) => s.key === 'change_log')] });
  };

  // ------------------------------------------------------------ versions
  const doSaveVersion = async () => {
    await flush();
    const { content: clean, report } = cleanContent(latest.current);
    if (report.secrets) toast.warning(t('brd.ai.removedSecrets', { count: report.secrets }));
    const r = await saveBrdVersion(ticket.id, clean, note.trim(), vStatus, revRef.current);
    if (r.error || !r.data) {
      toast.error(r.error?.code === '40001' ? t('brd.save.conflict') : (r.error?.message ?? t('brd.err.save')));
      return;
    }
    dirty.current = false;
    setRev(r.data.rev);
    setContent(normalizeContent(r.data.content));
    setSave('saved');
    setVersionOpen(false);
    setNote('');
    toast.success(t('brd.versions.saved', { v: r.data.version }));
    refresh();
  };

  const startNewDraft = () => {
    dirty.current = true;
    setSave('unsaved');
    setContent({ ...content, control: { ...content.control, status: 'draft' } });
  };

  // ------------------------------------------------------------ exports
  const versionMeta = versions;
  const exportPdf = async () => {
    setExporting(true);
    try {
      const blob = await brdPdfBlob(content, { ticketRef: ticket.ref, ticketTitle: ticket.title, version: null, versions: versionMeta });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = brdFileName(ticket.ref, state.brd?.latest_version || 1).replace('.pdf', '_draft.pdf');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      toast.error(t('brd.export.failed'));
    } finally {
      setExporting(false);
    }
  };
  const base = brdFileName(ticket.ref, state.brd?.latest_version || 1).replace('.pdf', '');

  // ------------------------------------------------------------ "update the draft with my answers"
  const useAnswers = async () => {
    setUpdating(true);
    const { result, error } = await runBrdAi<{ content: BrdContent }>({
      action: 'draft', ticketId: ticket.id, language: content.language, template: content.template, include, attachments: [],
      clientAnswers: content.questions.filter((q) => q.answer.trim()).map((q) => ({ question: q.question, answer: q.answer })),
    }, () => undefined);
    setUpdating(false);
    if (error || !result) { toast.error(aiErrorText(t, error ?? { code: 'error', status: 500, message: '' })); return; }
    setPendingDraft(result.content);
    announceReport(t, result.report);
  };
  const [pendingDraft, setPendingDraft] = useState<BrdContent | null>(null);

  const commentsBySection = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of state.comments ?? []) if (c.status === 'open') m.set(c.section_key, (m.get(c.section_key) ?? 0) + 1);
    return m;
  }, [state.comments]);
  const latestVersion = state.brd?.latest_version ?? 0;
  const openComments = (state.comments ?? []).filter((c) => c.status === 'open').length;

  const saveLabel = save === 'saving' ? t('brd.save.saving') : save === 'unsaved' ? t('brd.save.unsaved') : save === 'error' ? t('brd.save.error')
    : save === 'conflict' ? t('brd.save.conflict') : savedAt ? t('brd.save.savedAt', { when: new Date(savedAt).toLocaleTimeString(uiLang === 'ar' ? 'ar' : 'en-GB', { timeStyle: 'short' }) }) : t('brd.save.saved');

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <Card className="rounded-2xl border-border/50 sticky top-2 z-20 bg-card/95 backdrop-blur">
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 me-auto">
            <Badge variant={isFinal ? 'default' : 'secondary'}>{isFinal ? t('brd.status.final') : t('brd.status.draft')}</Badge>
            {latestVersion > 0 && <Badge variant="outline">{t('brd.versions.latest', { v: latestVersion })}</Badge>}
            {state.brd?.shared_version
              ? <Badge className="bg-success text-success-foreground">{t('brd.versions.sharedMarker', { v: state.brd.shared_version })}</Badge>
              : <Badge variant="outline">{t('brd.versions.notShared')}</Badge>}
            <span className={`text-xs flex items-center gap-1 ${save === 'error' || save === 'conflict' ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">
              {save === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : save === 'saved' ? <CheckCircle2 className="h-3 w-3" /> : save !== 'unsaved' ? <AlertTriangle className="h-3 w-3" /> : null}
              {saveLabel}
            </span>
          </div>
          {canWrite && (
            <Button size="sm" className="gap-1.5" onClick={() => { setVStatus('draft'); setVersionOpen(true); }} disabled={problems.length > 0}>
              <Save className="h-4 w-4" /> {t('brd.versions.saveNew')}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={exporting}>{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} {t('brd.export.label')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPdf}>{t('brd.export.pdf')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadText(`${base}.doc`, brdWordHtml(content, { version: null, versions: versionMeta }), 'application/msword')}>{t('brd.export.word')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadText(`${base}.md`, brdMarkdown(content, { version: null, versions: versionMeta }), 'text/markdown')}>{t('brd.export.md')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canWrite && (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={versions.length === 0} onClick={() => setAttachOpen(versions[0]?.version ?? null)}
              title={versions.length === 0 ? t('brd.attach.needVersion') : undefined}>
              <Share2 className="h-4 w-4" /> {t('brd.attach.button')}
            </Button>
          )}
        </CardContent>
      </Card>

      {save === 'conflict' && (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" /> {t('brd.save.conflictLong')}
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{t('brd.save.reload')}</Button>
        </div>
      )}
      {closed && (
        <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm flex items-center gap-2"><Lock className="h-4 w-4" /> {t('brd.closedBanner')}</div>
      )}
      {isAdmin && ticket.status === 'closed' && (
        <div className="rounded-xl border border-border p-3 text-sm flex flex-wrap items-center gap-2">
          <Lock className="h-4 w-4" /> {state.brd?.edit_unlocked ? t('brd.admin.unlocked') : t('brd.admin.locked')}
          <Button size="sm" variant="outline" onClick={async () => {
            const reason = window.prompt(t('brd.reason')) ?? '';
            if (reason.trim().length < 3) return;
            const r = await adminBrdUnlock(ticket.id, !state.brd?.edit_unlocked, reason);
            if (r.error) toast.error(r.error.message); else refresh();
          }}>{state.brd?.edit_unlocked ? t('brd.admin.relock') : t('brd.admin.reopen')}</Button>
        </div>
      )}
      {isFinal && canWrite && (
        <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm flex flex-wrap items-center gap-2">
          <Lock className="h-4 w-4" /> {t('brd.finalBanner')}
          <Button size="sm" variant="outline" onClick={startNewDraft}>{t('brd.startNext', { v: latestVersion + 1 })}</Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="document">{t('brd.tabs.document')}</TabsTrigger>
          <TabsTrigger value="versions">{t('brd.tabs.versions', { count: versions.length })}</TabsTrigger>
          <TabsTrigger value="shared">{t('brd.tabs.shared')}</TabsTrigger>
          <TabsTrigger value="comments">{t('brd.tabs.comments', { count: openComments })}</TabsTrigger>
          <TabsTrigger value="access">{t('brd.tabs.access')}</TabsTrigger>
        </TabsList>

        <TabsContent value="document" className="space-y-4 mt-4">
          {/* document control */}
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-4 grid sm:grid-cols-2 gap-3" dir={dir}>
              <h3 className="sm:col-span-2 font-semibold">{t('brd.control.heading')}</h3>
              {(['title', 'company', 'requester', 'approvers'] as const).map((k) => (
                <div key={k} className={`space-y-1 ${k === 'title' ? 'sm:col-span-2' : ''}`}>
                  <Label htmlFor={`brd-c-${k}`} className="text-xs">{t(`brd.control.${k}`)}</Label>
                  <Input id={`brd-c-${k}`} value={content.control[k]} readOnly={readOnly} maxLength={k === 'title' ? LIMITS.title : k === 'approvers' ? LIMITS.approvers : 200}
                    onChange={(e) => change({ ...content, control: { ...content.control, [k]: e.target.value } })} />
                </div>
              ))}
              <div className="space-y-1"><Label htmlFor="brd-c-date" className="text-xs">{t('brd.control.date')}</Label>
                <Input id="brd-c-date" type="date" value={content.control.date} readOnly={readOnly} onChange={(e) => e.target.value && change({ ...content, control: { ...content.control, date: e.target.value } })} /></div>
              <div className="space-y-1"><span className="text-xs block">{t('brd.control.ticket')}</span><p className="text-sm font-medium">#{content.control.ticket_ref}</p></div>
              {problems.includes('title') && <p className="sm:col-span-2 text-xs text-destructive">{t('brd.err.title')}</p>}
            </CardContent>
          </Card>

          <BrdQuestions questions={content.questions} dir={dir} readOnly={readOnly} busy={updating}
            onChange={(q) => change({ ...content, questions: q })} onUseAnswers={useAnswers} />

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={movable.map((s) => s.key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {[...movable, ...content.sections.filter((s) => s.key === 'change_log')].map((s) => {
                  const tbc = countTbc(s.html) + countTbc(s.html_ar ?? '');
                  const card = (handle: React.ReactNode) => (
                    <Collapsible defaultOpen={!s.hidden}>
                      <Card className={`rounded-2xl border-border/50 ${s.hidden ? 'opacity-70' : ''}`}>
                        <div className="flex items-center gap-1 p-2">
                          {!readOnly && s.key !== 'change_log' && handle}
                          <CollapsibleTrigger asChild>
                            <button type="button" className="flex-1 min-w-0 flex items-center gap-2 text-start px-1 py-1 rounded focus-visible:ring-2 focus-visible:ring-ring">
                              <ChevronDown className="h-4 w-4 shrink-0 transition-transform [[data-state=closed]_&]:-rotate-90 rtl:[[data-state=closed]_&]:rotate-90" />
                              <span className="font-medium text-sm truncate">{SECTION_TITLES[s.key][uiLang]}</span>
                              {tbc > 0 && <Badge variant="secondary" className="text-[10px] bg-warning/20">{t('brd.tbcShort', { count: tbc })}</Badge>}
                              {(commentsBySection.get(s.key) ?? 0) > 0 && <Badge variant="outline" className="text-[10px]">{t('brd.comments.count', { count: commentsBySection.get(s.key) })}</Badge>}
                              {s.hidden && <Badge variant="outline" className="text-[10px]">{t('brd.editor.hidden')}</Badge>}
                            </button>
                          </CollapsibleTrigger>
                          {!readOnly && (AI_SECTION_KEYS as readonly string[]).includes(s.key) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="h-8 gap-1"><Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">{t('brd.ai.menu')}</span></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setAi({ section: s.key, mode: 'regenerate', deep: false })}><Sparkles className="h-4 w-4 me-2" /> {t('brd.ai.mode_regenerate')}</DropdownMenuItem>
                                <DropdownMenuItem disabled={!s.html} onClick={() => setAi({ section: s.key, mode: 'improve', deep: false })}><Wand2 className="h-4 w-4 me-2" /> {t('brd.ai.mode_improve')}</DropdownMenuItem>
                                <DropdownMenuItem disabled={!s.html} onClick={() => setAi({ section: s.key, mode: 'shorter', deep: false })}><Scissors className="h-4 w-4 me-2" /> {t('brd.ai.mode_shorter')}</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setAi({ section: s.key, mode: 'regenerate', deep: true })}><Brain className="h-4 w-4 me-2" /> {t('brd.ai.deepMenu')}</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          {!readOnly && (
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-pressed={!s.hidden}
                              aria-label={s.hidden ? t('brd.editor.show') : t('brd.editor.hide')} title={s.hidden ? t('brd.editor.show') : t('brd.editor.hide')}
                              onClick={() => patchSection(s.key, { hidden: !s.hidden })}>
                              {s.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>
                        <CollapsibleContent>
                          <div className="px-4 pb-4 space-y-3">
                            {s.key === 'change_log' ? (
                              <p className="text-xs text-muted-foreground">{t('brd.editor.changeLogAuto')}</p>
                            ) : (
                              <>
                                <RichTextField value={s.html} dir={dir} readOnly={readOnly} max={LIMITS.sectionChars}
                                  label={SECTION_TITLES[s.key][lang]} placeholder={t('brd.editor.placeholder')} onChange={(html) => patchSection(s.key, { html })} />
                                {content.language === 'both' && (
                                  <RichTextField value={s.html_ar ?? ''} dir="rtl" readOnly={readOnly} max={LIMITS.sectionChars}
                                    label={SECTION_TITLES[s.key].ar} placeholder={t('brd.editor.placeholderAr')} onChange={(html) => patchSection(s.key, { html_ar: html })} />
                                )}
                                {s.key === 'functional' && (
                                  <RequirementsTable rows={content.requirements} bilingual={content.language === 'both'} readOnly={readOnly} dir={dir}
                                    onChange={(rows) => change({ ...content, requirements: rows })} />
                                )}
                              </>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                  return s.key === 'change_log' ? <div key={s.key}>{card(null)}</div> : <SortableSection key={s.key} id={s.key}>{card}</SortableSection>;
                })}
              </div>
            </SortableContext>
          </DndContext>
        </TabsContent>

        <TabsContent value="versions" className="mt-4">
          <BrdVersionsPanel state={state} canWrite={canWrite} isAdmin={isAdmin} onChanged={refresh}
            onAttach={(v) => setAttachOpen(v)}
            onRestored={(c, r) => { dirty.current = false; setContent(c); setRev(r); setSave('saved'); refresh(); setTab('document'); }} />
        </TabsContent>

        <TabsContent value="shared" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">{t('brd.attach.listIntro')}</p>
          <BrdAttachments ticketId={ticket.id} rows={state.attachments ?? []} canWrite={canWrite} onChanged={refresh} />
        </TabsContent>

        <TabsContent value="comments" className="mt-4 space-y-4">
          {(state.comments ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t('brd.comments.none')}</p> : (
            Array.from(new Set((state.comments ?? []).map((c) => `${c.version}|${c.section_key}`))).map((k) => {
              const [v, sec] = k.split('|');
              return (
                <div key={k} className="space-y-1">
                  <p className="text-xs font-semibold">v{v} · {sec === 'general' ? t('brd.comments.general') : SECTION_TITLES[sec as SectionKey]?.[uiLang] ?? sec}</p>
                  <BrdComments ticketId={ticket.id} version={Number(v)} section={sec} comments={state.comments ?? []} canSuggest={false} canDecide={canWrite}
                    onChanged={refresh} onAcceptSuggestion={(c) => setSuggestion(c)} dir={dir} />
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="access" className="mt-4">
          <BrdAccessLog rows={state.access_log ?? []} />
        </TabsContent>
      </Tabs>

      {/* dialogs */}
      {ai && (
        <SectionAiDialog open onOpenChange={(o) => !o && setAi(null)} ticketId={ticket.id} content={content} section={ai.section} mode={ai.mode} deep={ai.deep} include={include}
          onAccept={(p) => {
            const next = { ...content, sections: content.sections.map((s) => (s.key === ai.section ? { ...s, html: p.html, ...(p.html_ar !== undefined ? { html_ar: p.html_ar } : {}) } : s)) };
            change(p.requirements && ai.section === 'functional' ? { ...next, requirements: p.requirements } : next);
          }} />
      )}
      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('brd.versions.saveTitle', { v: latestVersion + 1 })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="brd-note">{t('brd.versions.note')}</Label>
              <Textarea id="brd-note" value={note} maxLength={LIMITS.note} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={t('brd.versions.notePh')} /></div>
            <RadioGroup value={vStatus} onValueChange={(v) => setVStatus(v as 'draft' | 'final')} className="space-y-1">
              <div className="flex items-center gap-2"><RadioGroupItem id="brd-vs-d" value="draft" /><Label htmlFor="brd-vs-d" className="font-normal">{t('brd.versions.asDraft')}</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem id="brd-vs-f" value="final" /><Label htmlFor="brd-vs-f" className="font-normal">{t('brd.versions.asFinal')}</Label></div>
            </RadioGroup>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setVersionOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={doSaveVersion}>{t('brd.versions.saveNew')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BrdAttachDialog open={attachOpen !== false} onOpenChange={(o) => !o && setAttachOpen(false)} state={state} initialVersion={attachOpen || null} onDone={refresh} />
      <Dialog open={!!pendingDraft} onOpenChange={(o) => !o && setPendingDraft(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('brd.questions.reviewTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('brd.questions.reviewHint')}</p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setPendingDraft(null)}>{t('brd.ai.reject')}</Button>
            <Button onClick={() => {
              const d = pendingDraft!;
              change({ ...d, control: content.control, sections: content.sections.map((s) => {
                const n = d.sections.find((x) => x.key === s.key);
                return n && n.html ? { ...s, html: n.html, ...(n.html_ar !== undefined ? { html_ar: n.html_ar } : {}) } : s;
              }), requirements: d.requirements.length ? d.requirements : content.requirements, questions: d.questions });
              setPendingDraft(null);
            }}>{t('brd.ai.accept')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!suggestion} onOpenChange={(o) => !o && setSuggestion(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('brd.comments.acceptTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('brd.comments.acceptHint')}</p>
          <blockquote dir={dir} className="border-s-2 border-accent ps-2 text-sm whitespace-pre-wrap">{suggestion?.suggested_text}</blockquote>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSuggestion(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button disabled={readOnly} onClick={async () => {
              const c = suggestion!;
              const key = c.section_key as SectionKey;
              const cur = content.sections.find((s) => s.key === key);
              if (cur) patchSection(key, { html: `${cur.html}${textToHtml(c.suggested_text ?? '')}` });
              const { setBrdCommentStatus } = await import('@/lib/brd/api');
              await setBrdCommentStatus(c.id, 'accepted');
              setSuggestion(null);
              toast.success(t('brd.comments.accepted'));
              refresh();
              setTab('document');
            }}>{t('brd.comments.addToDraft')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
