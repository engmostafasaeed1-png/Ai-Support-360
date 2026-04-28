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
  /** Optional: open the schedule meeting dialog inline rather than navigating */
  onScheduleMeeting?: () => void;
}

/**
 * Three quick-action buttons surfaced once a consultant is assigned to a
 * ticket. The Documents button opens an inline dialog so users can upload
 * a new file and see recent uploads without leaving the case.
 */
export default function TicketQuickActions({ ticketId, role, onScheduleMeeting }: Props) {
  const base = role === 'client' ? '/client' : '/consultant';
  const ticketDocsLink = role === 'client'
    ? `/client/tickets/${ticketId}?tab=documents#documents`
    : `/consultant/cases/${ticketId}#documents`;
  const remoteAccessLink = `${base}/remote-access?ticket=${ticketId}`;

  const [docsOpen, setDocsOpen] = useState(false);

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            variant="outline"
            className="h-auto py-3 flex-col gap-1.5 hover:border-primary/50 hover:bg-primary/5"
            onClick={() => setDocsOpen(true)}
          >
            <FileText className="w-5 h-5 text-primary" />
            <span className="text-xs font-semibold">Documents</span>
            <span className="text-[10px] text-muted-foreground">Upload &amp; view files</span>
          </Button>

          <Button
            asChild
            variant="outline"
            className="h-auto py-3 flex-col gap-1.5 hover:border-accent/50 hover:bg-accent/5"
          >
            <Link to={remoteAccessLink}>
              <Server className="w-5 h-5 text-accent" />
              <span className="text-xs font-semibold">Remote Access</span>
              <span className="text-[10px] text-muted-foreground">Connect to environment</span>
            </Link>
          </Button>

          {onScheduleMeeting ? (
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
              Upload a new file or browse recent uploads for this ticket.
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
