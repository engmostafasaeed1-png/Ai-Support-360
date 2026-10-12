import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useLocation, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  CalendarDays, Phone, ClipboardCheck,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ShareMenu from '@/components/ShareMenu';
import TicketNDAStatus from '@/components/client/TicketNDAStatus';
import { useTicketDetail, useTicketSessions, useTicketMessages } from '@/hooks/useTicketDetail';
import TicketDocuments from '@/components/client/TicketDocuments';
import ChildTickets, { TicketBreadcrumbs } from '@/components/client/ChildTickets';
import TicketHierarchyTree from '@/components/client/TicketHierarchyTree';
import TicketAssignments from '@/components/client/TicketAssignments';
import TicketAcceptors from '@/components/client/TicketAcceptors';
import TicketBids from '@/components/client/TicketBids';
import CriticalRequestPanel from '@/components/client/CriticalRequestPanel';
import TicketQuickActions from '@/components/tickets/TicketQuickActions';
import RemoteAccessStatusPanel from '@/components/tickets/RemoteAccessStatusPanel';
import TicketTimeline from '@/components/client/TicketTimeline';
import TicketEditDialog from '@/components/client/TicketEditDialog';
import SendMatchRequestDialog from '@/components/client/SendMatchRequestDialog';
import RequestBidDialog from '@/components/client/RequestBidDialog';
import TicketPlanApproval from '@/components/client/TicketPlanApproval';
import TicketTimesheet from '@/components/client/TicketTimesheet';
import TicketPaymentSection from '@/components/payments/TicketPaymentSection';
import TicketStatusStepper from '@/components/client/TicketStatusStepper';
import TicketInternalNotes from '@/components/client/TicketInternalNotes';
import TicketTagsWatchers from '@/components/client/TicketTagsWatchers';
import TicketSLATracker from '@/components/client/TicketSLATracker';
import TicketCSAT from '@/components/client/TicketCSAT';
import TicketLinks from '@/components/client/TicketLinks';
import TicketBusinessProcesses from '@/components/client/TicketBusinessProcesses';
import TicketInterview from '@/components/client/TicketInterview';
import TicketMatchRequests from '@/components/client/TicketMatchRequests';
import ScheduleMeetingDialog from '@/components/client/ScheduleMeetingDialog';
import EmergencyContactPanel from '@/components/client/EmergencyContactPanel';
import TicketMeetingsList from '@/components/client/TicketMeetingsList';
import RequestSatisfactionDialog from '@/components/satisfaction/RequestSatisfactionDialog';
import { useSatisfactionSurveys } from '@/hooks/useSatisfactionSurveys';
import { formatDistanceToNow, format } from 'date-fns';
import { useChatFileUrl } from '@/hooks/useChatFileUrl';
import { areasOf, areaLabel } from '@/lib/sapAreas';
import { SapNoteLinks } from '@/components/ticket/SapNotesField';
import { cleanNoteList } from '@/lib/sapNotes';
import { isolateDates } from '@/lib/bidi';
import { ticketContextBadges } from '@/lib/ticketContext';

function TicketFileLink({ fileUrl, fileName }: { fileUrl: string | null; fileName: string | null }) {
  const href = useChatFileUrl(fileUrl);
  if (!href) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
        <FileText className="w-3 h-3" /> {fileName || 'File'}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-xs text-primary underline flex items-center gap-1 mt-0.5">
      <FileText className="w-3 h-3" /> {fileName || 'File'}
    </a>
  );
}

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

const TICKET_TABS = ['overview', 'work', 'sessions', 'billing', 'files', 'activity'] as const;
type TicketTab = (typeof TICKET_TABS)[number];
// Older links name a section instead of a tab (the Documents quick action uses ?tab=documents).
const TAB_ALIASES: Record<string, TicketTab> = { documents: 'files' };

export default function TicketDetailPage() {
  const { t } = useTranslation();
  const { ticketId } = useParams<{ ticketId: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') ?? '';
  const requestedTab = TAB_ALIASES[rawTab] ?? rawTab;
  const activeTab: TicketTab = (TICKET_TABS as readonly string[]).includes(requestedTab) ? (requestedTab as TicketTab) : 'overview';
  const changeTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };
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
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [csatOpen, setCsatOpen] = useState(false);
  // A meeting needs a consultant assigned to this request (the ticket's consultant or an active assignment).
  const { data: activeAssignmentCount = 0 } = useQuery({
    queryKey: ['ticket-active-assignment-count', ticketId],
    queryFn: async () => {
      const { count } = await supabase.from('ticket_assignments').select('id', { count: 'exact', head: true }).eq('ticket_id', ticketId!).eq('status', 'active');
      return count ?? 0;
    },
    enabled: !!ticketId,
  });
  const canScheduleMeeting = !!ticket?.consultant_id || activeAssignmentCount > 0;
  const [resolutionEditing, setResolutionEditing] = useState(false);
  const [resolutionDraft, setResolutionDraft] = useState('');
  const queryClient = useQueryClient();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

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
  const ticketAreas = areasOf(ticket);
  const triedNotes = cleanNoteList(ticket.sap_notes_tried);
  const recordedSessions = completedSessions.filter(s => s.session_type === 'video' || s.session_type === 'screen_share');
  // A colleague of the ticket owner (same company) can read the ticket but only the owner can change it
  const isColleague = isClient && !!currentUserId && ticket.client_id !== currentUserId;

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
            <h1 className="text-xl font-bold text-foreground">{isolateDates(ticket.title)}</h1>
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
          {!isConsultant && !isColleague && (
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
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!canScheduleMeeting} onClick={() => setMeetingOpen(true)}>
                <CalendarDays className="w-3.5 h-3.5" /> Schedule Meeting
              </Button>
              {!canScheduleMeeting && (
                <span className="text-xs text-muted-foreground self-center">Meetings can be scheduled once a consultant is assigned to this request.</span>
              )}
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setCsatOpen(true)}>
                <ClipboardCheck className="w-3.5 h-3.5" /> Request CSAT
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

      {isColleague && (
        <Card className="rounded-2xl border-border/50 bg-muted/30">
          <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
            <Users className="w-3.5 h-3.5 shrink-0" /> This ticket belongs to a colleague in your company. You can follow it, but only its owner can change it.
          </CardContent>
        </Card>
      )}

      {/* ─── Critical reply service (only for a critical request) ─── */}
      {(ticket as any).critical_response && (
        <CriticalRequestPanel ticketId={ticket.id} role={isAdmin ? 'admin' : isConsultant ? 'consultant' : 'client'} />
      )}

      {/* ─── Status Stepper ─── */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-3">
          <TicketStatusStepper currentStatus={ticket.status} />
        </CardContent>
      </Card>

      {/* ─── Quick Actions (visible once consultant assigned) ─── */}
      {ticket.consultant_id && (
        <TicketQuickActions
          ticketId={ticket.id}
          role="client"
          ticketStatus={ticket.status}
          hasConsultant={!!ticket.consultant_id}
          onScheduleMeeting={() => { if (canScheduleMeeting) setMeetingOpen(true); }}
        />
      )}

      {/* ─── Remote Access Status ─── */}
      {ticket.consultant_id && (
        <RemoteAccessStatusPanel ticketId={ticket.id} role="client" />
      )}

      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1">
          <TabsTrigger value="overview" className="shrink-0 gap-1.5"><Tag className="h-3.5 w-3.5" />Overview</TabsTrigger>
          <TabsTrigger value="work" className="shrink-0 gap-1.5"><Users className="h-3.5 w-3.5" />Work &amp; plan</TabsTrigger>
          <TabsTrigger value="sessions" className="shrink-0 gap-1.5"><Video className="h-3.5 w-3.5" />Sessions &amp; chat</TabsTrigger>
          <TabsTrigger value="billing" className="shrink-0 gap-1.5"><Calculator className="h-3.5 w-3.5" />Time &amp; billing</TabsTrigger>
          <TabsTrigger value="files" className="shrink-0 gap-1.5"><FileText className="h-3.5 w-3.5" />Files &amp; links</TabsTrigger>
          <TabsTrigger value="activity" className="shrink-0 gap-1.5"><History className="h-3.5 w-3.5" />Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-5">
          {/* ─── Info Cards ─── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard
              icon={Tag}
              label={ticketAreas.length > 1 ? 'SAP Areas' : 'SAP Module'}
              value={ticketAreas.length > 1 ? `${areaLabel(ticketAreas[0], ticket.sap_module_other)} +${ticketAreas.length - 1}` : areaLabel(ticket.sap_module, ticket.sap_module_other)}
            />
            <InfoCard icon={User} label="Consultant" value={ticket.consultant_name || 'Unassigned'} />
            <InfoCard icon={Calendar} label="Created" value={format(new Date(ticket.created_at), 'MMM d, yyyy')} />
            <InfoCard icon={Clock} label="Last Updated" value={formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })} />
          </div>

          {(ticketAreas.length > 1 || ticket.sap_module_other || ticket.area_details) && (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SAP areas</p>
                <div className="flex flex-wrap gap-1.5">
                  {ticketAreas.map((name, i) => (
                    <Badge key={name} variant="secondary" className="text-xs gap-1">
                      {i === 0 && ticketAreas.length > 1 && <Star className="w-3 h-3 text-accent fill-accent" aria-label="Main area" />}
                      {areaLabel(name, ticket.sap_module_other)}
                    </Badge>
                  ))}
                </div>
                {ticket.area_details && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">More details about the areas</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{ticket.area_details}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* The matching context the client gave with the request */}
          {ticketContextBadges((ticket as any).ticket_context).length > 0 && (
            <Card className="rounded-2xl border-border/50" data-testid="matching-context">
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Matching context</p>
                <div className="flex flex-wrap gap-1.5">
                  {ticketContextBadges((ticket as any).ticket_context).map(line => {
                    const { prefix, label } = splitBadge(line);
                    return (
                      <Badge key={line} variant="outline" className="text-xs font-normal whitespace-normal">
                        {prefix ? <><span>{prefix}</span> <span>{label}</span></> : <span>{label}</span>}
                      </Badge>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* SAP Notes the client already tried */}
          {triedNotes.length > 0 && (
            <Card className="rounded-2xl border-border/50" data-testid="notes-tried">
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SAP Notes already tried</p>
                <SapNoteLinks notes={triedNotes} />
                <p className="text-[11px] text-muted-foreground">Each note opens in SAP for Me. You need your own SAP login to read it.</p>
              </CardContent>
            </Card>
          )}

          {/* ─── Description & Extra Details ─── */}
          {(ticket.description || ticket.preferred_language || ticket.sla_deadline || ticket.ai_suggested_category) && (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-4 space-y-3">
                {ticket.description && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{isolateDates(ticket.description)}</p>
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

          {/* ─── Resolution Notes ─── */}
          {(ticket.status === 'resolved' || ticket.status === 'closed') && (
            <Card className="rounded-2xl border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolution Notes
                  </p>
                  {!resolutionEditing && !isColleague && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setResolutionEditing(true); setResolutionDraft((ticket as any).resolution_notes || ''); }}>
                      <Pencil className="w-3 h-3" /> {(ticket as any).resolution_notes ? 'Edit' : 'Add Notes'}
                    </Button>
                  )}
                </div>
                {resolutionEditing ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Describe how this issue was resolved. An administrator may review these notes before anything is added to the playbook library..."
                      value={resolutionDraft}
                      onChange={e => setResolutionDraft(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="text-xs" onClick={async () => {
                        const { error } = await supabase.from('tickets').update({ resolution_notes: resolutionDraft } as any).eq('id', ticket.id);
                        if (error) { toast.error('Failed to save'); return; }
                        toast.success('Resolution notes saved');
                        setResolutionEditing(false);
                        queryClient.invalidateQueries({ queryKey: ['ticket-detail'] });
                      }}>Save</Button>
                      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setResolutionEditing(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {(ticket as any).resolution_notes || 'No resolution notes yet. Add notes to document how this issue was resolved.'}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ─── NDA Status (when consultant assigned) ─── */}
          {ticket.consultant_id && (
            <TicketNDAStatus
              consultantId={ticket.consultant_id}
              clientId={ticket.client_id}
              consultantName={ticket.consultant_name || undefined}
              clientName="Your Company"
            />
          )}

          {/* ─── SLA Tracking ─── */}
          <TicketSLATracker
            ticketId={ticket.id}
            urgency={ticket.urgency}
            status={ticket.status}
            createdAt={ticket.created_at}
            slaDeadline={ticket.sla_deadline}
            firstResponseAt={(ticket as any).first_response_at}
            slaBreach={(ticket as any).sla_breached || false}
          />

          {/* ─── Emergency Contact ─── */}
          {(ticket.consultant_id || (isClient && (ticket.urgency === 'high' || ticket.urgency === 'critical'))) && (
            <SectionWrapper icon={Phone} title="Quick Contact" defaultOpen>
              <EmergencyContactPanel
                consultantId={ticket.consultant_id}
                consultantName={ticket.consultant_name || undefined}
                ticketId={ticket.id}
                ticketTitle={ticket.title}
                urgency={ticket.urgency}
              />
            </SectionWrapper>
          )}
        </TabsContent>

        <TabsContent value="work" className="mt-0 space-y-5">
          {/* ─── Pre-Work Interview ─── */}
          <SectionWrapper icon={Video} title="Pre-Work Interview" defaultOpen>
            <TicketInterview
              ticketId={ticket.id}
              consultantId={ticket.consultant_id}
              clientId={ticket.client_id}
              isClient={isClient && !isColleague}
              isConsultant={isConsultant}
              consultantName={ticket.consultant_name || undefined}
            />
          </SectionWrapper>

          {/* ─── Cost & Effort Plan ─── */}
          <SectionWrapper icon={Calculator} title="Cost & Effort Plan" defaultOpen>
            <TicketPlanApproval ticket={ticket} isClient={isClient && !isColleague} />
          </SectionWrapper>

          {/* ─── Available Consultants (Acceptors) ─── */}
          {isClient && <TicketMatchRequests ticketId={ticket.id} clientId={ticket.client_id} />}

          <TicketAcceptors ticketId={ticket.id} currentConsultantId={ticket.consultant_id} />

          {/* ─── Multi-Consultant Assignments ─── */}
          <SectionWrapper icon={Users} title="Consultant Assignments" defaultOpen>
            <TicketAssignments ticketId={ticket.id} isReadOnly={isConsultant || isColleague} />
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
        </TabsContent>

        <TabsContent value="sessions" className="mt-0 space-y-5">
          {/* ─── Sessions Section ─── */}
          <SectionWrapper icon={Video} title="Sessions" count={sessions?.length} defaultOpen>
            <SessionsList sessions={sessions || []} isLoading={sessionsLoading} />
          </SectionWrapper>

          {/* ─── Meetings List with AI Insights ─── */}
          <SectionWrapper icon={CalendarDays} title="Meetings" defaultOpen>
            <TicketMeetingsList ticketId={ticket.id} onSchedule={() => { if (canScheduleMeeting) setMeetingOpen(true); }} />
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
        </TabsContent>

        <TabsContent value="billing" className="mt-0 space-y-5">
          {/* ─── Timesheet / Work Log ─── */}
          <SectionWrapper icon={ClipboardList} title="Timesheet & Work Log" defaultOpen>
            <TicketTimesheet ticketId={ticket.id} ticketTitle={ticket.title} isReadOnly={isClient} canApprove={isClient && !isColleague} />
          </SectionWrapper>

          <TicketPaymentSection ticketId={ticket.id} role={isClient && !isColleague ? 'client' : 'viewer'} />

          {/* ─── CSAT Satisfaction ─── */}
          <SectionWrapper icon={Star} title="Satisfaction" defaultOpen>
            <TicketCSAT ticketId={ticket.id} ticketTitle={ticket.title} ticketStatus={ticket.status} clientId={ticket.client_id} consultantId={ticket.consultant_id} />
          </SectionWrapper>
        </TabsContent>

        <TabsContent value="files" className="mt-0 space-y-5">
          {/* ─── Documents ─── */}
          <SectionWrapper icon={FileText} title="Documents" defaultOpen>
            <TicketDocuments ticketId={ticket.id} />
          </SectionWrapper>

          {/* ─── Linked Tickets ─── */}
          <SectionWrapper icon={Link2} title="Linked Tickets" defaultOpen={false}>
            <TicketLinks ticketId={ticket.id} isReadOnly={isConsultant || isColleague} />
          </SectionWrapper>

          {/* ─── Business Processes ─── */}
          <SectionWrapper icon={Network} title="Business Processes" defaultOpen={false}>
            <TicketBusinessProcesses ticketId={ticket.id} isReadOnly={isConsultant || isColleague} />
          </SectionWrapper>
        </TabsContent>

        <TabsContent value="activity" className="mt-0 space-y-5">
          {/* ─── Tags & Watchers ─── */}
          <SectionWrapper icon={Tags} title="Tags & Watchers" defaultOpen>
            <TicketTagsWatchers ticketId={ticket.id} isReadOnly={isColleague} />
          </SectionWrapper>

          {/* ─── Internal Notes ─── */}
          {!isClient && (
            <SectionWrapper icon={MessageSquareText} title="Internal Notes" defaultOpen>
              <TicketInternalNotes ticketId={ticket.id} />
            </SectionWrapper>
          )}

          {/* ─── Activity Timeline ─── */}
          <SectionWrapper icon={History} title="Full Activity Timeline" defaultOpen={false}>
            <TicketTimeline ticketId={ticket.id} ticket={ticket} />
          </SectionWrapper>
        </TabsContent>

      </Tabs>

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
        ticketModule={ticket.sap_module}
        isOpenForBids={ticket.open_for_bids || false}
        open={bidOpen}
        onOpenChange={setBidOpen}
      />
      <ScheduleMeetingDialog
        open={meetingOpen}
        onOpenChange={setMeetingOpen}
        ticketId={ticket.id}
        ticketTitle={ticket.title}
        clientId={ticket.client_id}
        consultantId={ticket.consultant_id}
        consultantName={ticket.consultant_name || undefined}
      />
      <RequestSatisfactionDialog
        open={csatOpen}
        onOpenChange={setCsatOpen}
        isPending={false}
        parties={[
          ...(ticket.consultant_id ? [{ id: ticket.consultant_id, name: ticket.consultant_name || 'Consultant', role: 'consultant' as const }] : []),
          // nobody asks themselves for a survey
          ...(ticket.client_id !== currentUserId ? [{ id: ticket.client_id, name: 'Client', role: 'client' as const }] : []),
        ]}
        onRequest={async (targetUserId, role) => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          // the consultant party carries the id of the consultant: the survey needs the user id of that consultant
          let ratedBy = targetUserId;
          if (role === 'consultant') {
            const { data: consultantRow } = await supabase.from('consultants').select('user_id').eq('id', targetUserId).maybeSingle();
            if (!consultantRow?.user_id) { toast.error('The consultant could not be found'); return; }
            ratedBy = consultantRow.user_id;
          }
          // rated_by = target (they fill the survey), rated_user = requester (they get rated)
          const { error: surveyError } = await (supabase.from('satisfaction_surveys') as any).insert({
            rated_by: ratedBy,
            rated_user: user.id,
            role,
            ticket_id: ticket.id,
            requested_by: user.id,
            status: 'pending',
          });
          if (surveyError) { toast.error(surveyError.message || 'The survey could not be requested'); return; }
          toast.success('CSAT survey requested!');
          setCsatOpen(false);
        }}
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
                <TicketFileLink fileUrl={msg.file_url ?? null} fileName={msg.file_name ?? null} />
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
