import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, CheckCircle2, Coins, FileText, Gift, Hourglass, ShieldAlert, Sparkles, Undo2, UserPlus, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { cleanNoticeText, noticePreview, stripTestPrefix } from '@/lib/noticeText';
import NoticeTextBlocks from '@/components/notifications/NoticeTextBlocks';
import { referralNoticeView, type NoticeLike, type ReferralNoticeKind, type ReferralNoticeTone, type ReferralNoticeView } from '@/lib/referralNotice';

/** Colour family per tone: violet-teal gift for invitations, green earned, amber held / pending, red reversed / rejected. */
const TILE: Record<ReferralNoticeTone, string> = {
  invite: 'bg-gradient-to-br from-refer-from to-refer-to text-refer-foreground',
  earned: 'bg-success text-success-foreground',
  pending: 'bg-warning text-warning-foreground',
  negative: 'bg-destructive text-destructive-foreground',
};
const PILL: Record<ReferralNoticeTone, string> = {
  invite: 'border-refer-from/30 bg-refer-from/10 text-foreground',
  earned: 'border-success/30 bg-success/10 text-foreground',
  pending: 'border-warning/40 bg-warning/15 text-foreground',
  negative: 'border-destructive/30 bg-destructive/10 text-foreground',
};
const ICON: Record<ReferralNoticeKind, typeof Gift> = {
  invitation: Gift, registered: UserPlus, invited: Gift, interview_passed: BadgeCheck, activated: Sparkles, verified: CheckCircle2,
  reminder: Hourglass, ack_request: FileText, expired: XCircle, reward_earned: Coins, reward_held: Hourglass, reward_available: Coins,
  reward_paid: CheckCircle2, reward_reversed: Undo2, referral_rejected: XCircle, bank_changed: ShieldAlert, statement: FileText, generic: Gift,
};

/** English titles = the database titles (defaults); Arabic comes from ar.json (refn.k.*). */
const TITLE_EN: Record<ReferralNoticeKind, string> = {
  invitation: 'You are invited to Refer & earn', registered: 'A colleague joined with your code', invited: 'You were invited to AI Support 360',
  interview_passed: 'AI interview passed', activated: 'Your referral is active', verified: 'Your referral is verified',
  reminder: 'Your referral is still pending', ack_request: 'Please accept the referral terms', expired: 'Your referral has expired',
  reward_earned: 'Referral reward earned', reward_held: 'Referral reward on hold', reward_available: 'Referral reward available',
  reward_paid: 'Referral reward paid', reward_reversed: 'Referral reward reversed', referral_rejected: 'Referral not accepted',
  bank_changed: 'Your bank details were changed', statement: 'Your referral statement is ready', generic: 'Refer & earn',
};
const BODY_EN: Partial<Record<ReferralNoticeKind, string>> = {
  invitation: 'Share your code with SAP colleagues. Rewards depend on approved, paid work - no guaranteed income.',
};
const ACTION_EN = { open: 'Open Refer & earn', view_earning: 'View earning', view_referral: 'View referral' } as const;

export function useReferralNoticeText(n: NoticeLike, v: ReferralNoticeView) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const stored = stripTestPrefix(n.title);
  const title = v.kind === 'generic' ? stored : t(`refn.k.${v.kind}`, TITLE_EN[v.kind]);
  // English: the stored text (it has the masked name and the amount). Arabic: the translated line for the event.
  // Cleaned: no empty greeting gap ("Hello ,"), no unknown placeholders, no stray trailing ";".
  const body = cleanNoticeText(!ar || v.kind === 'generic'
    ? (n.body || BODY_EN[v.kind] || '')
    : t(`refn.b.${v.kind}`, n.body || ''));
  return { title, body, action: t(`refn.a.${v.action}`, ACTION_EN[v.action]) };
}

export function ReferralNoticeIcon({ view, className }: { view: ReferralNoticeView; className?: string }) {
  const Icon = ICON[view.kind];
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm', TILE[view.tone], className)} aria-hidden>
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** Title, one line, amount pill and the single action for one referral notice (bell and notifications page). */
export function ReferralNoticeContent({ n, compact = false, unread, onOpen }: { n: NoticeLike; compact?: boolean; unread?: boolean; onOpen?: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const v = referralNoticeView(n);
  const text = useReferralNoticeText(n, v);
  const go = (e: MouseEvent) => { e.stopPropagation(); onOpen?.(); navigate(v.link); };
  return (
    <div className="min-w-0 flex-1" data-referral-kind={v.kind} data-tone={v.tone}>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className={cn('text-sm', unread && 'font-semibold', compact && 'truncate')}>{text.title}</p>
        {v.test && <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">{t('refn.test', 'Test')}</span>}
      </div>
      {text.body && (compact
        ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{noticePreview(text.body)}</p>
        : <NoticeTextBlocks text={text.body} className="mt-1 text-xs" />)}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {v.amount && (
          <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums', PILL[v.tone])} dir="ltr">
            {v.kind === 'reward_reversed' ? '−' : ''}{v.amount.amount} {v.amount.currency}
          </span>
        )}
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-lg px-2.5 text-xs" onClick={go}>
          {text.action}<ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
