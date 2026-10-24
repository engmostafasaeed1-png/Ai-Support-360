// In-app notices of the BRD approval flow (types written by docs/sql/ticket-brd-approval.sql). Stored texts are
// English; screens show a translated title from the type and the version number in the stored title.
export const BRD_APPROVAL_NOTICE_TYPES = [
  'brd_approval_request', 'brd_approval_reminder', 'brd_approval_approved', 'brd_approval_changes',
  'brd_approval_declined', 'brd_approval_waiting', 'brd_approval_escalated', 'brd_approval_info',
] as const;
export type BrdApprovalNoticeType = typeof BRD_APPROVAL_NOTICE_TYPES[number];
export type BrdNoticeTone = 'success' | 'warning' | 'destructive' | 'info' | 'primary';

export function isBrdApprovalNotice(type: string | null | undefined): type is BrdApprovalNoticeType {
  return (BRD_APPROVAL_NOTICE_TYPES as readonly string[]).includes(String(type ?? ''));
}

export function brdNoticeTone(type: BrdApprovalNoticeType): BrdNoticeTone {
  switch (type) {
    case 'brd_approval_approved': return 'success';
    case 'brd_approval_changes': case 'brd_approval_waiting': case 'brd_approval_reminder': return 'warning';
    case 'brd_approval_declined': case 'brd_approval_escalated': return 'destructive';
    case 'brd_approval_request': return 'primary';
    default: return 'info';
  }
}

/** Version number from the stored title ("Please approve BRD v3" -> 3). */
export function brdNoticeVersion(title: string | null | undefined): number | null {
  const m = /\bv(\d{1,4})\b/.exec(String(title ?? ''));
  return m ? Number(m[1]) : null;
}

/** Ticket title quoted in the stored body ('... of "MIRO invoices" ...'). */
export function brdNoticeTicket(body: string | null | undefined): string | null {
  const m = /"([^"]{1,120})"/.exec(String(body ?? ''));
  return m ? m[1] : null;
}
