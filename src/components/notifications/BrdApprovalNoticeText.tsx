import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { brdNoticeTicket, brdNoticeTone, brdNoticeVersion, isBrdApprovalNotice } from '@/lib/brdApprovalNotice';

const DOT: Record<ReturnType<typeof brdNoticeTone>, string> = {
  success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive', info: 'bg-info', primary: 'bg-primary',
};

/** Title (and, in Arabic, body) of a BRD approval notice in the reader's language, with a status-coloured dot. */
export function useNoticeText(n: { type?: string | null; title?: string | null; body?: string | null }) {
  const { t, i18n } = useTranslation();
  if (!isBrdApprovalNotice(n.type)) return { title: n.title ?? '', body: n.body ?? null, dot: null as string | null };
  const v = brdNoticeVersion(n.title);
  const ticket = brdNoticeTicket(n.body) ?? t('brd.approval.notice.yourTicket');
  const title = t(`brd.approval.notice.${n.type}`, { v: v ?? '', defaultValue: n.title ?? '' });
  const ar = i18n.language?.startsWith('ar');
  const body = ar ? t(`brd.approval.noticeBody.${n.type}`, { v: v ?? '', ticket, defaultValue: n.body ?? '' }) : (n.body ?? null);
  return { title, body, dot: DOT[brdNoticeTone(n.type)] };
}

export function NoticeDot({ className, color }: { className?: string; color: string | null }) {
  if (!color) return null;
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color, className)} aria-hidden />;
}

export function NoticeTitle({ n, className }: { n: { type?: string | null; title?: string | null; body?: string | null }; className?: string }) {
  const x = useNoticeText(n);
  return <span className={cn('inline-flex items-center gap-1.5', className)}><NoticeDot color={x.dot} />{x.title}</span>;
}

export function NoticeBody({ n, className }: { n: { type?: string | null; title?: string | null; body?: string | null }; className?: string }) {
  const x = useNoticeText(n);
  return x.body ? <p className={className}>{x.body}</p> : null;
}
