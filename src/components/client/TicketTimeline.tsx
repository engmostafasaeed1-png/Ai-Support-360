import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTicketSessions, useTicketMessages } from '@/hooks/useTicketDetail';
import { useTicketProposals } from '@/hooks/useProposals';
import { useTicketDocuments } from '@/hooks/useTicketDocuments';
import {
  Clock, MessageSquare, Video, Monitor, FileText, Gavel,
  CheckCircle2, Circle, AlertCircle, Upload, DollarSign,
  ArrowRight, Play, Pause, Star, Calendar,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'created' | 'session' | 'message' | 'bid' | 'document' | 'status_change';
  title: string;
  subtitle?: string;
  detail?: string;
  icon: typeof Clock;
  iconColor: string;
  iconBg: string;
  badges?: { label: string; className: string }[];
  meta?: { label: string; value: string }[];
}

const sessionTypeIcons: Record<string, typeof Video> = {
  chat: MessageSquare,
  video: Video,
  screen_share: Monitor,
};

interface Props {
  ticketId: string;
  ticket: {
    created_at: string;
    status: string;
    resolved_at?: string | null;
    sla_deadline?: string | null;
  };
}

export default function TicketTimeline({ ticketId, ticket }: Props) {
  const { data: sessions, isLoading: sl } = useTicketSessions(ticketId);
  const { data: messages, isLoading: ml } = useTicketMessages(ticketId);
  const { data: proposals, isLoading: pl } = useTicketProposals(ticketId);
  const { data: documents, isLoading: dl } = useTicketDocuments(ticketId);
  // the real history of the ticket: status changes, assignments, urgency, plan decisions, match requests
  const { data: history, isLoading: hl } = useQuery({
    queryKey: ['ticket-timeline', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ticket_timeline_v2', { _ticket_id: ticketId });
      if (error) throw error;
      return (data || []) as { event_at: string; kind: string; title: string; detail: string | null; actor_name: string | null }[];
    },
  });

  const isLoading = sl || ml || pl || dl || hl;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex gap-4">
            <Skeleton className="w-10 h-10 rounded-full shrink-0" />
            <Skeleton className="flex-1 h-20 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  // Build unified events
  const events: TimelineEvent[] = [];

  // 1. Ticket created
  events.push({
    id: 'ticket-created',
    timestamp: ticket.created_at,
    type: 'created',
    title: 'Ticket Created',
    subtitle: 'Support request submitted',
    icon: Circle,
    iconColor: 'text-accent',
    iconBg: 'bg-accent/10',
  });

  // 2. Sessions
  (sessions || []).forEach(s => {
    const TypeIcon = sessionTypeIcons[s.session_type || ''] || Video;
    events.push({
      id: `session-${s.id}`,
      timestamp: s.scheduled_at || s.started_at || ticket.created_at,
      type: 'session',
      title: `${(s.session_type || 'video').replace(/_/g, ' ')} Session`,
      subtitle: `with ${s.consultant_name || 'Consultant'}`,
      detail: s.ai_summary || s.notes || undefined,
      icon: TypeIcon,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10',
      badges: [
        { label: s.status || 'unknown', className: s.status === 'completed' ? 'bg-green-100 text-green-700' : s.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground' },
      ],
      meta: [
        ...(s.duration_minutes ? [{ label: 'Duration', value: `${s.duration_minutes} min` }] : []),
        ...(s.scheduled_at ? [{ label: 'Scheduled', value: format(new Date(s.scheduled_at), 'MMM d, h:mm a') }] : []),
      ],
    });
  });

  // 3. Messages
  (messages || []).forEach(m => {
    events.push({
      id: `msg-${m.id}`,
      timestamp: m.created_at,
      type: 'message',
      title: m.sender_name || 'Unknown',
      subtitle: m.message_type === 'file' ? `📎 ${m.file_name || 'File'}` : (m.content || '').slice(0, 120),
      icon: MessageSquare,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-100',
    });
  });

  // 4. Proposals/Bids
  (proposals || []).forEach((p: any) => {
    events.push({
      id: `bid-${p.id}`,
      timestamp: p.created_at,
      type: 'bid',
      title: `Bid from ${p.consultant_name || 'Consultant'}`,
      subtitle: p.cover_letter ? `"${(p.cover_letter).slice(0, 100)}..."` : undefined,
      icon: Gavel,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-100',
      badges: [
        { label: p.status, className: p.status === 'accepted' ? 'bg-green-100 text-green-700' : p.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700' },
      ],
      meta: [
        { label: 'Rate', value: `$${p.proposed_rate}/hr` },
        ...(p.estimated_hours ? [{ label: 'Hours', value: `${p.estimated_hours}h` }] : []),
        ...(p.timeline_days ? [{ label: 'Timeline', value: `${p.timeline_days} days` }] : []),
      ],
    });
  });

  // 5. Documents
  (documents || []).forEach(d => {
    events.push({
      id: `doc-${d.id}`,
      timestamp: d.created_at,
      type: 'document',
      title: d.file_name,
      subtitle: d.uploader_name ? `Uploaded by ${d.uploader_name}` : undefined,
      detail: d.comment || undefined,
      icon: Upload,
      iconColor: 'text-violet-600',
      iconBg: 'bg-violet-100',
      meta: [
        ...(d.file_size ? [{ label: 'Size', value: formatFileSize(d.file_size) }] : []),
        { label: 'Version', value: `v${d.version}` },
      ],
    });
  });

  // 6. Resolved
  if (ticket.resolved_at) {
    events.push({
      id: 'ticket-resolved',
      timestamp: ticket.resolved_at,
      type: 'status_change',
      title: 'Ticket Resolved',
      subtitle: 'Issue has been resolved',
      icon: CheckCircle2,
      iconColor: 'text-green-600',
      iconBg: 'bg-green-100',
    });
  }

  // 7. History from the server (the "created" entry and the "resolved" status change are already shown above)
  (history || []).forEach((h, i) => {
    if (h.kind === 'created') return;
    if (h.kind === 'document') return;
    if (h.kind === 'status' && h.title === 'Status changed to resolved' && ticket.resolved_at) return;
    const style = h.kind === 'status'
      ? { icon: ArrowRight, color: 'text-blue-600', bg: 'bg-blue-100' }
      : h.kind === 'assignment'
        ? { icon: Play, color: 'text-primary', bg: 'bg-primary/10' }
        : h.kind === 'plan'
          ? { icon: DollarSign, color: 'text-amber-600', bg: 'bg-amber-100' }
          : h.kind === 'rate'
            ? { icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-100' }
            : h.kind === 'timesheet'
              ? { icon: Clock, color: 'text-sky-600', bg: 'bg-sky-100' }
              : { icon: AlertCircle, color: 'text-muted-foreground', bg: 'bg-muted' };
    events.push({
      id: `history-${i}`,
      timestamp: h.event_at,
      type: 'status_change',
      title: h.title,
      subtitle: [h.detail, h.actor_name ? `By ${h.actor_name}` : null].filter(Boolean).join(' · ') || undefined,
      icon: style.icon,
      iconColor: style.color,
      iconBg: style.bg,
    });
  });

  // Sort chronologically (newest first)
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (events.length <= 1) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-12 text-center">
          <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute start-5 top-6 bottom-6 w-px bg-gradient-to-b from-accent/40 via-border/50 to-transparent" />

      <div className="space-y-1">
        {events.map((event, idx) => (
          <div key={event.id} className="relative flex gap-4 group">
            {/* Timeline dot */}
            <div className={`relative z-10 w-10 h-10 rounded-full ${event.iconBg} flex items-center justify-center shrink-0 ring-4 ring-background transition-transform group-hover:scale-110`}>
              <event.icon className={`w-4 h-4 ${event.iconColor}`} />
            </div>

            {/* Content card */}
            <div className="flex-1 pb-6 min-w-0">
              <Card className="rounded-xl border-border/50 hover:shadow-md transition-all overflow-hidden group-hover:border-accent/30">
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-foreground truncate capitalize">{event.title}</h4>
                      {event.subtitle && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{event.subtitle}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {event.badges?.map((b, i) => (
                        <Badge key={i} variant="secondary" className={`text-[10px] capitalize ${b.className}`}>
                          {b.label.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  {/* Detail */}
                  {event.detail && (
                    <div className="mt-2 p-2.5 rounded-lg bg-muted/30 text-xs text-muted-foreground line-clamp-3">
                      {event.detail}
                    </div>
                  )}

                  {/* Meta row */}
                  {event.meta && event.meta.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      {event.meta.map((m, i) => (
                        <span key={i} className="text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{m.value}</span>
                          <span className="ms-1 opacity-60">{m.label}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Timestamp */}
                  <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground/70">
                    <Calendar className="w-3 h-3" />
                    {format(new Date(event.timestamp), 'MMM d, yyyy · h:mm a')}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
