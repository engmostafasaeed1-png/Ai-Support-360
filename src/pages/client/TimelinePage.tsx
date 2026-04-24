import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Activity, Ticket as TicketIcon, UserCheck, CalendarCheck, Video,
  CheckCircle2, Circle, Clock, ArrowRight, Search, Sparkles, PlayCircle,
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
  timestamp?: string;
  detail?: string;
  href?: string;
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
  const completedSession = t.sessions.find(s => s.status === 'completed');

  const isResolved = !!t.resolved_at || t.status === 'resolved' || t.status === 'closed';
  const hasConsultant = !!t.consultant_id || !!acceptedMatch;
  const hasBooking = !!upcomingSession || !!liveSession || !!completedSession || !!t.interview?.scheduled_at;
  const hasSession = !!liveSession || !!completedSession;

  return [
    {
      key: 'created',
      label: 'Ticket Created',
      icon: TicketIcon,
      state: 'done',
      timestamp: t.created_at,
      detail: `${t.sap_module} · ${t.urgency ?? 'medium'}`,
      href: `/client/tickets/${t.id}`,
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
      detail: liveSession
        ? 'Session in progress'
        : completedSession?.duration_minutes
        ? `${completedSession.duration_minutes}