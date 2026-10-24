import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { approvalErrorKey, decisionProblem, NOTE_MAX, type Decision } from '@/lib/brdApproval';
import { decideBrdApproval } from '@/lib/brd/approvalApi';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ticketId: string;
  version: number;
  decision: Decision;
  onDone: () => void;
}

/** Approve (with the "I have read it" tick), request changes (comment required) or decline (reason required). */
export default function BrdDecisionDialog({ open, onOpenChange, ticketId, version, decision, onDone }: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setNote(''); setConfirm(false); setTouched(false); } }, [open, decision]);
  const problem = decisionProblem(decision, note, confirm);

  const go = async () => {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    const r = await decideBrdApproval(ticketId, version, decision, note.trim(), decision === 'approved' && confirm);
    setBusy(false);
    if (r.error) {
      const key = approvalErrorKey(r.error.message);
      toast.error(t(key, { v: version }));
      if (key.endsWith('brd_approval_superseded') || key.endsWith('brd_approval_not_open')) { onOpenChange(false); onDone(); }
      return;
    }
    toast.success(t(`brd.approval.done.${decision}`, { v: version }));
    onOpenChange(false);
    onDone();
  };

  const noteId = 'brd-decision-note';
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`brd.approval.dialog.title_${decision}`, { v: version })}</DialogTitle>
          <DialogDescription>{t(`brd.approval.dialog.intro_${decision}`, { v: version })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={noteId}>{t(decision === 'approved' ? 'brd.approval.dialog.noteOptional' : decision === 'declined' ? 'brd.approval.dialog.reason' : 'brd.approval.dialog.comment')}</Label>
            <Textarea id={noteId} value={note} maxLength={NOTE_MAX} rows={5} onChange={(e) => setNote(e.target.value)}
              aria-invalid={touched && (problem === 'note_required' || problem === 'contact_details' || problem === 'note_too_long')}
              aria-describedby={`${noteId}-help`} />
            <p id={`${noteId}-help`} className="text-xs text-muted-foreground">
              {decision === 'changes_requested' ? t('brd.approval.dialog.commentHelp') : decision === 'declined' ? t('brd.approval.dialog.reasonHelp') : t('brd.approval.dialog.noteHelp')}
              {' '}{t('brd.approval.dialog.visible')}
            </p>
          </div>
          {decision === 'approved' && (
            <div className="flex items-start gap-2 rounded-xl border border-border p-3">
              <Checkbox id="brd-confirm-read" checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} aria-invalid={touched && problem === 'confirm_read'} />
              <Label htmlFor="brd-confirm-read" className="text-sm font-normal leading-snug">{t('brd.approval.dialog.confirmRead', { v: version })}</Label>
            </div>
          )}
          {touched && problem && <p className="text-sm text-destructive" role="alert">{t(`brd.approval.problem.${problem}`, { min: 10, max: NOTE_MAX })}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button disabled={busy} onClick={go} variant={decision === 'declined' ? 'destructive' : 'default'} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t(`brd.approval.action.${decision}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
