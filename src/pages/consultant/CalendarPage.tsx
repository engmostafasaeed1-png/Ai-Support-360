import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Video, MessageSquare, Monitor, CheckCircle, Clock, CalendarClock, AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import SetAvailabilityDialog from '@/components/consultant/SetAvailabilityDialog';
import RescheduleSessionDialog from '@/components/consultant/RescheduleSessionDialog';
import MeetingLinkButton, { detectProvider } from '@/components/session/MeetingLinkButton';
import { sessionRoomUrl } from '@/lib/meetingRoom';
import { friendlyErrorMessage } from '@/lib/friendlyError';
import { canComplete, groupOf } from '@/lib/sessionTiming';

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

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const oneDateLabel = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

interface SessionData {
  id: string;
  session_type: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  client_name: string;
  meeting_url: string | null;
}

interface SlotRow {
  id: string;
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  is_recurring: boolean | null;
  specific_date: string | null;
}

function SessionCard({ s, now, onChanged }: { s: SessionData; now: number; onChanged: () => void }) {
  const Icon = typeIcons[s.session_type] || Video;
  const time = new Date(s.scheduled_at);
  const group = groupOf(s, now);
  const [busy, setBusy] = useState<'complete' | 'cancel' | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const savedUrl = s.meeting_url ?? '';

  const complete = async () => {
    setBusy('complete');
    try {
      const { error } = await supabase.rpc('complete_session', { _session_id: s.id });
      if (error) throw error;
      toast.success('The session is marked as completed. The client can rate it now.');
      onChanged();
    } catch (err) {
      toast.error('The session could not be marked as completed', { description: friendlyErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      const { error } = await supabase.from('sessions').update({ status: 'cancelled' }).eq('id', s.id);
      if (error) throw error;
      toast.success('The session is cancelled.');
      onChanged();
    } catch (err) {
      toast.error('The session could not be cancelled', { description: friendlyErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const showComplete = canComplete(s, now);

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${group === 'to_close' ? 'bg-amber-50/60 border-amber-300/50 dark:bg-amber-950/10' : 'bg-muted/20 border-border/30 hover:border-accent/30'}`}
      data-testid={`session-${group}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${group === 'completed' ? 'bg-green-100' : 'bg-accent/10'}`}>
            <Icon className={`w-5 h-5 ${group === 'completed' ? 'text-green-600' : 'text-accent'}`} />
          </div>
          <div>
            <p className="font-medium text-sm text-foreground">{s.client_name}</p>
            <p className="text-xs text-muted-foreground capitalize">{s.session_type.replace('_', ' ')}</p>
          </div>
        </div>
        <Badge variant="secondary" className={`text-[10px] ${statusStyle[s.status] ?? ''}`}>
          {s.status}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span>{time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
        <span>{s.duration_minutes} min</span>
      </div>

      {group === 'to_close' && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This session is over but still open. Mark it as completed if it took place, or cancel it if it did not.
        </p>
      )}

      {(group === 'upcoming' || group === 'to_close') && (
        <div className="flex flex-wrap gap-2 mt-3">
          {group === 'upcoming' &&
            (s.session_type === 'chat' ? (
              <Button asChild size="sm" className="gradient-primary border-0 flex-1 text-xs h-8">
                <Link to={`/consultant/chat/${s.id}`}>Open chat</Link>
              </Button>
            ) : (
              <MeetingLinkButton
                url={savedUrl}
                fallbackUrl={sessionRoomUrl(s.id)}
                fallbackRoomId={s.id}
                sessionId={s.id}
                provider={detectProvider(savedUrl || sessionRoomUrl(s.id))}
                size="sm"
                className="gradient-primary border-0 flex-1 text-xs h-8 gap-1.5"
                joinLabel="Join Session"
              />
            ))}
          {group === 'upcoming' && (
            <Button size="sm" variant="outline" className="flex-1 text-xs h-8" onClick={() => setRescheduleOpen(true)}>
              Reschedule
            </Button>
          )}
          {showComplete && (
            <Button size="sm" variant="outline" className="flex-1 text-xs h-8 gap-1" onClick={complete} disabled={busy !== null}>
              {busy === 'complete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Mark completed
            </Button>
          )}
          {group === 'to_close' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="flex-1 text-xs h-8" disabled={busy !== null}>
                  It did not take place
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
                  <AlertDialogDescription>The session did not take place. It is marked as cancelled and the client is told.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No, keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={cancel}>Yes, cancel it</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      <RescheduleSessionDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        sessionId={s.id}
        scheduledAt={s.scheduled_at}
        onDone={onChanged}
      />
    </div>
  );
}

export default function CalendarPage() {
  const weekDates = getWeekDates();
  const today = new Date();
  const now = Date.now();
  const queryClient = useQueryClient();
  const [consultantId, setConsultantId] = useState<string | null>(null);

  const { data: slots = [] } = useQuery({
    queryKey: ['my-availability-slots', consultantId],
    enabled: !!consultantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('id, day_of_week, start_time, end_time, is_recurring, specific_date')
        .eq('consultant_id', consultantId!)
        .order('day_of_week').order('start_time');
      if (error) throw error;
      return (data ?? []) as SlotRow[];
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
        .select('id, session_type, status, scheduled_at, duration_minutes, client_id, meeting_url')
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
        duration_minutes: s.duration_minutes || 60,
        client_name: clientMap[s.client_id] || 'Client',
        meeting_url: s.meeting_url ?? null,
      }));
    },
  });

  const refreshSessions = () => queryClient.invalidateQueries({ queryKey: ['consultant-calendar-sessions'] });

  const upcoming = sessions.filter((s) => groupOf(s, now) === 'upcoming');
  const toClose = sessions.filter((s) => groupOf(s, now) === 'to_close');
  const completed = sessions.filter((s) => groupOf(s, now) === 'completed').slice().reverse();
  const today0 = todayKey();
  // weekly hours, and one-date windows that are today or later
  const shownSlots = slots.filter((s) => !s.specific_date || s.specific_date >= today0);

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
                if (s.status === 'cancelled') return false;
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
            My Availability ({shownSlots.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shownSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No time slots yet. Click "Set Availability" to add your weekly hours or a single date.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {shownSlots.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-border/50 px-3 py-2">
                  <span className="text-sm">
                    <span className="font-semibold">
                      {s.specific_date ? oneDateLabel(s.specific_date) : s.day_of_week != null ? fullDays[s.day_of_week] : 'One-off'}
                    </span>{' '}
                    {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                    {s.specific_date && <span className="ms-1 text-[10px] text-muted-foreground">(one date)</span>}
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
          <div className="space-y-6">
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
                  upcoming.map((s) => <SessionCard key={s.id} s={s} now={now} onChanged={refreshSessions} />)
                )}
              </CardContent>
            </Card>

            {/* Over but still open */}
            {toClose.length > 0 && (
              <Card className="rounded-2xl border-amber-300/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Past sessions to close ({toClose.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {toClose.map((s) => <SessionCard key={s.id} s={s} now={now} onChanged={refreshSessions} />)}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Completed */}
          <Card className="rounded-2xl border-border/50 self-start">
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
                completed.map((s) => <SessionCard key={s.id} s={s} now={now} onChanged={refreshSessions} />)
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
