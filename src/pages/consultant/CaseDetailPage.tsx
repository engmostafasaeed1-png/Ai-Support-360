import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Clock, Calendar, User, Tag, AlertTriangle,
  CheckCircle2, MessageSquare, FileText, Activity, Circle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, formatDistanceToNow } from 'date-fns';

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

const statusIcons: Record<string, typeof Circle> = {
  new: Circle,
  under_review: Activity,
  matched: User,
  in_progress: Activity,
  waiting_for_client: Clock,
  resolved: CheckCircle2,
  closed: CheckCircle2,
};

interface TimelineEvent {
  id: string;
  type: 'status' | 'session' | 'message' | 'document' | 'created';
  title: string;
  description?: string;
  date: string;
  icon: typeof Circle;
  color: string;
}

export default function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['case-detail', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('id', caseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!caseId,
  });

  const { data: sessions } = useQuery({
    queryKey: ['case-sessions', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, scheduled_at, started_at, ended_at, status, session_type, duration_minutes, notes')
        .eq('ticket_id', caseId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!caseId,
  });

  const { data: documents } = useQuery({
    queryKey: ['case-documents', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_documents')
        .select('id, file_name, created_at, version')
        .eq('ticket_id', caseId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!caseId,
  });

  // Build timeline
  const timeline: TimelineEvent[] = [];
  if (ticket) {
    timeline.push({
      id: 'created',
      type: 'created',
      title: 'Case Created',
      description: `Ticket "${ticket.title}" was submitted`,
      date: ticket.created_at,
      icon: Circle,
      color: 'text-accent',
    });

    if (ticket.resolved_at) {
      timeline.push({
        id: 'resolved',
        type: 'status',
        title: 'Case Resolved',
        date: ticket.resolved_at,
        icon: CheckCircle2,
        color: 'text-green-500',
      });
    }
  }

  (sessions || []).forEach((s) => {
    timeline.push({
      id: `session-${s.id}`,
      type: 'session',
      title: `Session ${s.session_type || 'scheduled'}`,
      description: s.notes || `Duration: ${s.duration_minutes || 0} min — Status: ${s.status}`,
      date: s.scheduled_at || s.started_at || '',
      icon: MessageSquare,
      color: 'text-blue-500',
    });
  });

  (documents || []).forEach((d) => {
    timeline.push({
      id: `doc-${d.id}`,
      type: 'document',
      title: `Document uploaded: ${d.file_name}`,
      description: `Version ${d.version}`,
      date: d.created_at,
      icon: FileText,
      color: 'text-purple-500',
    });
  });

  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Case not found.</p>
        <Link to="/consultant/cases">
          <Button variant="outline" className="mt-4">Back to Cases</Button>
        </Link>
      </div>
    );
  }

  const slaTime = ticket.sla_deadline ? new Date(ticket.sla_deadline) : null;
  const isOverdue = slaTime && slaTime < new Date() && ticket.status !== 'resolved' && ticket.status !== 'closed';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Link to="/consultant/cases">
          <Button variant="ghost" size="icon" className="rounded-xl">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground truncate">{ticket.title}</h1>
          <p className="text-xs text-muted-foreground">
            Created {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
          </p>
        </div>
        <Badge className={`${statusColors[ticket.status || 'new']} text-xs`}>
          {(ticket.status || 'new').replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Details Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Case Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Tag className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">SAP Module:</span>
              <span className="font-medium">{ticket.sap_module}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Urgency:</span>
              <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency || 'medium']}`}>
                {ticket.urgency || 'medium'}
              </Badge>
            </div>
            {slaTime && (
              <div className={`flex items-center gap-2 text-sm ${isOverdue ? 'text-red-600' : ''}`}>
                <Clock className="w-4 h-4" />
                <span className="text-muted-foreground">SLA Deadline:</span>
                <span className={isOverdue ? 'font-semibold text-red-600' : 'font-medium'}>
                  {format(slaTime, 'MMM d, yyyy h:mm a')}
                  {isOverdue && ' (Overdue)'}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Created:</span>
              <span className="font-medium">{format(new Date(ticket.created_at), 'MMM d, yyyy')}</span>
            </div>
            {ticket.preferred_language && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Language:</span>
                <span className="font-medium">{ticket.preferred_language}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {ticket.description || 'No description provided.'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{sessions?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Sessions</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{documents?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Documents</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {(sessions || []).reduce((sum, s) => sum + (s.duration_minutes || 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total Minutes</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{timeline.length}</p>
            <p className="text-xs text-muted-foreground">Events</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline / History */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Case History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No activity yet.</p>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-5">
                {timeline.map((event) => {
                  const Icon = event.icon;
                  return (
                    <div key={event.id} className="flex gap-4 relative">
                      <div className={`w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center shrink-0 z-10 ${event.color}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 pb-1">
                        <p className="text-sm font-medium text-foreground">{event.title}</p>
                        {event.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          {event.date ? formatDistanceToNow(new Date(event.date), { addSuffix: true }) : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
