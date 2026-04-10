import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  ArrowLeft, Clock, User, Calendar, Tag, MessageSquare,
  FileText, Video, Monitor, AlertCircle, CheckCircle2, Circle, History,
  Pencil, UserPlus, Gavel, ChevronDown, Play, GitBranch, Network, Users,
  Calculator, ClipboardList, MessageSquareText, Timer, Star, Link2, Tags,
} from 'lucide-react';
import ShareMenu from '@/components/ShareMenu';
import { useTicketDetail, useTicketSessions, useTicketMessages } from '@/hooks/useTicketDetail';
import TicketDocuments from '@/components/client/TicketDocuments';
import ChildTickets, { TicketBreadcrumbs } from '@/components/client/ChildTickets';
import TicketHierarchyTree from '@/components/client/TicketHierarchyTree';
import TicketAssignments from '@/components/client/TicketAssignments';
import TicketAcceptors from '@/components/client/TicketAcceptors';
import TicketBids from '@/components/client/TicketBids';
import TicketTimeline from '@/components/client/TicketTimeline';
import TicketEditDialog from '@/components/client/TicketEditDialog';
import SendMatchRequestDialog from '@/components/client/SendMatchRequestDialog';
import RequestBidDialog from '@/components/client/RequestBidDialog';
import TicketPlanApproval from '@/components/client/TicketPlanApproval';
import TicketTimesheet from '@/components/client/TicketTimesheet';
import TicketStatusStepper from '@/components/client/TicketStatusStepper';
import { formatDistanceToNow, format } from 'date-fns';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  triaging: 'bg-indigo-100 text-indigo-700',
  under_review: 'bg-indigo-100 text-indigo-700',
  planning: 'bg-violet-100 text-violet-700',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-orange-100 text-orange-700',
  waiting_for_client: 'bg-amber-100 text-amber-700',
  waiting_for_vendor: 'bg-yellow-100 text-yellow-700',
  testing: 'bg-cyan-100 text-cyan-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-100 text-red-700',
  reopened: 'bg-pink-100 text-pink-700',
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
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');
  const isConsultant = location.pathname.startsWith('/consultant');
  const isClient = !isAdmin && !isConsultant;
  const backPath = isAdmin ? '/admin/tickets' : isConsultant ? '/consultant/open-tickets' : '/client/tickets';
  const { data: ticket, isLoading } = useTicketDetail(ticketId);
  const { data: sessions, isLoading: sessionsLoading } = useTicketSessions(ticketId);
  const { data: messages, isLoading: messagesLoading } = useTicketMessages(ticketId);
  const [editOpen, setEditOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);

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
        <Link to={backPath}>
          <Button variant="outline" className="mt-4">Back to Tickets</Button>
        </Link>
      </div>
    );
  }

  const completedSessions = (sessions || []).filter(s => s.status === 'completed');
  const recordedSessions = completedSessions.filter(s => s.session_type === 'video' || s.session_type === 'screen_share');

  return (
    <div className="space-y-5">
      {/* ─── Breadcrumb Tracing ─── */}
      {ticket.parent_ticket_id && <TicketBreadcrumbs ticketId={ticket.id} />}

      {/* ─── Header ─── */}
      <div className="flex items-start gap-3">
        <Link to={backPath}>
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
          {!isConsultant && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1.5 gradient-primary border-0" onClick={() => setMatchOpen(true)}>
                <UserPlus className="w-3.5 h-3.5" /> Send Request
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setBidOpen(true)}>
                <Gavel className="w-3.5 h-3.5" />
                {ticket.open_for_bids ? 'Manage Bids' : 'Request Bids'}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
              {ticket.urgency}
            </Badge>
            <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>
              {ticket.status.replace(/_/g, ' ')}
            </Badge>
            {ticket.open_for_bids && (
              <Badge variant="secondary" className="text-[10px] bg-accent/10 text-accent gap-1">
                <Gavel className="w-2.5 h-2.5" /> Open for Bids
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ─── Status Stepper ─── */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-3">
          <TicketStatusStepper currentStatus={ticket.status} />
        </CardContent>
      </Card>

      {/* ─── Info Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoCard icon={Tag} label="SAP Module" value={ticket.sap_module} />
        <InfoCard icon={User} label="Consultant" value={ticket.consultant_name || 'Unassigned'} />
        <InfoCard icon={Calendar} label="Created" value={format(new Date(ticket.created_at), 'MMM d, yyyy')} />
        <InfoCard icon={Clock} label="Last Updated" value={formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })} />
      </div>

      {/* ─── Description & Extra Details ─── */}
      {(ticket.description || ticket.preferred_language || ticket.sla_deadline || ticket.ai_suggested_category) && (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 space-y-3">
            {ticket.description && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{ticket.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              {ticket.preferred_language && (
                <DetailItem label="Language" value={ticket.preferred_language === 'ar' ? 'Arabic' : 'English'} />
              )}
              {ticket.preferred_session_type && (
                <DetailItem label="Session Type" value={ticket.preferred_session_type.replace(/_/g, ' ')} />
              )}
              {ticket.sla_deadline && (
                <DetailItem label="SLA Deadline" value={format(new Date(ticket.sla_deadline), 'MMM d, yyyy HH:mm')} />
              )}
              {ticket.resolved_at && (
                <DetailItem label="Resolved" value={format(new Date(ticket.resolved_at), 'MMM d, yyyy')} />
              )}
              {ticket.ai_suggested_category && (
                <DetailItem label="AI Category" value={ticket.ai_suggested_category} />
              )}
              {ticket.ai_suggested_priority && (
                <DetailItem label="AI Priority" value={ticket.ai_suggested_priority} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Cost & Effort Plan ─── */}
      <SectionWrapper icon={Calculator} title="Cost & Effort Plan" defaultOpen>
        <TicketPlanApproval ticket={ticket} isClient={isClient} />
      </SectionWrapper>

      {/* ─── Available Consultants (Acceptors) ─── */}
      <TicketAcceptors ticketId={ticket.id} currentConsultantId={ticket.consultant_id} />

      {/* ─── Multi-Consultant Assignments ─── */}
      <SectionWrapper icon={Users} title="Consultant Assignments" defaultOpen>
        <TicketAssignments ticketId={ticket.id} isReadOnly={isConsultant} />
      </SectionWrapper>

      {/* ─── Bids Section ─── */}
      <SectionWrapper icon={Gavel} title="Bids & Proposals" defaultOpen>
        <TicketBids ticketId={ticket.id} />
      </SectionWrapper>

      {/* ─── Ticket Hierarchy Tree ─── */}
      <SectionWrapper icon={Network} title="Ticket Hierarchy" defaultOpen>
        <TicketHierarchyTree ticketId={ticket.id} onEditTicket={(id) => { if (id === ticket.id) setEditOpen(true); }} />
      </SectionWrapper>

      {/* ─── Child Tickets (Sub-tickets) ─── */}
      <SectionWrapper icon={GitBranch} title="Sub-Tickets" defaultOpen>
        <ChildTickets
          ticketId={ticket.id}
          ticketSapModule={ticket.sap_module}
          ticketClientId={ticket.client_id}
          tenantId={(ticket as any).tenant_id}
        />
      </SectionWrapper>

      {/* ─── Sessions Section ─── */}
      <SectionWrapper icon={Video} title="Sessions" count={sessions?.length} defaultOpen>
        <SessionsList sessions={sessions || []} isLoading={sessionsLoading} />
      </SectionWrapper>

      {/* ─── Recorded Sessions ─── */}
      {recordedSessions.length > 0 && (
        <SectionWrapper icon={Play} title="Recorded Sessions" count={recordedSessions.length} defaultOpen={false}>
          <div className="space-y-2">
            {recordedSessions.map(s => (
              <Card key={s.id} className="rounded-xl border-border/30">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Play className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground capitalize">
                      {s.session_type?.replace(/_/g, ' ')} — {s.consultant_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.scheduled_at && format(new Date(s.scheduled_at), 'MMM d, yyyy h:mm a')}
                      {s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                    <CheckCircle2 className="w-3 h-3 me-1" /> Completed
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </SectionWrapper>
      )}

      {/* ─── Chat / Messages ─── */}
      <SectionWrapper icon={MessageSquare} title="Chat History" count={messages?.length} defaultOpen>
        <ChatInline messages={messages || []} isLoading={messagesLoading} />
      </SectionWrapper>

      {/* ─── Timesheet / Work Log ─── */}
      <SectionWrapper icon={ClipboardList} title="Timesheet & Work Log" defaultOpen>
        <TicketTimesheet ticketId={ticket.id} ticketTitle={ticket.title} isReadOnly={isClient} />
      </SectionWrapper>

      {/* ─── Documents ─── */}
      <SectionWrapper icon={FileText} title="Documents" defaultOpen>
        <TicketDocuments ticketId={ticket.id} />
      </SectionWrapper>

      {/* ─── Activity Timeline ─── */}
      <SectionWrapper icon={History} title="Full Activity Timeline" defaultOpen={false}>
        <TicketTimeline ticketId={ticket.id} ticket={ticket} />
      </SectionWrapper>

      {/* ─── Dialogs ─── */}
      <TicketEditDialog ticket={ticket} open={editOpen} onOpenChange={setEditOpen} />
      <SendMatchRequestDialog
        ticketId={ticket.id}
        ticketTitle={ticket.title}
        ticketDescription={ticket.description || ''}
        ticketUrgency={ticket.urgency}
        sapModule={ticket.sap_module}
        preferredLanguage={ticket.preferred_language || 'en'}
        open={matchOpen}
        onOpenChange={setMatchOpen}
      />
      <RequestBidDialog
        ticketId={ticket.id}
        ticketTitle={ticket.title}
        isOpenForBids={ticket.open_for_bids || false}
        open={bidOpen}
        onOpenChange={setBidOpen}
      />
    </div>
  );
}

/* ─── Reusable sub-components ─── */

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

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium text-foreground capitalize">{value}</p>
    </div>
  );
}

function SectionWrapper({
  icon: Icon,
  title,
  count,
  defaultOpen = true,
  children,
}: {
  icon: typeof Video;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 py-2 px-1 group text-left">
          <Icon className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {count !== undefined && count > 0 && (
            <Badge variant="secondary" className="text-[10px]">{count}</Badge>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground ms-auto transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SessionsList({ sessions, isLoading }: { sessions: any[]; isLoading: boolean }) {
  const { t } = useTranslation();
  if (isLoading) return <Skeleton className="h-32 rounded-2xl" />;

  if (sessions.length === 0) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-8 text-center">
          <Video className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No sessions yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map(session => {
        const TypeIcon = sessionTypeIcons[session.session_type] || MessageSquare;
        const StatusIcon = sessionStatusIcons[session.status] || Circle;
        return (
          <Card key={session.id} className="rounded-xl border-border/30 hover:shadow-sm transition-shadow">
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <TypeIcon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground capitalize">
                      {session.session_type?.replace(/_/g, ' ')}
                    </span>
                    <Badge variant="secondary" className="text-[10px] gap-0.5">
                      <StatusIcon className="w-3 h-3" /> {session.status}
                    </Badge>
                    {session.duration_minutes > 0 && (
                      <span className="text-[11px] text-muted-foreground ms-auto">{session.duration_minutes} min</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {session.consultant_name}
                    {session.scheduled_at && ` · ${format(new Date(session.scheduled_at), 'MMM d, h:mm a')}`}
                  </p>
                </div>
              </div>
              {session.ai_summary && (
                <div className="mt-2 p-2 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground text-[11px]">AI Summary: </span>
                  {session.ai_summary}
                </div>
              )}
              {session.notes && (
                <p className="mt-1.5 text-xs text-muted-foreground italic">"{session.notes}"</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ChatInline({ messages, isLoading }: { messages: any[]; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-32 rounded-2xl" />;

  if (messages.length === 0) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-8 text-center">
          <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No messages yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="p-4 max-h-[400px] overflow-y-auto space-y-3">
        {messages.map(msg => (
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
                <a href={msg.file_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary underline flex items-center gap-1 mt-0.5">
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
