import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Timer } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSessionReady } from '@/hooks/useSessionReady';
import { ackResponsivenessNotice, useResponsivenessNotices, type ResponsivenessNotice } from '@/hooks/useResponsiveness';
import { noticeCopy } from '../../../supabase/functions/_shared/responsivenessCopy';

/**
 * Feature M popup: shown on any consultant page (and again at the next sign-in) until the consultant acknowledges it,
 * one notice at a time. Radix Dialog gives the focus trap, Escape and the dialog role; the text is also announced politely.
 */
export default function ResponsivenessNoticePopup() {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const { signedIn } = useSessionReady();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useResponsivenessNotices(signedIn);
  const [current, setCurrent] = useState<ResponsivenessNotice | null>(null);

  useEffect(() => {
    if (!current && data && data.length) setCurrent(data[0]);
  }, [data, current]);

  if (!current) return null;
  const copy = noticeCopy({ lang, kind: current.kind, count30: current.count_30d, warningsTotal: current.warnings_total });
  const good = current.kind === 'not_counted' || current.kind === 'dispute_upheld';

  const done = async (to?: string) => {
    const id = current.id;
    setCurrent(null);
    await ackResponsivenessNotice(id);
    qc.setQueryData<ResponsivenessNotice[]>(['responsiveness-notices'], (old) => (old ?? []).filter((n) => n.id !== id));
    if (to) navigate(to);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void done(); }}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()} data-testid="responsiveness-popup">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {good
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              : <AlertTriangle className="h-5 w-5 shrink-0 text-warning motion-safe:animate-pulse" aria-hidden="true" />}
            <DialogTitle>{copy.title}</DialogTitle>
          </div>
          <DialogDescription aria-live="polite">{copy.body}</DialogDescription>
        </DialogHeader>
        <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('responsiveness.popup_improve', 'Accept or decline every request within the time limit (a decline counts as a response), keep your availability up to date and mark vacations in advance.')}
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          {copy.showDispute && (
            <Button variant="outline" onClick={() => void done(`/consultant/responsiveness?event=${current.event_id}&dispute=1`)}>
              {t('responsiveness.popup_dispute', 'Dispute')}
            </Button>
          )}
          <Button variant="outline" onClick={() => void done(`/consultant/responsiveness?event=${current.event_id}`)}>
            {t('responsiveness.popup_open', 'My responsiveness')}
          </Button>
          <Button onClick={() => void done()} autoFocus>{t('responsiveness.popup_ok', 'Understood')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
