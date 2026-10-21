import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSuccessConfig } from '@/hooks/useSuccessStats';
import { setTicketOutcome } from '@/hooks/useSuccessAdmin';

/**
 * Client on a resolved/closed request: "Mark as not solved" (counts as not solved in the consultant's success
 * statistics; the consultant can ask an administrator for a review). Hidden until the success statistics exist.
 */
export default function TicketOutcomeControl({ ticketId, outcome, onChanged }: { ticketId: string; outcome?: string | null; onChanged?: () => void }) {
  const { i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const qc = useQueryClient();
  const cfg = useSuccessConfig();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null | undefined>(outcome);
  if (!cfg.available) return null;
  const marked = local === 'unresolved';

  const save = async (next: 'unresolved' | null) => {
    setBusy(true);
    try {
      await setTicketOutcome(ticketId, next, reason.trim() || undefined);
      setLocal(next); setOpen(false); setReason('');
      toast.success(next ? (ar ? 'تم التسجيل: لم يُحل.' : 'Recorded as not solved.') : (ar ? 'تم التراجع.' : 'Undone.'));
      qc.invalidateQueries({ queryKey: ['success-stat'] });
      onChanged?.();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (marked) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="ticket-outcome">
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">{ar ? 'سجّلتَ أن هذا الطلب لم يُحل' : 'You marked this request as not solved'}</span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => save(null)}>{ar ? 'تراجع' : 'Undo'}</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-xs" data-testid="ticket-outcome">
      {!open ? (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>{ar ? 'لم يُحل الطلب فعليًا؟' : 'Not actually solved?'}</Button>
      ) : (
        <>
          <p className="text-muted-foreground">{ar ? 'سيُحتسب هذا الطلب "غير محلول" في إحصاءات نجاح المستشار، ويمكنه طلب مراجعة من المسؤول.' : 'This request will count as "not solved" in the consultant\u2019s success statistics; the consultant can ask an administrator for a review.'}</p>
          <Textarea rows={2} maxLength={500} aria-label={ar ? 'السبب (اختياري)' : 'Reason (optional)'} placeholder={ar ? 'السبب (اختياري)' : 'Reason (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" variant="destructive" disabled={busy} onClick={() => save('unresolved')}>{ar ? 'سجّل: لم يُحل' : 'Mark as not solved'}</Button>
            <Button size="sm" className="h-7 text-xs" variant="ghost" onClick={() => setOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
          </div>
        </>
      )}
    </div>
  );
}
