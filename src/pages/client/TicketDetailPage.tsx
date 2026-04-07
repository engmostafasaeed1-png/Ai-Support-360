import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft, Clock, User, Calendar, Tag, MessageSquare,
  FileText, Video, Monitor, AlertCircle, CheckCircle2, Circle,
} from 'lucide-react';
import ShareMenu from '@/components/ShareMenu';
import { useTicketDetail, useTicketSessions, useTicketMessages } from '@/hooks/useTicketDetail';
import TicketDocuments from '@/components/client/TicketDocuments';
import TicketAcceptors from '@/components/client/TicketAcceptors';
import TicketBids from '@/components/client/TicketBids';
import { formatDistanceToNow, format } from 'date-fns';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  under_review: 'bg-indigo-100 text-indigo-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_for_client: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

const sessionTypeIcons: Record<string, typeof MessageSquare> = {
  chat: MessageSquare,
  video: Video,
  screen_share: Monitor,
};

const sessionStatusIcons: Record<string, typeof Circle> = {
  scheduled: Clock,
  in_progress: AlertCircle,
  completed: CheckCircle2,
  cancelled: Circle,
};

export default function TicketDetailPage() {
  const { t } = useTranslation();
  const { ticketId } = useParams<{ ticketId: string }>();
  const { data: ticket, isLoading } = useTicketDetail(ticketId);
  const { data: sessions, isLoading: sessionsLoading } = useTicketSessions(ticketId);
  const { data: messages, isLoading: messagesLoading } = useTicketMessages(ticketId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">Ticket not found</p>
        <Link to="/client/tickets">
          <Button variant="outline" className="mt-4">Back to Tickets</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link to="/client/tickets">
          <Button variant="ghost" size="icon" className="h-9 w-9 mt-0.5">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-bold text-foreground">{ticket.title}</h1>
            <ShareMenu
              title={ticket.title}
              text={`Ticket: ${ticket.title} — ${ticket.sap_module} — ${ticket.status}`}
              details={[
                { label: 'SAP Module', value: ticket.sap_module },
                { label: 'Status', value: ticket.status.replace(/_/g, ' ') },
                { label: 'Urgency', value: ticket.urgency },
              ]}
              variant="outline"
              size="sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
              {ticket.urgency}
            </Badge>
            <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>
              {ticket.status.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoCard icon={Tag} label="SAP Module" value={ticket.sap_module} />
        <InfoCard icon={User} label="Consultant" value={ticket.consultant_name || 'Unassigned'} />
        <InfoCard icon={Calendar} label="Created" value={format(new Date(ticket.created_at), 'MMM d, yyyy')} />
        <InfoCard icon={Clock} label="Last Updated" value={formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })} />
      </div>

      {/* Description */}
      {ticket.description && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Consultant acceptors */}
      <TicketAcceptors ticketId={ticket.id} currentConsultantId={ticket.consultant_id} />

      {/* Extra details */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            {ticket.preferred_language && (
              <div>
                <p className="text-muted-foreground text-xs">Language</p>
                <p className="font-medium text-foreground">{ticket.preferred_language === 'ar' ? 'Arabic' : 'English'}</p>
              </div>
            )}
            {ticket.preferred_session_type && (
              <div>
                <p className="text-muted-foreground text-xs">Session Type</p>
                <p className="font-medium text-foreground capitalize">{ticket.preferred_session_type.replace(/_/g, ' ')}</p>
              </div>
            )}
            {ticket.sla_deadline && (
              <div>
                <p className="text-muted-foreground text-xs">SLA Deadline</p>
                <p className="font-medium text-foreground">{format(new Date(ticket.sla_deadline), 'MMM d, yyyy HH:mm')}</p>
              </div>
            )}
            {ticket.resolved_at && (
              <div>
                <p className="text-muted-foreground text-xs">Resolved</p>
                <p className="font-medium text-foreground">{format(new Date(ticket.resolved_at), 'MMM d, yyyy')}</p>
              </div>
            )}
            {ticket.ai_suggested_category && (
              <div>
                <p className="text-muted-foreground text-xs">AI Category</p>
                <p className="font-medium text-foreground">{ticket.ai_suggested_category}</p>
              </div>
            )}
            {ticket.ai_suggested_priority && (
              <div>
                <p className="text-muted-foreground text-xs">AI Priority</p>
                <p className="font-medium text-foreground">{ticket.ai_suggested_priority}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Bids, Documents, Sessions, Chat */}
      <Tabs defaultValue="bids" className="w-full">
        <TabsList className="w-full grid grid-cols-4 rounded-xl h-10">
          <TabsTrigger value="bids" className="text-xs gap-1.5">
            <Tag className="w-3.5 h-3.5" /> Bids
          </TabsTrigger>
          <TabsTrigger value="documents" className="text-xs gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Documents
          </TabsTrigger>
          <TabsTrigger value="sessions" className="text-xs gap-1.5">
            <Video className="w-3.5 h-3.5" /> Sessions
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-xs gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Chat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bids" className="mt-4">
          <TicketBids ticketId={ticket.id} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <TicketDocuments ticketId={ticket.id} />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <SessionTimeline sessions={sessions || []} isLoading={sessionsLoading} />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatHistory messages={messages || []} isLoading={messagesLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: typeof Tag; label: string; value: string }) {
  return (
    <Card className="rounded-xl border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="w-3.5 h-3.5" />
          <span className="text-[10px] uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-sm font-semibold text-foreground truncate">{value}</p>
      </CardContent>
    </Card>
  );
}

function SessionTimeline({ sessions, isLoading }: { sessions: any[]; isLoading: boolean }) {
  const { t } = useTranslation();
  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  if (sessions.length === 0) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-12 text-center">
          <Video className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No sessions linked to this ticket yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative space-y-0">
      {/* Timeline line */}
      <div className="absolute start-[18px] top-4 bottom-4 w-px bg-border/50" />
      {sessions.map((session, i) => {
        const TypeIcon = sessionTypeIcons[session.session_type] || MessageSquare;
        const StatusIcon = sessionStatusIcons[session.status] || Circle;
        return (
          <div key={session.id} className="relative flex gap-4 pb-4">
            <div className="relative z-10 w-9 h-9 rounded-full bg-card border border-border/50 flex items-center justify-center shrink-0">
              <TypeIcon className="w-4 h-4 text-primary" />
            </div>
            <Card className="flex-1 rounded-xl border-border/50">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground capitalize">
                      {session.session_type?.replace(/_/g, ' ')} Session
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      <StatusIcon className="w-3 h-3 me-1" />
                      {session.status}
                    </Badge>
                  </div>
                  {session.duration_minutes > 0 && (
                    <span className="text-[11px] text-muted-foreground">{session.duration_minutes} min</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{t('session_detail.unknown_consultant', 'Consultant')}: {session.consultant_name}</p>
                  {session.scheduled_at && (
                    <p>{t('session_detail.scheduled_at', 'Scheduled')}: {format(new Date(session.scheduled_at), 'MMM d, yyyy h:mm a')}</p>
                  )}
                  {session.started_at && (
                    <p>{t('session_detail.started_at', 'Started')}: {format(new Date(session.started_at), 'MMM d, yyyy h:mm a')}</p>
                  )}
                </div>
                {session.ai_summary && (
                  <div className="mt-2 p-2 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground text-[11px] mb-0.5">{t('session_detail.ai_summary', 'AI Summary')}</p>
                    {session.ai_summary}
                  </div>
                )}
                {session.notes && (
                  <p className="mt-1.5 text-xs text-muted-foreground italic">"{session.notes}"</p>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

function ChatHistory({ messages, isLoading }: { messages: any[]; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  if (messages.length === 0) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-12 text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No chat messages for this ticket yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4 max-h-[400px] overflow-y-auto space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary">
              {msg.sender_name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">{msg.sender_name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                </span>
              </div>
              {msg.message_type === 'file' ? (
                <a
                  href={msg.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline flex items-center gap-1 mt-0.5"
                >
                  <FileText className="w-3 h-3" /> {msg.file_name || 'File'}
                </a>
              ) : (
                <p className="text-sm text-muted-foreground mt-0.5">{msg.content}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
