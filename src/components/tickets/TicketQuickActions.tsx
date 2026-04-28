import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { FileText, Server, CalendarDays, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import TicketDocuments from '@/components/client/TicketDocuments';

interface Props {
  ticketId: string;
  /** 'client' or 'consultant' — controls link prefixes */
  role: 'client' | 'consultant';
  /** Current ticket status (e.g. 'in_progress', 'resolved', 'closed'). */
  ticketStatus?: string | null;
  /** True when a consultant is assigned to this ticket. */
  hasConsultant?: boolean;
  /**
   * For role='consultant': true when the current viewer IS the assigned
   * consultant. Defaults to true to preserve previous behaviour.
   */
  isAssignedConsultant?: boolean;
  /** Optional: open the schedule meeting dialog inline rather than navigating */
  onScheduleMeeting?: () => void;
}

/**
 * Quick actions surfaced on the ticket detail page. Each action is gated
 * by role + ticket state so users only see what they're allowed to do:
 *
 *  - Documents:      visible to client always, and to the assigned consultant.
 *                    Read-only badge when the ticket is closed/cancelled.
 *  - Remote Access:  only when a consultant is assigned and the ticket is in
 *                    an active working state (not new / closed / cancelled).
 *                    Consultant must be the assigned one.
 *  - Request Meeting: client can schedule whenever the ticket is open; the
 *                    assigned consultant can schedule when working on it.
 *                    Hidden after resolution / closure / cancellation.
 */
export default function TicketQuickActions({
  ticketId,
  role,
  ticketStatus,
  hasConsultant = true,
  isAssignedConsultant = true,
  onScheduleMeeting,
}: Props) {
  const base = role === 'client' ? '/client' : '/consultant';
  const ticketDocsLink = role === 'client'
    ? `/client/tickets/${ticketId}?tab=documents#documents`
    : `/consultant/cases/${ticketId}#documents`;
  const remoteAccessLink = `${base}/remote-access?ticket=${ticketId}`;

  const [docsOpen, setDocsOpen] = useState(false);

  // ── Visibility rules ────────────────────────────────────────────────
  // Full lifecycle map (mirrors backend ticket statuses):
  //   Pre-work:   new, triaging, under_review, planning, pending_approval, approved, matched
  //   Active:     in_progress, testing, waiting_for_client, waiting_for_vendor, on_hold, reopened
  //   Terminal:   resolved, closed, cancelled
  const status = (ticketStatus || '').toLowerCase();

  const TERMINAL = ['closed', 'cancelled', 'resolved'];
  const HARD_CLOSED = ['closed', 'cancelled'];
  const PRE_WORK = ['new', 'triaging', 'under_review', 'planning', 'pending_approval', 'approved', 'matched'];
  const ACTIVE_WORK = ['in_progress', 'testing', 'waiting_for_client', 'waiting_for_vendor', 'on_hold', 'reopened'];
  // Statuses where the client owes a response — meeting request is most useful here.
  const AWAITING_CLIENT = ['waiting_for_client', 'pending_approval'];
  // Statuses where remote access is paused — show as visible but de-prioritised.
  const REMOTE_PAUSED = ['on_hold', 'waiting_for_client', 'waiting_for_vendor'];

  const isTerminal = TERMINAL.includes(status);
  const isHardClosed = HARD_CLOSED.includes(status);
  const isPreWork = PRE_WORK.includes(status);
  const isActiveWork = ACTIVE_WORK.includes(status);
  const isMatched = status === 'matched' || status === 'approved';
  const isRemotePaused = REMOTE_PAUSED.includes(status);
  const isAwaitingClient = AWAITING_CLIENT.includes(status);

  // Consultants must be the assigned one to act on the ticket.
  const consultantAllowed = role === 'client' || isAssignedConsultant;

  // Documents: visible across the entire lifecycle; read-only once hard-closed.
  const showDocuments = consultantAllowed;
  const documentsReadOnly = isHardClosed;

  // Remote Access: needs an assigned consultant + work phase. Also allow
  // 'matched'/'approved' so credentials can be exchanged before kickoff.
  const showRemoteAccess =
    consultantAllowed && hasConsultant && (isActiveWork || isMatched);

  // Request Meeting: any time after a consultant is assigned, until terminal.
  // Also allow during 'pending_approval' (clients often want to discuss the plan).
  const showRequestMeeting =
    consultantAllowed && hasConsultant && !isTerminal &&
    (isActiveWork || isMatched || isAwaitingClient || status === 'pending_approval');

  const visibleCount = [showDocuments, showRemoteAccess, showRequestMeeting].filter(Boolean).length;
  if (visibleCount === 0) return null;

  const gridCols = visibleCount === 1 ? 'grid-cols-1'
    : visibleCount === 2 ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-3';

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4">
        <div className={`grid ${gridCols} gap-3`}>
          {showDocuments && (
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1.5 hover:border-primary/50 hover:bg-primary/5"
              onClick={() => setDocsOpen(true)}
            >
              <FileText className="w-5 h-5 text-primary" />
              <span className="text-xs font-semibold">Documents</span>
              <span className="text-[10px] text-muted-foreground">
                {documentsReadOnly ? 'View files (read-only)' : 'Upload & view files'}
              </span>
            </Button>
          )}

          {showRemoteAccess && (
            <Button
              asChild
              variant="outline"
              className="h-auto py-3 flex-col gap-1.5 hover:border-accent/50 hover:bg-accent/5"
            >
              <Link to={remoteAccessLink}>
                <Server className="w-5 h-5 text-accent" />
                <span className="text-xs font-semibold">Remote Access</span>
                <span className="text-[10px] text-muted-foreground">
                  {isMatched ? 'Set up environment' : isRemotePaused ? 'Paused — review status' : 'Connect to environment'}
                </span>
              </Link>
            </Button>
          )}

          {showRequestMeeting && (
            onScheduleMeeting ? (
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1.5 hover:border-emerald-500/50 hover:bg-emerald-500/5"
                onClick={onScheduleMeeting}
              >
                <CalendarDays className="w-5 h-5 text-emerald-600" />
                <span className="text-xs font-semibold">Request Meeting</span>
                <span className="text-[10px] text-muted-foreground">Schedule a session</span>
              </Button>
            ) : (
              <Button
                asChild
                variant="outline"
                className="h-auto py-3 flex-col gap-1.5 hover:border-emerald-500/50 hover:bg-emerald-500/5"
              >
                <Link to={`${base}/calendar?ticket=${ticketId}`}>
                  <CalendarDays className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs font-semibold">Request Meeting</span>
                  <span className="text-[10px] text-muted-foreground">Schedule a session</span>
                </Link>
              </Button>
            )
          )}
        </div>
      </CardContent>

      {/* Inline Documents dialog: upload step + recent uploads */}
      <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Ticket Documents
            </DialogTitle>
            <DialogDescription>
              {documentsReadOnly
                ? 'This ticket is closed — files are read-only.'
                : 'Upload a new file or browse recent uploads for this ticket.'}
            </DialogDescription>
          </DialogHeader>

          <TicketDocuments ticketId={ticketId} />

          <div className="flex justify-end pt-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to={ticketDocsLink} onClick={() => setDocsOpen(false)}>
                <ArrowUpRight className="w-3.5 h-3.5" /> Open full documents tab
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
