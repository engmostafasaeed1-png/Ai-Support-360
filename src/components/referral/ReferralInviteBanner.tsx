import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useGuardVersion } from '@/hooks/useNoticeQueue';
import { markNotificationsRead, REFERRAL_UNREAD_KEY, useUnreadReferralNotices, type ReferralNote } from '@/hooks/useReferralNotices';
import { acknowledgeInBackground, isDismissed, markDismissed, markShown, wasShown } from '@/lib/noticeGuard';
import { noticeDisplay } from '@/lib/noticeModalConfig';
import { noticePreview } from '@/lib/noticeText';
import { referralNoticeKind, referralNoticeView } from '@/lib/referralNotice';
import { ReferralNoticeIcon, useReferralNoticeText } from '@/components/notifications/ReferralNotice';

/**
 * One-time banner for routine Refer & earn notices that noticeModalConfig allows as a banner (the invitation): shown once
 * per notice per device, never blocking. The bell keeps the notice as a normal card; "Open Refer & earn" also marks it read.
 */
export default function ReferralInviteBanner() {
  const { isGuest } = useGuestMode();
  const { signedIn } = useSessionReady();
  const notes = useUnreadReferralNotices(signedIn && !isGuest);
  const guard = useGuardVersion();
  const [shownId, setShownId] = useState<string | null>(null);

  const candidate = useMemo(
    () => (notes.data ?? []).find((n) => noticeDisplay('referral', referralNoticeKind(n)) === 'banner' && !wasShown('referral-banner', n.id)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes.data, guard],
  );
  useEffect(() => {
    if (shownId || !candidate) return;
    markShown('referral-banner', [candidate.id]);
    setShownId(candidate.id);
  }, [candidate, shownId]);

  const note = shownId ? (notes.data ?? []).find((n) => n.id === shownId) ?? null : null;
  if (!note || isDismissed('referral-banner', note.id)) return null;
  return <Banner note={note} onHide={() => { markDismissed('referral-banner', [note.id], false); setShownId(null); }} />;
}

function Banner({ note, onHide }: { note: ReferralNote; onHide: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const view = referralNoticeView(note);
  const text = useReferralNoticeText(note, view);
  const open = () => {
    onHide();
    markDismissed('referral', [note.id]);
    acknowledgeInBackground('referral', [note.id], markNotificationsRead);
    qc.setQueryData<ReferralNote[]>(REFERRAL_UNREAD_KEY, (old) => (old ?? []).filter((n) => n.id !== note.id));
    qc.invalidateQueries({ queryKey: ['notifications'] });
    navigate(view.link);
  };
  return (
    <aside role="status" aria-label={text.title} data-testid="referral-invite-banner"
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-refer-from/30 bg-refer-from/5 p-3 shadow-sm sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ReferralNoticeIcon view={view} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {text.title}
            {view.test && <span className="rounded-full border border-border px-1.5 text-[10px] font-normal text-muted-foreground">{t('refn.test', 'Test')}</span>}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{noticePreview(text.body, { max: 180 })}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        <Button size="sm" className="gap-1" onClick={open}>{text.action}<ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onHide} aria-label={t('notice.hide_banner', 'Hide this message')}><X className="h-4 w-4" /></Button>
      </div>
    </aside>
  );
}
