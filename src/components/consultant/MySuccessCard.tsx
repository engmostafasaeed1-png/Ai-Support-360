import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SuccessStatsView } from '@/components/consultant/SuccessStatsCard';
import { disputeSuccess, OUTCOME_LABEL, REASON_LABEL, useMySuccess, type SuccessEngagement } from '@/hooks/useSuccessAdmin';
import { successView } from '@/lib/successLevel';
import { cn } from '@/lib/utils';

/** The consultant's own requests + success numbers, each counted request, and "Ask for a review" for a "not solved". */
export default function MySuccessCard() {
  const { i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const qc = useQueryClient();
  const q = useMySuccess();
  const [target, setTarget] = useState<SuccessEngagement | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (q.isLoading || q.isError || !q.data) return null; // hidden until the success statistics are switched on

  const st = q.data.stats;
  const view = successView(true, st ? st : { requests_total: 0, solved: 0, not_solved: 0, requests_12m: 0, solved_12m: 0 }, q.data.settings);
  const pending = new Set(q.data.disputes.filter((d) => d.status === 'pending').map((d) => d.ticket_id));
  const counted = q.data.engagements.filter((e) => e.outcome === 'solved' || e.outcome === 'not_solved');

  const send = async () => {
    if (!target) return;
    const text = reason.trim();
    if (text.length < 10 || text.length > 500) { toast.error(ar ? 'يرجى كتابة 10 إلى 500 حرف.' : 'Please write 10 to 500 characters.'); return; }
    setBusy(true);
    try {
      await disputeSuccess(target.ticket_id, text);
      toast.success(ar ? 'تم إرسال طلب المراجعة. سيراجعه مسؤول.' : 'Review request sent. An administrator will look at it.');
      setTarget(null); setReason('');
      qc.invalidateQueries({ queryKey: ['my-success'] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card data-testid="my-success">
      <CardHeader className="pb-2"><CardTitle className="text-base">{ar ? 'الطلبات والنجاح' : 'Requests and success'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <SuccessStatsView view={view} lang={ar ? 'ar' : 'en'} />
        {counted.length > 0 && (
          <ul className="space-y-2">
            {counted.map((e) => (
              <li key={e.ticket_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium"><bdi>{e.title || '—'}</bdi></p>
                  <p className="text-xs text-muted-foreground">
                    <span className={cn(e.outcome === 'solved' ? 'text-success' : 'text-destructive')}>{OUTCOME_LABEL[e.outcome][ar ? 1 : 0]}</span>
                    {e.reason && REASON_LABEL[e.reason] ? ` · ${REASON_LABEL[e.reason][ar ? 1 : 0]}` : ''}
                  </p>
                </div>
                {pending.has(e.ticket_id)
                  ? <span className="text-xs text-muted-foreground">{ar ? 'قيد المراجعة' : 'Review requested'}</span>
                  : e.disputable && <Button size="sm" variant="outline" onClick={() => setTarget(e)}>{ar ? 'اطلب مراجعة' : 'Ask for a review'}</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? 'طلب مراجعة "لم يُحل"' : 'Ask for a review of "not solved"'}</DialogTitle>
            <DialogDescription>{ar ? 'اشرح لماذا يجب ألا يُحتسب هذا الطلب غير محلول. يمكن طلب المراجعة حتى 30 يومًا بعد انتهاء الطلب.' : 'Explain why this request should not count as not solved. You can ask up to 30 days after the request ended.'}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="success-dispute" className="text-xs">{ar ? 'السبب (10 إلى 500 حرف)' : 'Reason (10 to 500 characters)'}</Label>
          <Textarea id="success-dispute" rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={send} disabled={busy}>{ar ? 'إرسال' : 'Send'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
