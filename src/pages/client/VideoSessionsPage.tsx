import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Video, Clock, User, ArrowRight, Calendar, History,
  Play, CheckCircle2, XCircle, Radio,
} from 'lucide-react';
import { format, isPast, isFuture, isToday } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  scheduled: { label: 'Scheduled', icon: Calendar, className: 'bg-blue-500/10 text-blue-600' },
  in_progress: { label: 'Live Now', icon: Radio, className: 'bg-green-500/10 text-green-600 animate-pulse' },
  completed: { label: 'Completed', icon: CheckCircle2, className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', icon: XCircle, className: 'bg-destructive/10 text-destructive' },
};

type SessionTab = 'upcoming' | 'live' | 'history';

export default function VideoSessionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<SessionTab>('upcoming');

  const { data: sessions, isLoading, error } = useQuery({
    queryKey: ['client-video-sessions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sessions')
        .select('*, consultants!sessions_consultant_id_fkey(id, user_id, hourly_rate)')
        .eq('client_id', user.id)
        .eq('session_type', 'video')
        .order('scheduled_at', { ascending: false });

      if (error) throw error;

      const consultantUserIds = [...new Set(
        (data || []).map((s: any) => s.consultants?.user_id).filter(Boolean)
      )];

      let profileMap: Record<string, { name: string; avatar?: string }> = {};
      if (consultantUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profile_directory')
          .select('user_id, display_name, avatar_url')
          .in('user_id', consultantUserIds);

        if (profiles) {
          profileMap = Object.fromEntries(
            profiles.map(p => [p.user_id, { name: p.display_name || 'Consultant', avatar: p.avatar_url || undefined }])
          );
        }
      }

      return (data || []).map((s: any) => ({
        ...s,
        consultant_name: profileMap[s.consultants?.user_id]?.name || 'Unknown Consultant',
        consultant_avatar: profileMap[s.consultants?.user_id]?.avatar,
      }));
    },
  });

  const now = new Date();
  const upcoming = (sessions || []).filter(
    (s: any) => s.status === 'scheduled' && s.scheduled_at && (isFuture(new Date(s.scheduled_at)) || isToday(new Date(s.scheduled_at)))
  );
  const live = (sessions || []).filter((s: any) => s.status === 'in_progress');
  const history = (sessions || []).filter(
    (s: any) => s.status === 'completed' || s.status === 'cancelled' || (s.status === 'scheduled' && s.scheduled_at && isPast(new Date(s.scheduled_at)))
  );

  const tabData: Record<SessionTab, any[]> = { upcoming, live, history };
  const currentSessions = tabData[tab];

  const renderSession = (session: any) => {
    const status = statusConfig[session.status] || statusConfig.scheduled;
    const StatusIcon = status.icon;

    return (
      <Card
        key={session.id}
        className="rounded-2xl border-border/50 hover:border-primary/30 hover:shadow-md transition-all cursor-pointer group"
        onClick={() => navigate(`/client/sessions/${session.id}`)}
      >
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {/* Video icon */}
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                session.status === 'in_progress'
                  ? 'bg-green-500/10 ring-2 ring-green-500/30'
                  : 'bg-primary/10'
              }`}>
                {session.status === 'in_progress' ? (
                  <Radio className="w-5 h-5 text-green-600" />
                ) : (
                  <Video className="w-5 h-5 text-primary" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                {/* Status + Duration */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`text-[10px] border-0 ${status.className}`}>
                    <StatusIcon className="w-3 h-3 me-1" />
                    {status.label}
                  </Badge>
                  {session.duration_minutes > 0 && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      {session.duration_minutes} min
                    </span>
                  )}
                </div>

                {/* Consultant */}
                <p className="text-sm font-semibold text-foreground mt-1.5 flex items-center gap-1.5 truncate">
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  {session.consultant_name}
                </p>

                {/* Schedule */}
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  {session.scheduled_at
                    ? format(new Date(session.scheduled_at), 'EEE, MMM d · h:mm a')
                    : 'Not scheduled'}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="shrink-0">
              {session.status === 'in_progress' && (
                <Button size="sm" className="gradient-primary border-0 gap-1.5 shadow-lg">
                  <Play className="w-3.5 h-3.5" /> Join Now
                </Button>
              )}
              {session.status === 'scheduled' && (
                <Button size="sm" variant="outline" className="gap-1.5 group-hover:border-primary/50">
                  Details <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
              {(session.status === 'completed' || session.status === 'cancelled') && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
                  View <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Video Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage all your video consultations — upcoming, live, and past.
        </p>
      </div>

      {/* Stats Row */}
      {sessions && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="rounded-xl border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{upcoming.length}</p>
                <p className="text-xs text-muted-foreground">Upcoming</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Radio className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{live.length}</p>
                <p className="text-xs text-muted-foreground">Live Now</p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <History className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{history.length}</p>
                <p className="text-xs text-muted-foreground">Past</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as SessionTab)}>
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="upcoming" className="rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <Calendar className="w-3.5 h-3.5" /> Upcoming
            {upcoming.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5 ms-1">{upcoming.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="live" className="rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <Radio className="w-3.5 h-3.5" /> Live
            {live.length > 0 && (
              <Badge className="text-[9px] h-4 px-1.5 ms-1 bg-green-500 text-white border-0">{live.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <History className="w-3.5 h-3.5" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          ) : error ? (
            <Card className="rounded-2xl border-destructive/50">
              <CardContent className="p-6 text-center">
                <p className="text-sm text-destructive">Please log in to view your video sessions.</p>
                <Button variant="outline" className="mt-3" onClick={() => navigate('/login')}>
                  Go to Login
                </Button>
              </CardContent>
            </Card>
          ) : currentSessions.length === 0 ? (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-12 text-center">
                <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-foreground">
                  {tab === 'upcoming' && 'No upcoming video sessions'}
                  {tab === 'live' && 'No live sessions right now'}
                  {tab === 'history' && 'No past video sessions'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {tab === 'upcoming' && 'Schedule a session with a consultant to get started.'}
                  {tab === 'live' && 'Active sessions will appear here when they start.'}
                  {tab === 'history' && 'Your completed sessions will appear here.'}
                </p>
                {tab === 'upcoming' && (
                  <Button className="gradient-primary border-0 mt-4" onClick={() => navigate('/client/consultants')}>
                    Browse Consultants
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {currentSessions.map(renderSession)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
