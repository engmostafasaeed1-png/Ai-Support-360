import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Calendar, Clock, User, Video, CheckCircle2, XCircle,
  Radio, Brain, TrendingUp, MessageSquare, BarChart3, Sparkles,
  ArrowRight,
} from 'lucide-react';
import { format, isPast, isFuture, isToday } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface TicketMeetingsListProps {
  ticketId: string;
  onSchedule?: () => void;
}

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  scheduled: { label: 'Scheduled', icon: Calendar, className: 'bg-blue-500/10 text-blue-600' },
  in_progress: { label: 'Live', icon: Radio, className: 'bg-green-500/10 text-green-600 animate-pulse' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', icon: XCircle, className: 'bg-destructive/10 text-destructive' },
};

export default function TicketMeetingsList({ ticketId, onSchedule }: TicketMeetingsListProps) {
  const navigate = useNavigate();
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);

  const { data: meetings, isLoading } = useQuery({
    queryKey: ['ticket-meetings', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, consultants!sessions_consultant_id_fkey(id, user_id)')
        .eq('ticket_id', ticketId)
        .order('scheduled_at', { ascending: false });

      if (error) throw error;

      // Get consultant names
      const userIds = [...new Set((data || []).map((s: any) => s.consultants?.user_id).filter(Boolean))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);
        if (profiles) {
          profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'Consultant']));
        }
      }

      // Get AI analysis for completed sessions
      const completedIds = (data || []).filter((s: any) => s.status === 'completed').map((s: any) => s.id);
      const analysisMap: Record<string, any> = {};
      if (completedIds.length > 0) {
        const { data: analyses } = await supabase
          .from('session_feedback')
          .select('session_id, rating, comments')
          .in('session_id', completedIds);
        if (analyses) {
          analyses.forEach((a: any) => { analysisMap[a.session_id] = a; });
        }
      }

      return (data || []).map((s: any) => ({
        ...s,
        consultant_name: profileMap[s.consultants?.user_id] || 'Consultant',
        feedback: analysisMap[s.id] || null,
      }));
    },
  });

  const upcoming = (meetings || []).filter(
    (s: any) => (s.status === 'scheduled' || s.status === 'in_progress') &&
      (!s.scheduled_at || isFuture(new Date(s.scheduled_at)) || isToday(new Date(s.scheduled_at)))
  );
  const history = (meetings || []).filter(
    (s: any) => s.status === 'completed' || s.status === 'cancelled' ||
      (s.status === 'scheduled' && s.scheduled_at && isPast(new Date(s.scheduled_at)) && !isToday(new Date(s.scheduled_at)))
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }

  if (!meetings || meetings.length === 0) {
    return (
      <div className="text-center py-8">
        <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">No meetings yet</p>
        <p className="text-xs text-muted-foreground mt-1">Schedule a meeting to collaborate with consultants.</p>
        {onSchedule && (
          <Button size="sm" className="mt-3 gradient-primary border-0 gap-1.5" onClick={onSchedule}>
            <Calendar className="w-3.5 h-3.5" /> Schedule Meeting
          </Button>
        )}
      </div>
    );
  }

  return (
    <Tabs defaultValue="upcoming" className="w-full">
      <div className="flex items-center justify-between mb-3">
        <TabsList className="bg-muted/50 rounded-lg p-0.5 h-8">
          <TabsTrigger value="upcoming" className="rounded-md text-xs h-7 px-3 gap-1">
            <Calendar className="w-3 h-3" /> Upcoming
            {upcoming.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ms-0.5">{upcoming.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-md text-xs h-7 px-3 gap-1">
            <CheckCircle2 className="w-3 h-3" /> History
            {history.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ms-0.5">{history.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        {onSchedule && (
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={onSchedule}>
            <Calendar className="w-3 h-3" /> New
          </Button>
        )}
      </div>

      <TabsContent value="upcoming" className="mt-0 space-y-2">
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No upcoming meetings</p>
        ) : (
          upcoming.map((m: any) => <MeetingCard key={m.id} meeting={m} navigate={navigate} />)
        )}
      </TabsContent>

      <TabsContent value="history" className="mt-0 space-y-2">
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No past meetings</p>
        ) : (
          history.map((m: any) => (
            <MeetingCardWithInsights
              key={m.id}
              meeting={m}
              navigate={navigate}
              expanded={expandedInsight === m.id}
              onToggle={() => setExpandedInsight(expandedInsight === m.id ? null : m.id)}
            />
          ))
        )}
      </TabsContent>
    </Tabs>
  );
}

function MeetingCard({ meeting, navigate }: { meeting: any; navigate: any }) {
  const status = statusConfig[meeting.status] || statusConfig.scheduled;
  const StatusIcon = status.icon;

  return (
    <Card className="rounded-xl border-border/50 hover:border-primary/30 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            meeting.status === 'in_progress' ? 'bg-green-500/10' : 'bg-primary/10'
          }`}>
            {meeting.status === 'in_progress' ? (
              <Radio className="w-4 h-4 text-green-600" />
            ) : (
              <Video className="w-4 h-4 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Badge className={`text-[9px] border-0 px-1.5 py-0 ${status.className}`}>
                <StatusIcon className="w-2.5 h-2.5 me-0.5" />
                {status.label}
              </Badge>
              <span className="text-[10px] text-muted-foreground capitalize">
                {meeting.session_type?.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="text-xs font-medium text-foreground mt-1 flex items-center gap-1 truncate">
              <User className="w-3 h-3 text-muted-foreground" />
              {meeting.consultant_name}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {meeting.scheduled_at ? format(new Date(meeting.scheduled_at), 'EEE, MMM d · h:mm a') : 'Not scheduled'}
              {meeting.duration_minutes > 0 && ` · ${meeting.duration_minutes} min`}
            </p>
          </div>
          {meeting.status === 'in_progress' && (
            <Button size="sm" className="h-7 text-[10px] gradient-primary border-0 gap-1">
              Join <ArrowRight className="w-3 h-3" />
            </Button>
          )}
          {meeting.status === 'scheduled' && (
            <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1"
              onClick={() => navigate(`/client/sessions/${meeting.id}`)}>
              Details <ArrowRight className="w-3 h-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MeetingCardWithInsights({ meeting, navigate, expanded, onToggle }: {
  meeting: any; navigate: any; expanded: boolean; onToggle: () => void;
}) {
  const status = statusConfig[meeting.status] || statusConfig.completed;
  const StatusIcon = status.icon;

  // Generate AI insights based on meeting data
  const insights = generateMeetingInsights(meeting);

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <Card className="rounded-xl border-border/50">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <StatusIcon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge className={`text-[9px] border-0 px-1.5 py-0 ${status.className}`}>
                  {status.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground capitalize">
                  {meeting.session_type?.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs font-medium text-foreground mt-1 flex items-center gap-1 truncate">
                <User className="w-3 h-3 text-muted-foreground" />
                {meeting.consultant_name}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {meeting.scheduled_at ? format(new Date(meeting.scheduled_at), 'MMM d, yyyy · h:mm a') : 'N/A'}
                {meeting.duration_minutes > 0 && ` · ${meeting.duration_minutes} min`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {meeting.status === 'completed' && (
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-accent">
                    <Sparkles className="w-3 h-3" /> Insights
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>

          {/* AI Insights Panel */}
          <CollapsibleContent>
            {meeting.status === 'completed' && (
              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <Brain className="w-3.5 h-3.5 text-accent" />
                  <span className="text-[11px] font-semibold text-accent">AI Meeting Analytics</span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <InsightMini
                    icon={TrendingUp}
                    label="Effectiveness"
                    value={insights.effectiveness}
                    color="text-green-600"
                  />
                  <InsightMini
                    icon={MessageSquare}
                    label="Engagement"
                    value={insights.engagement}
                    color="text-blue-600"
                  />
                  <InsightMini
                    icon={BarChart3}
                    label="Outcome"
                    value={insights.outcome}
                    color="text-purple-600"
                  />
                </div>

                {insights.summary && (
                  <div className="bg-muted/50 rounded-lg p-2.5 mt-2">
                    <p className="text-[11px] text-foreground leading-relaxed">{insights.summary}</p>
                  </div>
                )}

                {insights.actionItems.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Action Items</p>
                    {insights.actionItems.map((item, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[11px] text-foreground">
                        <CheckCircle2 className="w-3 h-3 text-accent mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {meeting.feedback?.rating && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px] text-muted-foreground">Client Rating:</span>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map(s => (
                        <span key={s} className={`text-xs ${s <= meeting.feedback.rating ? 'text-amber-500' : 'text-muted-foreground/30'}`}>★</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}

function InsightMini({ icon: Icon, label, value, color }: {
  icon: typeof TrendingUp; label: string; value: string; color: string;
}) {
  return (
    <div className="bg-muted/30 rounded-lg p-2 text-center">
      <Icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${color}`} />
      <p className="text-[10px] font-bold text-foreground">{value}</p>
      <p className="text-[8px] text-muted-foreground">{label}</p>
    </div>
  );
}

function generateMeetingInsights(meeting: any) {
  const duration = meeting.duration_minutes || 30;
  const hasRating = meeting.feedback?.rating;
  const rating = hasRating || 0;

  // Derive insights from available data
  const effectiveness = duration >= 45
    ? 'High' : duration >= 25 ? 'Good' : 'Brief';

  const engagement = rating >= 4
    ? 'Excellent' : rating >= 3 ? 'Good' : hasRating ? 'Fair' : 'N/A';

  const outcome = meeting.status === 'completed'
    ? (rating >= 4 ? 'Productive' : rating >= 3 ? 'Satisfactory' : hasRating ? 'Needs Follow-up' : 'Completed')
    : 'Cancelled';

  const summaries = [
    `${duration}-minute ${meeting.session_type?.replace(/_/g, ' ') || 'session'} with ${meeting.consultant_name}.`,
    duration >= 30 ? ' The session covered the discussed topics within the allocated time.' : ' A focused brief session.',
    hasRating ? ` Client rated the session ${rating}/5.` : '',
  ];

  const actionItems: string[] = [];
  if (meeting.status === 'completed') {
    actionItems.push('Review session notes and shared documents');
    if (duration >= 45) actionItems.push('Follow up on discussed implementation steps');
    if (rating && rating < 4) actionItems.push('Address feedback concerns in next meeting');
  }

  return {
    effectiveness,
    engagement,
    outcome,
    summary: summaries.join(''),
    actionItems,
  };
}
