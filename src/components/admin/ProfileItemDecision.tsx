import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import DecisionEmailNotice from '@/components/admin/DecisionEmailNotice';
import { safeRpc, isMissingRpc } from '@/lib/safeRpc';

export default function ProfileItemDecision({ consultantId, kind, itemId, label, onChanged }: {
  consultantId: string; kind: 'certificate' | 'linkedin' | 'credly' | 'document' | 'success_story'; itemId?: string; label: string; onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<'approved' | 'changes' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!outcome || busy) return;
    setBusy(true);
    const r = kind === 'success_story' ? await safeRpc('admin_achievement_review', { _id: itemId, _action: outcome === 'approved' ? 'verify' : 'hide', _reason: comment }) : await safeRpc('admin_profile_review_item', { _cid: consultantId, _kind: kind, _item: itemId ?? null, _outcome: outcome, _comment: comment });
    setBusy(false);
    if (r.error) { toast.error(isMissingRpc(r.error) ? t('profileReview.pending', 'Item review comments will work after the approved database update is applied.') : r.error.message); return; }
    toast.success(t('profileReview.saved', 'Decision saved.')); setOutcome(null); setComment(''); onChanged?.();
  };
  return <>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => { setComment(''); setOutcome('approved'); }}>{t('profileReview.approve', 'Approve')}</Button>
      <Button size="sm" variant="outline" onClick={() => { setComment(''); setOutcome('changes'); }}>{t('profileReview.changes', 'Needs changes')}</Button>
    </div>
    <Dialog open={!!outcome} onOpenChange={o => !o && setOutcome(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{t(outcome === 'approved' ? 'profileReview.approve' : 'profileReview.changes')}</DialogDescription></DialogHeader>
      <Textarea aria-label={t('profileReview.comment', 'Comment')} value={comment} maxLength={1000} onChange={e => setComment(e.target.value)} />
      {outcome && <DecisionEmailNotice consultantId={consultantId} subject={kind} outcomes={[outcome]} comment={comment} label={label} link="/consultant/profile" />}
      <DialogFooter><Button variant="ghost" onClick={() => setOutcome(null)} busy={busy}>{t('common.cancel', 'Cancel')}</Button><Button onClick={send} busy={busy}>{t('profileReview.save', 'Save decision')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}