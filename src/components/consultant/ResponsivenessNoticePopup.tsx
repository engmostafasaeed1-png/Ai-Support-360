import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSessionReady } from '@/hooks/useSessionReady';
import {
  ackResponsivenessNotice, RESPONSIVENESS_NOTICES_KEY, useResponsivenessNotices, type ResponsivenessNotice,
} from '@/hooks/useResponsiveness';
import { useNoticeQueue } from '@/hooks/useNoticeQueue';
import { acknowledgeInBackground, isDismissed, markDismissed } from '@/lib/noticeGuard';
import { noticeDisplay } from '@/lib/noticeModalConfig';
import NoticeModal from '@/components/notifications/NoticeModal';
import { noticeCopy } from '../../../supabase/functions/_shared/responsivenessCopy';

const ack = async (ids: string[]) => { for (const id of ids) await ackResponsivenessNotice(id); };

/**
 * Feature M pop-up for notices that change the consultant's statistics (counted no-response, friendly notices, indicator
 * shown, dispute result) - the kinds listed in noticeModalConfig. "Not counted" notices are informational: the bell has
 * the line, so they are acknowledged quietly. Shared notice queue: one at a time with "1 of N", optimistic close with a
 * silent background acknowledgement, at most once per notice per device, never again after closing (tabs, reload, focus).
 */
export default function ResponsivenessNoticePopup() {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const { signedIn } = useSessionReady();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useResponsivenessNotices(signedIn);
  const items = useMemo(() => data ?? [], [data]);

  // Informational notices: no pop-up, acknowledged quietly once.
  useEffect(() => {
    const quiet = items.filter((n) => noticeDisplay('responsiveness', n.kind) !== 'modal' && !isDismissed('responsiveness', n.id)).map((n) => n.id);
    if (!quiet.length) return;
    markDismissed('responsiveness', quiet);
    acknowledgeInBackground('responsiveness', quiet, ack);
  }, [items]);

  const q = useNoticeQueue<ResponsivenessNotice>({
    family: 'responsiveness', items, enabled: signedIn, idOf: (n) => n.id, kindOf: (n) => n.kind, ack,
  });
  const current = q.current;
  if (!current) return null;
  const copy = noticeCopy({ lang, kind: current.kind, count30: current.count_30d, warningsTotal: current.warnings_total });
  const good = current.kind === 'dispute_upheld';
  const drop = (ids: string[]) => qc.setQueryData<ResponsivenessNotice[]>(RESPONSIVENESS_NOTICES_KEY, (old) => (old ?? []).filter((n) => !ids.includes(n.id)));
  const close = () => { q.dismiss(); drop([current.id]); };
  const go = (to: string) => { close(); navigate(to); };

  return (
    <NoticeModal
      testId="responsiveness-popup"
      icon={good
        ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        : <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />}
      title={copy.title}
      description={<span aria-live="polite">{copy.body}</span>}
      position={q.position} total={q.total}
      onClose={close}
      onDismissAll={() => { q.dismissAll(); qc.invalidateQueries({ queryKey: RESPONSIVENESS_NOTICES_KEY }); }}
      closeLabel={t('responsiveness.popup_ok', 'Understood')}
      dismissAllLabel={t('responsiveness.popup_ok_all', 'Understood, dismiss all')}
      extra={<>
        {copy.showDispute && (
          <Button variant="outline" onClick={() => go(`/consultant/responsiveness?event=${current.event_id}&dispute=1`)}>{t('responsiveness.popup_dispute', 'Dispute')}</Button>
        )}
        <Button variant="outline" onClick={() => go(`/consultant/responsiveness?event=${current.event_id}`)}>{t('responsiveness.popup_open', 'My responsiveness')}</Button>
      </>}
    >
      <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('responsiveness.popup_improve', 'Accept or decline every request within the time limit (a decline counts as a response), keep your availability up to date and mark vacations in advance.')}
      </p>
    </NoticeModal>
  );
}
