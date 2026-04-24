import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Activity, Ticket as TicketIcon, UserCheck, CalendarCheck, Video,
  CheckCircle2, Circle, Clock, Search, Sparkles, PlayCircle,
  ExternalLink, MessageSquare, Monitor,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useClientTimeline, type TimelineTicket } from '@/hooks/useClientTimeline';

type StageKey = 'created' | 'matched' | 'booked' | 'session' | 'resolved';

interface Stage {
  key: StageKey;
  label: string;
  icon: typeof Circle;
  state: 'done' | 'active' | 'pending';
  timestamp?: string | null;
  detail?: string;
}

const sessionTypeIcon: Record<string, typeof Video> = {
  chat: MessageSquare,
  video: Video,
  screen_share: Monitor,
};

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  triaging: 'bg-indigo-100 text-indigo-700',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-100 text-red-700',
};

function buildStages(t: TimelineTicket): Stage[] {
  const acceptedMatch = t.match_requests.find(m => m.status === 'accepted');
  const pendingMatch = t.match_requests.find(m => m.status === 'pending');
  const upcomingSession = t.sessions.find(s => s.status === 'scheduled');
  const liveSession = t.sessions.find(s => s.status === 'in_progress' || s.status === 'live');
  const completedSession = [...t.sessions].reverse().find(s => s.status === 'completed');

  const isResolved = !!t.resolved_at || t.status === 'resolved' || t.status === 'closed';
  const hasConsultant = !!t.consultant_id || !!acceptedMatch;
  const hasBooking = !!upcomingSession || !!liveSession || !!completedSession || !!t.interview?.scheduled_at;
  const hasSession = !!liveSession || !!completedSession;

  const sessionDetail = liveSession
    ? 'Session in progress'
    : completedSession?.duration_minutes
    ? `${completedSession.duration_minutes} min completed`
    : upcomingSession?.session_type
    ? `${upcomingSession.session_type.replace(/_/g, ' ')} session`
    : undefined;

  return [
    {
      key: 'created',
      label: 'Ticket Created',
      icon: TicketIcon,
      state: 'done',
      timestamp: t.created_at,
      detail: `${t.sap_module} · ${t.urgency ?? 'medium'}`,
    },
    {
      key: 'matched',
      label: hasConsultant ? 'Consultant Matched' : pendingMatch ? 'Awaiting Consultant' : 'Matching',
      icon: UserCheck,
      state: hasConsultant ? 'done' : pendingMatch ? 'active' : 'pending',
      timestamp: acceptedMatch?.responded_at || acceptedMatch?.created_at || pendingMatch?.created_at,
      detail: t.consultant_name || acceptedMatch?.consultant_name || pendingMatch?.consultant_name || undefined,
    },
    {
      key: 'booked',
      label: hasBooking ? 'Booking Confirmed' : 'Booking Pending',
      icon: CalendarCheck,
      state: hasBooking ? (hasSession ? 'done' : 'active') : hasConsultant ? 'active' : 'pending',
      timestamp:
        upcomingSession?.scheduled_at ||
        liveSession?.scheduled_at ||
        completedSession?.scheduled_at ||
        t.interview?.scheduled_at ||
        undefined,
      detail: upcomingSession?.scheduled_at
        ? `Scheduled ${format(new Date(upcomingSession.scheduled_at), 'MMM d · h:mm a')}`
        : t.interview?.scheduled_at
        ? `Interview ${format(new Date(t.interview.scheduled_at), 'MMM d · h:mm a')}`
        : undefined,
    },
    {
      key: 'session',
      label: liveSession ? 'Session Live' : completedSession ? 'Session Completed' : 'Session Pending',
      icon: liveSession ? PlayCircle : Video,
      state: liveSession ? 'active' : completedSession ? 'done' : hasBooking ? 'active' : 'pending',
      timestamp: liveSession?.started_at || completedSession?.ended_at || undefined,
      detail: sessionDetail,
    },
    {
      key: 'resolved',
      label: isResolved ? 'Resolved' : 'In Progress',
      icon: CheckCircle2,
      state: isResolved ? 'done' : hasSession ? 'active' : 'pending',
      timestamp: t.resolved_at,
    },
  ];
}

type FilterKey = 'all' | 'active' | 'live' | 'resolved';

export default function TimelinePage() {
  const { data: tickets, isLoading } = useClientTimeline();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    const list = tickets || [];
    return list.filter(t => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === 'active') return t.status && t.status !== 'resolved' && t.status && t.status !== 'closed' && t.status && t.status !== 'cancelled';
      if (filter === 'resolved') return t.status === 'resolved' || t.status === 'closed';
      if (filter === 'live') return t.sessions.some(s => s.status === 'in_progress' || s.status === 'live');
      return true;
    });
  }, [tickets, search, filter]);

  const stats = useMemo(() => {
    const list = tickets || [];
    return {
      total: list.length,
      active: list.filter(t => !t.status || !["resolved","closed","cancelled"].includes(t.status)).length,
      live: list.filter(t => t.sessions.some(s => s.status === 'in_progress' || s.status === 'live')).length,
      resolved: list.filter(t => ['resolved', 'closed'].includes(t.status)).length,
    };
  }, [tickets]);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            Unified View
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Timeline
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Track ticket status, matched consultants, booked meetings, and live sessions in one place.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'All Tickets', value: stats.total, icon: TicketIcon, color: 'text-foreground', bg: 'bg-muted/50' },
          { label: 'Active', value: stats.active, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Live Sessions', value: stats.live, icon: PlayCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Resolved', value: stats.resolved, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
        ].map(s => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <div>
                <div className="text-xl font-semibold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tickets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="ps-9"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 border border-border/50">
          {(['all', 'active', 'live', 'resolved'] as FilterKey[]).map(k => (
            <Button
              key={k}
              size="sm"
              variant={filter === k ? 'default' : 'ghost'}
              className="rounded-lg capitalize text-xs h-8"
              onClick={() => setFilter(k)}
            >
              {k}
            </Button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <Card className="rounded-2xl border-dashed border-border/60">
          <CardContent className="py-16 text-center">
            <Activity className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No matching tickets</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {tickets && tickets.length === 0
                ? 'Submit your first request to start a timeline.'
                : 'Try a different filter or search term.'}
            </p>
            <Button asChild>
              <Link to="/client/new-request">New Request</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Timeline cards */}
      <div className="space-y-4">
        {filtered.map(t => (
          <TicketTimelineCard key={t.id} ticket={t} />
        ))}
      </div>
    </div>
  );
}

function TicketTimelineCard({ ticket }: { ticket: TimelineTicket }) {
  const stages = buildStages(ticket);
  const liveSession = ticket.sessions.find(s => s.status === 'in_progress' || s.status === 'live');
  const upcomingSession = ticket.sessions.find(s => s.status === 'scheduled');
  const SessionIcon = sessionTypeIcon[upcomingSession?.session_type || liveSession?.session_type || 'video'] || Video;

  return (
    <Card className="rounded-2xl border-border/50 overflow-hidden hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="secondary" className={`text-[10px] capitalize ${statusColors[ticket.status] || 'bg-muted'}`}>
                {ticket.status.replace(/_/g, ' ')}
              </Badge>
              {ticket.urgency && (
                <Badge variant="secondary" className={`text-[10px] capitalize ${urgencyColors[ticket.urgency]}`}>
                  {ticket.urgency}
                </Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
              </span>
            </div>
            <CardTitle className="text-base md:text-lg truncate">
              <Link to={`/client/tickets/${ticket.id}`} className="hover:text-primary transition-colors">
                {ticket.title}
              </Link>
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {liveSession?.meeting_url && (
              <Button asChild size="sm" className="gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700">
                <a href={liveSession.meeting_url} target="_blank" rel="noreferrer">
                  <PlayCircle className="w-3.5 h-3.5" />
                  Join Live
                </a>
              </Button>
            )}
            {!liveSession && upcomingSession && (
              <Button asChild size="sm" variant="secondary" className="gap-1.5 rounded-xl">
                <Link to={`/client/sessions`}>
                  <SessionIcon className="w-3.5 h-3.5" />
                  View Booking
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="ghost" className="gap-1.5 rounded-xl">
              <Link to={`/client/tickets/${ticket.id}`}>
                Detail <ExternalLink className="w-3 h-3" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Horizontal stages */}
        <div className="relative">
          <div className="hidden md:flex items-stretch gap-0">
            {stages.map((stage, idx) => (
              <StageNode key={stage.key} stage={stage} isLast={idx === stages.length - 1} />
            ))}
          </div>
          {/* Mobile vertical */}
          <div className="md:hidden space-y-3">
            {stages.map(stage => (
              <StageRow key={stage.key} stage={stage} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StageNode({ stage, isLast }: { stage: Stage; isLast: boolean }) {
  const Icon = stage.icon;
  const colors =
    stage.state === 'done'
      ? 'bg-primary text-primary-foreground border-primary'
      : stage.state === 'active'
      ? 'bg-accent/15 text-accent border-accent ring-4 ring-accent/10 animate-pulse'
      : 'bg-muted text-muted-foreground border-border';
  const lineColor =
    stage.state === 'done' ? 'bg-primary/60' : stage.state === 'active' ? 'bg-gradient-to-r from-accent/60 to-border' : 'bg-border';

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center text-center px-2">
      <div className="relative w-full flex items-center justify-center">
        <div className={`relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all ${colors}`}>
          <Icon className="w-4 h-4" />
        </div>
        {!isLast && <div className={`absolute top-1/2 start-1/2 w-full h-0.5 ${lineColor}`} />}
      </div>
      <div className="mt-2 min-w-0 w-full">
        <div className={`text-xs font-semibold truncate ${stage.state === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
          {stage.label}
        </div>
        {stage.detail && (
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{stage.detail}</div>
        )}
        {stage.timestamp && (
          <div className="text-[10px] text-muted-foreground/70 mt-0.5">
            {format(new Date(stage.timestamp), 'MMM d')}
          </div>
        )}
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  const Icon = stage.icon;
  const colors =
    stage.state === 'done'
      ? 'bg-primary text-primary-foreground'
      : stage.state === 'active'
      ? 'bg-accent/15 text-accent ring-2 ring-accent/20'
      : 'bg-muted text-muted-foreground';
  return (
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${colors}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{stage.label}</div>
        {stage.detail && <div className="text-xs text-muted-foreground truncate">{stage.detail}</div>}
      </div>
      {stage.timestamp && (
        <div className="text-[10px] text-muted-foreground whitespace-nowrap">
          {format(new Date(stage.timestamp), 'MMM d')}
        </div>
      )}
    </div>
  );
}
