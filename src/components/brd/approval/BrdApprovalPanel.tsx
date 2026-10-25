import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ChevronDown, FileDown, History, Loader2, PencilLine, Send, ShieldCheck, ShieldOff, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/formatters';
import { useBrdApproval, useRefreshBrdApproval } from '@/hooks/useBrdApproval';
import { adminWaiveBrdApproval, submitBrdForApproval, withdrawBrdApproval } from '@/lib/brd/approvalApi';
import { getBrdVersion, type BrdState } from '@/lib/brd/api';
import { approvalErrorKey, currentRound, lastApprovedBefore, shortHash, type ApprovalRound, type Decision } from '@/lib/brdApproval';
import { brdPdfBlob } from '@/lib/brd/pdf';
import { diffContents } from '../../../../supabase/functions/_shared/brdDiff';
import { normalizeContent } from '../../../../supabase/functions/_shared/brdModel';
import BrdDiffView from '../BrdDiffView';
import { BrdApprovalChip } from './BrdApprovalChip';
import BrdDecisionDialog from './BrdDecisionDialog';

/**
 * Consultant approval of the BRD (docs/sql/ticket-brd-approval.sql): state, who must approve, the consultant's
 * decision bar with "what changed since the version you approved", client submit / withdraw, admin waiver, history
 * and the approval record PDF. Nothing while the feature is not installed or approval is off.
 */
export default function BrdApprovalPanel({ ticketId, state }: { ticketId: string; state: BrdState }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { data } = useBrdApproval(ticketId);
  const refresh = useRefreshBrdApproval(ticketId);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  if (!data?.role || !data.gate || !data.me || data.settings?.mode === 'off') return null;
  const g = data.gate;
  const me = data.me;
  const rounds = data.rounds ?? [];
  const cur = currentRound(rounds);
  const open = cur && !cur.closed_at ? cur : null;
  const shared = state.brd?.shared_version ?? null;
  const canAsk = me.can_submit && !!shared && (!open || open.version !== shared);
  const approvedRound = rounds.find((r) => r.approved_at && r.version === g.approved_version) ?? null;

  const exportRecord = async () => {
    if (!approvedRound) return;
    setExporting(true);
    try {
      const v = await getBrdVersion(ticketId, approvedRound.version);
      if (v.error || !v.data) throw new Error('load');
      const record = rounds.filter((r) => r.version <= approvedRound.version).flatMap((r) => r.decisions.map((d) => ({
        version: r.version, who: d.who, role: d.role, decision: d.decision, at: d.at, note: d.note ?? '', hash: d.hash,
      }))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const blob = await brdPdfBlob(normalizeContent(v.data.content), {
        ticketRef: state.ticket!.ref, ticketTitle: state.ticket!.title, version: approvedRound.version,
        versions: (state.versions ?? []).filter((x) => x.version <= approvedRound.version), approvalRecord: record,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `BRD_${state.ticket!.ref}_v${approvedRound.version}_approval_record.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch {
      toast.error(t('brd.export.failed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="rounded-2xl border-border/50" data-testid="brd-approval-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> {t('brd.approval.title')}
          {g.state !== 'not_requested' && <BrdApprovalChip state={g.state} version={g.version} />}
          <Badge variant="outline" className="text-[10px]">{t(`brd.approval.mode.${g.mode}`)}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t(`brd.approval.modeHint.${g.mode}`)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {g.blocks && (
          <div className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm" role="status">
            <p className="font-medium text-foreground">{t('brd.approval.blocker')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t(g.state === 'pending' ? 'brd.approval.blockerPending' : 'brd.approval.blockerUpdate', { v: g.version })}</p>
          </div>
        )}
        {data.waiver?.active && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-xs">
            <p className="font-medium text-foreground">{t('brd.approval.waived')}</p>
            {data.waiver.reason && <p className="mt-1 text-muted-foreground">{t('brd.approval.waivedReason', { reason: data.waiver.reason, who: data.waiver.by ?? '' })}</p>}
          </div>
        )}
        {g.state === 'not_requested' && <p className="text-sm text-muted-foreground">{t('brd.approval.none')}</p>}
        {g.state === 'withdrawn' && <p className="text-sm text-muted-foreground">{t('brd.approval.withdrawnNote')}</p>}

        {open && (data.required ?? []).length > 0 && (
          <section aria-labelledby="brd-appr-who" className="space-y-1.5">
            <h3 id="brd-appr-who" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('brd.approval.who', { v: open.version })}</h3>
            <ul className="space-y-1">
              {(data.required ?? []).map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{r.who}</span>
                  <Badge variant="secondary" className="text-[10px]">{t(`brd.approval.role.${r.role}`)}</Badge>
                  {r.decision ? <BrdApprovalChip state={r.decision === 'declined' ? 'rejected' : r.decision} prefix={false} />
                    : <span className="text-xs text-muted-foreground">{r.can_read ? t('brd.approval.waiting') : t('brd.approval.noAccessYet')}</span>}
                </li>
              ))}
            </ul>
            {open.due_at && !open.approved_at && <p className="text-xs text-muted-foreground">{t('brd.approval.due', { date: formatDateTime(open.due_at, lang) })}</p>}
            {open.submit_note && <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs whitespace-pre-wrap">{t('brd.approval.clientNote')}: {open.submit_note}</p>}
          </section>
        )}

        {me.can_decide && open && (
          <ConsultantDecisionBar ticketId={ticketId} round={open} rounds={rounds} onPick={setDecision} lang={lang} />
        )}
        {me.is_approver && me.decision && open && (
          <p className="text-sm text-muted-foreground">{t('brd.approval.youDecided', { v: open.version, decision: t(`brd.approval.decision.${me.decision}`) })}</p>
        )}

        {(me.can_submit || me.can_waive) && (
          <div className="flex flex-wrap gap-2">
            {canAsk && (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAskOpen(true)}><Send className="h-3.5 w-3.5" /> {t('brd.approval.ask', { v: shared })}</Button>
            )}
            {me.can_submit && open && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setWithdrawOpen(true)}><Ban className="h-3.5 w-3.5" /> {t('brd.approval.withdraw')}</Button>
            )}
            {me.can_waive && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setWaiveOpen(true)}>
                <ShieldOff className="h-3.5 w-3.5" /> {data.waiver?.active ? t('brd.approval.revokeWaiver') : t('brd.approval.waive')}
              </Button>
            )}
          </div>
        )}
        {me.can_submit && open && (open.state === 'changes_requested' || open.state === 'rejected') && (
          <p className="text-xs text-muted-foreground">{t(open.state === 'rejected' ? 'brd.approval.nextRejected' : 'brd.approval.nextChanges')}</p>
        )}

        {approvedRound && (
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-xs" onClick={exportRecord} busy={exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} {t('brd.approval.record', { v: approvedRound.version })}
          </Button>
        )}

        {rounds.length > 0 && (
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs"><History className="h-3.5 w-3.5" /> {t('brd.approval.history', { count: rounds.length })}<ChevronDown className="h-3 w-3" /></Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ol className="space-y-2">
                {rounds.map((r) => <RoundItem key={r.id} r={r} lang={lang} />)}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      {decision && open && (
        <BrdDecisionDialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)} ticketId={ticketId} version={open.version} decision={decision} onDone={refresh} />
      )}
      {askOpen && shared && (
        <AskDialog ticketId={ticketId} version={shared} allowNoChange={!!data.settings?.allow_no_change && !!g.approved_at} onClose={() => setAskOpen(false)} onDone={refresh} />
      )}
      <ReasonDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} title={t('brd.approval.withdrawTitle')} intro={t('brd.approval.withdrawIntro')} min={0}
        confirm={t('brd.approval.withdraw')} onConfirm={async (reason) => {
          const r = await withdrawBrdApproval(ticketId, reason || null);
          if (r.error) { toast.error(t(approvalErrorKey(r.error.message))); return false; }
          toast.success(t('brd.approval.withdrawn')); refresh(); return true;
        }} />
      <ReasonDialog open={waiveOpen} onOpenChange={setWaiveOpen} min={5}
        title={data.waiver?.active ? t('brd.approval.revokeWaiver') : t('brd.approval.waive')} intro={t(data.waiver?.active ? 'brd.approval.revokeIntro' : 'brd.approval.waiveIntro')}
        confirm={data.waiver?.active ? t('brd.approval.revokeWaiver') : t('brd.approval.waive')} onConfirm={async (reason) => {
          const r = await adminWaiveBrdApproval(ticketId, !data.waiver?.active, reason);
          if (r.error) { toast.error(t(approvalErrorKey(r.error.message))); return false; }
          toast.success(t('brd.admin.saved')); refresh(); return true;
        }} />
    </Card>
  );
}

function ConsultantDecisionBar({ ticketId, round, rounds, onPick, lang }: { ticketId: string; round: ApprovalRound; rounds: ApprovalRound[]; onPick: (d: Decision) => void; lang: string }) {
  const { t } = useTranslation();
  const prev = lastApprovedBefore(rounds, round.version);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffs, setDiffs] = useState<ReturnType<typeof diffContents> | null>(null);
  useEffect(() => {
    if (!diffOpen || !prev || diffs) return;
    let live = true;
    void Promise.all([getBrdVersion(ticketId, prev.version), getBrdVersion(ticketId, round.version)]).then(([a, b]) => {
      if (!live) return;
      if (!a.data || !b.data) { setDiffs([]); return; }
      setDiffs(diffContents(normalizeContent(a.data.content), normalizeContent(b.data.content), lang === 'ar' ? 'ar' : 'en'));
    });
    return () => { live = false; };
  }, [diffOpen, prev, diffs, ticketId, round.version, lang]);
  return (
    <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3" aria-labelledby="brd-appr-decide">
      <h3 id="brd-appr-decide" className="text-sm font-semibold text-foreground">{t('brd.approval.decideTitle', { v: round.version })}</h3>
      <p className="text-xs text-muted-foreground">{t('brd.approval.decideIntro', { hash: shortHash(round.hash) })}</p>
      {prev && (
        <Collapsible open={diffOpen} onOpenChange={setDiffOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">{t('brd.approval.changedSince', { v: prev.version })}<ChevronDown className="h-3 w-3" /></Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {!diffs ? <p className="flex items-center gap-2 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('brd.loading')}</p>
              : <BrdDiffView diffs={diffs} dir={lang === 'ar' ? 'rtl' : 'ltr'} />}
          </CollapsibleContent>
        </Collapsible>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-9 gap-1.5" onClick={() => onPick('approved')}><CheckCircle2 className="h-4 w-4" /> {t('brd.approval.action.approved')}</Button>
        <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onPick('changes_requested')}><PencilLine className="h-4 w-4" /> {t('brd.approval.action.changes_requested')}</Button>
        <Button size="sm" variant="outline" className="h-9 gap-1.5 text-destructive" onClick={() => onPick('declined')}><XCircle className="h-4 w-4" /> {t('brd.approval.action.declined')}</Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('brd.approval.commentTip')}</p>
    </section>
  );
}

function RoundItem({ r, lang }: { r: ApprovalRound; lang: 'en' | 'ar' }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-xl border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <BrdApprovalChip state={r.state} version={r.version} />
        {r.no_material_change && <Badge variant="outline" className="text-[10px]">{t('brd.approval.noChangeBadge', { v: r.previous_version })}</Badge>}
        <span className="text-muted-foreground">{t('brd.approval.submittedBy', { who: r.submitted_by, when: formatDateTime(r.submitted_at, lang) })}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">{t('brd.approval.hash')}: {shortHash(r.hash)}</p>
      {r.decisions.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {r.decisions.map((d, i) => (
            <li key={i}>
              <span className="font-medium text-foreground">{d.who}</span> ({t(`brd.approval.role.${d.role}`)}) · {t(`brd.approval.decision.${d.decision}`)} · {formatDateTime(d.at, lang)}
              {d.note && <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-muted/50 px-2 py-1 text-foreground">{d.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {r.closed_at && <p className="mt-1 text-muted-foreground">{t(`brd.approval.closed.${r.closed_reason}`, { when: formatDateTime(r.closed_at, lang) })}{r.close_note && r.close_note !== 'unattached' ? ` · ${r.close_note}` : ''}</p>}
    </li>
  );
}

function AskDialog({ ticketId, version, allowNoChange, onClose, onDone }: { ticketId: string; version: number; allowNoChange: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [noChange, setNoChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await submitBrdForApproval(ticketId, version, noChange, note.trim() || null);
    setBusy(false);
    if (r.error || !r.data) { toast.error(t(approvalErrorKey(r.error?.message))); return; }
    toast.success(r.data.carried ? t('brd.approval.carried', { v: version }) : t('brd.approval.asked', { v: version, count: r.data.notified }));
    if (r.data.waiting_access > 0) toast.info(t('brd.approval.waitingAccess', { count: r.data.waiting_access }));
    onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('brd.approval.askTitle', { v: version })}</DialogTitle>
          <DialogDescription>{t('brd.approval.askIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="brd-ask-note">{t('brd.approval.askNote')}</Label>
            <Textarea id="brd-ask-note" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
          </div>
          {allowNoChange && (
            <div className="flex items-start gap-2">
              <Checkbox id="brd-no-change" checked={noChange} onCheckedChange={(v) => setNoChange(v === true)} />
              <Label htmlFor="brd-no-change" className="text-sm font-normal leading-snug">{t('brd.approval.noChange')}</Label>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" busy={busy} onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button busy={busy} onClick={go} className="gap-1.5">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('brd.approval.askConfirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ open, onOpenChange, title, intro, confirm, min, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; intro: string; confirm: string; min: number; onConfirm: (reason: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  const ok = reason.trim().length >= min;
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{intro}</DialogDescription></DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="brd-appr-reason">{min > 0 ? t('brd.reason') : t('brd.reasonOptional')}</Label>
          <Textarea id="brd-appr-reason" value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" busy={busy} onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button busy={busy} disabled={!ok} onClick={async () => { setBusy(true); const done = await onConfirm(reason.trim()); setBusy(false); if (done) onOpenChange(false); }} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
