import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Video, MessageSquare, Monitor, CheckCircle, Clock, CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import SetAvailabilityDialog from '@/components/consultant/SetAvailabilityDialog';

const typeIcons: Record<string, typeof Video> = { video: Video, chat: MessageSquare, screen_share: Monitor };
const statusStyle: Record<string, string> = {
  scheduled: 'bg-accent/10 text-accent',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-muted text-muted-foreground',
};

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getWeekDates() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

interface SessionData {
  id: string;
  session_type: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  client_name: string;
}

export default function CalendarPage() {
  const weekDates = getWeekDates();
  const today = new Date();
  const [consultantId, setConsultantId] = useState<string | null>(null);

  const { data: slots = [] } = useQuery({
    queryKey: ['my-availability-slots', consultantId],
    enabled: !!consultantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('id, day_of_week, start_time, end_time')
        .eq('consultant_id', consultantId!)
        .order('day_of_week').order('start_time');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['consultant-calendar-sessions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!consultant) return [];

      const { data, error } = await supabase
        .from('sessions')
        .select('id, session_type, status, scheduled_at, duration_minutes, client_id')
        .eq('consultant_id', consultant.id)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      setConsultantId(consultant.id);

      // Get client names
      const clientIds = [...new Set((data || []).map(s => s.client_id))];
      let clientMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profile_directory')
          .select('user_id, display_name')
          .in('user_id', clientIds);
        if (profiles) {
          clientMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'Client']));
        }
      }

      return (data || []).map((s): SessionData => ({
        id: s.id,
        session_type: s.session_type || 'chat',
        status: s.status || 'scheduled',
        scheduled_at: s.scheduled_at || new Date().toISOString(),
        duration_minutes: s.duration_minutes || 30,
        client_name: clientMap[s.client_id] || 'Client',
      }));
    },
  });

  const upcoming = sessions.filter((s) => s.status === 'scheduled');
  const completed = sessions.filter((s) => s.status === 'completed');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Session Calendar</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Manage your upcoming and past sessions.</p>
        </div>
        <SetAvailabilityDialog
          trigger={<Button className="gradient-primary border-0 w-full sm:w-auto" size="sm">Set Availability</Button>}
        />
      </div>

      {/* Week View */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-5">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {weekDates.map((date, i) => {
              const isToday = date.toDateString() === today.toDateString();
              const daySessions = sessions.filter((s) => {
                const sd = new Date(s.scheduled_at);
                return sd.toDateString() === date.toDateString();
              });
              return (
                <div
                  key={i}
                  className={`text-center p-1.5 sm:p-3 rounded-xl transition-all ${isToday ? 'bg-accent/10 border border-accent/30' : 'bg-muted/30'}`}
                >
                  <div className="text-xs text-muted-foreground mb-1">{days[i]}</div>
                  <div className={`text-sm sm:text-lg font-bold ${isToday ? 'text-accent' : 'text-foreground'}`}>{date.getDate()}</div>
                  {daySessions.length > 0 && (
                    <div className="mt-2 flex justify-center gap-1">
                      {daySessions.map((_, j) => (
                        <span key={j} className="w-1.5 h-1.5 rounded-full bg-accent" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* My Availability */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-accent" />
            My Availability ({slots.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No time slots yet. Click "Set Availability" to add your weekly hours.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {slots.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2">
                  <span className="text-sm">
                    <span className="font-semibold">{s.day_of_week != null ? fullDays[s.day_of_week] : 'One-off'}</span>{' '}
                    {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid lg:grid-cols-2 gap-6">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Upcoming */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-accent" />
                Upcoming Sessions ({upcoming.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No upcoming sessions scheduled.</p>
              ) : (
                upcoming.map((s) => {
                  const Icon = typeIcons[s.session_type] || Video;
                  const time = new Date(s.scheduled_at);
                  return (
                    <div key={s.id} className="p-4 rounded-xl bg-muted/20 border border-border/30 hover:border-accent/30 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-accent" />
                          </div>
                          <div>
                            <p className="font-medium text-sm text-foreground">{s.client_name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{s.session_type.replace('_', ' ')}</p>
                          </div>
                        </div>
                        <Badge variant="secondary" className={`text-[10px] ${statusStyle[s.status]}`}>
                          {s.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        <span>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>{s.duration_minutes} min</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" className="gradient-primary border-0 flex-1 text-xs h-8">Join Session</Button>
                        <Button size="sm" variant="outline" className="flex-1 text-xs h-8">Reschedule</Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Completed */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Completed Sessions ({completed.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {completed.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No completed sessions yet.</p>
              ) : (
                completed.map((s) => {
                  const Icon = typeIcons[s.session_type] || Video;
                  const time = new Date(s.scheduled_at);
                  return (
                    <div key={s.id} className="p-4 rounded-xl bg-muted/20 border border-border/30">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                          <Icon className="w-5 h-5 text-green-600" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm text-foreground">{s.client_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {s.duration_minutes} min
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">completed</Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
