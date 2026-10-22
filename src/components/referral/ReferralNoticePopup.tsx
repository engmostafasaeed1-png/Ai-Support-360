import { formatRate, rateRangeText } from '@/lib/referrals';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useInvalidateReferral, useMyReferralInvite } from '@/hooks/useReferralProgram';
import { markNotificationsRead, REFERRAL_UNREAD_KEY, useUnreadReferralNotices, type ReferralNote } from '@/hooks/useReferralNotices';
import { useNoticeQueue } from '@/hooks/useNoticeQueue';
import { referralNoticeKind, referralNoticeView } from '@/lib/referralNotice';
import { cn } from '@/lib/utils';
import ReferralAckPanel from '@/components/referral/ReferralAckPanel';
import NoticeModal from '@/components/notifications/NoticeModal';
import NoticeTextBlocks from '@/components/notifications/NoticeTextBlocks';
import { ReferralNoticeIcon, useReferralNoticeText } from '@/components/notifications/ReferralNotice';

type Item = { kind: 'note'; id: string; note: ReferralNote } | { kind: 'terms'; id: string };

const ack = (ids: string[]) => markNotificationsRead(ids);

/**
 * Pop-up for IMPORTANT Refer & earn notices only (see noticeModalConfig: reward reversed, referral not accepted, bank
 * details changed, terms to accept). Routine notices (invitation, registered, reward earned...) stay cards in the bell;
 * the invitation may also show a one-time banner (ReferralInviteBanner). Shared queue: one at a time, "1 of N",
 * optimistic close, at most once per notice per device.
 */
export default function ReferralNoticePopup() {
  const { isGuest } = useGuestMode();
  const { signedIn } = useSessionReady();
  const enabled = signedIn && !isGuest;
  const notes = useUnreadReferralNotices(enabled);
  const invite = useMyReferralInvite(enabled);
  const qc = useQueryClient();

  const needsAck = !!invite.data && invite.data.activation_status === 'pending' && !invite.data.i_acknowledged_at;
  const items = useMemo<Item[]>(() => [
    ...(needsAck && invite.data ? [{ kind: 'terms' as const, id: `terms-${invite.data.terms_version ?? 'current'}` }] : []),
    ...(notes.data ?? []).map((n) => ({ kind: 'note' as const, id: n.id, note: n })),
  ], [notes.data, needsAck, invite.data]);

  const q = useNoticeQueue<Item>({
    family: 'referral', items, enabled: enabled && !notes.isLoading && !invite.isLoading,
    idOf: (i) => i.id,
    kindOf: (i) => (i.kind === 'terms' ? 'terms_pending' : referralNoticeKind(i.note)),
    ack,
  });
  if (!q.current) return null;
  const refresh = () => {
    qc.setQueryData<ReferralNote[]>(REFERRAL_UNREAD_KEY, (old) => (old ?? []).filter((n) => n.id !== q.current?.id));
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const close = () => { q.dismiss(); refresh(); };
  const closeAll = () => { q.dismissAll(); qc.invalidateQueries({ queryKey: REFERRAL_UNREAD_KEY }); qc.invalidateQueries({ queryKey: ['notifications'] }); };

  return q.current.kind === 'terms'
    ? <TermsModal position={q.position} total={q.total} onClose={close} onDismissAll={closeAll} />
    : <NoteModal note={q.current.note} position={q.position} total={q.total} onClose={close} onDismissAll={closeAll} />;
}

function NoteModal({ note, position, total, onClose, onDismissAll }: { note: ReferralNote; position: number; total: number; onClose: () => void; onDismissAll: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const view = referralNoticeView(note);
  const text = useReferralNoticeText(note, view);
  return (
    <NoticeModal
      testId="referral-notice-popup"
      icon={<ReferralNoticeIcon view={view} />}
      title={<>{text.title}{view.test && <span className="ms-2 rounded-full border border-border px-1.5 align-middle text-[10px] font-normal text-muted-foreground">{t('refn.test', 'Test')}</span>}</>}
      position={position} total={total} onClose={onClose} onDismissAll={onDismissAll}
      primary={{ label: text.action, onClick: () => { onClose(); navigate(view.link); } }}
    >
      <NoticeTextBlocks text={text.body} />
      {view.amount && (
        <p className={cn('w-fit rounded-full border px-2.5 py-0.5 text-sm font-semibold tabular-nums', view.tone === 'negative' ? 'border-destructive/30 bg-destructive/10' : 'border-success/30 bg-success/10')} dir="ltr">
          {view.kind === 'reward_reversed' ? '−' : ''}{view.amount.amount} {view.amount.currency}
        </p>
      )}
    </NoticeModal>
  );
}

function TermsModal({ position, total, onClose, onDismissAll }: { position: number; total: number; onClose: () => void; onDismissAll: () => void }) {
  const { t } = useTranslation();
  const invite = useMyReferralInvite(true);
  const invalidate = useInvalidateReferral();
  const d = invite.data;
  if (!d) return null;
  return (
    <NoticeModal
      testId="referral-notice-popup"
      icon={<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-refer-from to-refer-to text-refer-foreground" aria-hidden><FileText className="h-4 w-4" /></span>}
      title={t('refn.k.ack_request', 'Please accept the referral terms')}
      position={position} total={total} onClose={onClose} onDismissAll={onDismissAll}
    >
      <p className="text-sm text-muted-foreground">
        {t('refz.signup_invited', 'You were invited by {{name}}. The referral programme becomes active after you and your referrer pass the AI interview.', { name: d.referrer_name })}
      </p>
      <ReferralAckPanel version={d.terms_version} rateText={d.tiers?.length ? rateRangeText(d.tiers) : formatRate(d.rate_percent)} months={d.months}
        passMark={d.pass_mark} source="popup" onDone={() => { invalidate(); onClose(); }} />
    </NoticeModal>
  );
}
