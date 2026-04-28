import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Server, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  ticketId: string;
  /** 'client' or 'consultant' — controls link prefixes */
  role: 'client' | 'consultant';
  /** Optional: open the schedule meeting dialog inline rather than navigating */
  onScheduleMeeting?: () => void;
}

/**
 * Three individual quick-action buttons surfaced once a consultant is
 * assigned to a ticket. Each button has its own dedicated link so the
 * client/consultant can jump straight to the relevant context.
 */
export default function TicketQuickActions({ ticketId, role, onScheduleMeeting }: Props) {
  const base = role === 'client' ? '/client' : '/consultant';
  const ticketDocsLink = role === 'client'
    ? `/client/tickets/${ticketId}?tab=documents#documents`
    : `/consultant/cases/${ticketId}#documents`;
  const remoteAccessLink = `${base}/remote-access?ticket=${ticketId}`;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            asChild
            variant="outline"
            className="h-auto py-3 flex-col gap-1.5 hover:border-primary/50 hover:bg-primary/5"
          >
            <Link to={ticketDocsLink}>
              <FileText className="w-5 h-5 text-primary" />
              <span className="text-xs font-semibold">Documents</span>
              <span className="text-[10px] text-muted-foreground">View &amp; upload files</span>
            </Link>
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
    </Card>
  );
}
