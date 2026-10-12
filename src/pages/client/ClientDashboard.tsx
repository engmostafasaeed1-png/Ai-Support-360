import ClientCollaborationRatingCard from '@/components/client/ClientCollaborationRatingCard';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import {
  Briefcase, Clock, CreditCard, CheckCircle, TrendingUp,
  ChevronRight, Star, BadgeCheck, Zap, TicketPlus, Users,
  Calendar, DollarSign, Video, MessageSquare, Monitor, Award, ExternalLink,
  ArrowUpRight, ArrowDownRight, Activity, Target, Shield, Flame,
} from 'lucide-react';
import { subDays, isSameDay, format } from 'date-fns';
import { PullToRefresh } from '@/components/PullToRefresh';
import OnboardingProgressCard from '@/components/onboarding/OnboardingProgressCard';
import WelcomeBanner from '@/components/onboarding/WelcomeBanner';
import EmailVerificationBanner from '@/components/onboarding/EmailVerificationBanner';
import { useClientBidSummary } from '@/hooks/useClientBids';
import { useClientTickets } from '@/hooks/useClientTickets';
import { useClientSessions } from '@/hooks/useClientSessions';
import { useClientPayments } from '@/hooks/useClientPayments';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockClientProfile, mockRecommendedConsultants } from '@/data/clientMockData';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Sparkline } from '@/components/ui/sparkline';
import { StatusDot } from '@/components/ui/status-dot';
import AIInsightsButton from '@/components/ai/AIInsightsButton';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import ContextFitBadges from '@/components/client/ContextFitBadges';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  under_review: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  matched: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  waiting_for_client: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  closed: 'bg-muted text-muted-foreground',
};

const activityIcons: Record<string, typeof Briefcase> = {
  ticket: Briefcase,
  calendar: Calendar,
  match: Users,
  payment: DollarSign,
  resolved: CheckCircle,
};

const badgeConfig: Record<string, { icon: typeof Star; color: string }> = {
  verified: { icon: BadgeCheck, color: 'text-accent' },
  top_rated: { icon: Star, color: 'text-yellow-500' },
  fast_responder: { icon: Zap, color: 'text-green-500' },
};

export default function ClientDashboard() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = "Dashboard — AI Support 360";
    return () => { document.title = "AI Support 360"; };
  }, []);
  const { isGuest } = useGuestMode();
  const { profile: userProfile } = useUserProfile();
  const { data: tickets = [], isLoading: ticketsLoading } = useClientTickets();
  const { data: bidCounts } = useClientBidSummary(tickets.map((t: any) => t.id));
  const { data: sessions = [], isLoading: sessionsLoading } = useClientSessions();
  const { data: payments = [], isLoading: paymentsLoading } = useClientPayments();
  const { data: activities = [] } = useActivityFeed();
  const { consultants: realtimeConsultants } = useRealtimeConsultants();

  const displayName = isGuest ? mockClientProfile.display_name : (userProfile?.displayName || 'User');
  const company = isGuest ? mockClientProfile.company : '';

  const openTickets = useMemo(() => tickets.filter((t: any) => t.status !== 'resolved' && t.status !== 'closed'), [tickets]);
  const pendingPayments = useMemo(() => payments.filter((p: any) => p.status === 'pending'), [payments]);
  // a session whose time is over is not upcoming, whatever its stored status says
  const activeSessions = useMemo(() => {
    const now = Date.now();
    return sessions.filter((s: any) => s.status === 'scheduled' && new Date(s.scheduled_at).getTime() + (s.duration_minutes || 30) * 60000 > now);
  }, [sessions]);
  const resolvedCount = useMemo(() => tickets.filter((t: any) => t.status === 'resolved').length, [tickets]);
  const pendingTotal = useMemo(() => pendingPayments.reduce((a: number, p: any) => a + p.amount, 0), [pendingPayments]);
  const totalTickets = tickets.length;
  const resolutionRate = totalTickets > 0 ? Math.round((resolvedCount / totalTickets) * 100) : 0;

  const recommendedConsultants = useMemo(() => isGuest ? mockRecommendedConsultants : (
    realtimeConsultants.slice(0, 6).map(c => ({
      ...c, avatar: c.name.split(' ').map(w => w[0]).join('').slice(0, 2),
      reviews: c.reviews || 0, badges: c.badges || [], credlyVerified: c.credlyVerified,
      credibility_credits: c.credibility_credits, ai_interview_badge: c.ai_interview_badge,
    }))
  ), [realtimeConsultants, isGuest]);

  const ticketSpark = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    tickets.filter((t: any) => isSameDay(new Date(t.created_at), subDays(new Date(), 6 - i))).length
  ), [tickets]);
  const sessionSpark = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    sessions.filter((s: any) => isSameDay(new Date(s.scheduled_at), subDays(new Date(), 6 - i))).length
  ), [sessions]);
  const paymentSpark = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    payments.filter((p: any) => isSameDay(new Date(p.date || p.created_at), subDays(new Date(), 6 - i))).reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  ), [payments]);

  const isLoading = ticketsLoading || sessionsLoading || paymentsLoading;

  const kpis = useMemo(() => [
    {
      labelKey: 'client_dashboard.open_tickets', value: openTickets.length, prefix: '',
      icon: Briefcase, sparkData: ticketSpark, link: '/client/tickets',
      color: 'hsl(var(--accent))', trend: openTickets.length > 3 ? 'up' : 'down',
      trendValue: openTickets.length > 0 ? `${openTickets.length} active` : 'All clear',
      description: 'Tickets awaiting resolution',
    },
    {
      labelKey: 'client_dashboard.active_sessions', value: activeSessions.length, prefix: '',
      icon: Calendar, sparkData: sessionSpark, link: '/client/sessions',
      color: 'hsl(142, 71%, 45%)', trend: 'up', trendValue: `${activeSessions.length} scheduled`,
      description: 'Upcoming consultations',
    },
    {
      labelKey: 'client_dashboard.pending_payments', value: pendingTotal, prefix: '$',
      icon: CreditCard, sparkData: paymentSpark, link: '/client/payments',
      color: 'hsl(38, 92%, 50%)', trend: pendingTotal > 0 ? 'up' : 'neutral',
      trendValue: pendingTotal > 0 ? 'Due soon' : 'Settled',
      description: 'Outstanding balance',
    },
    {
      labelKey: 'client_dashboard.resolved', value: resolvedCount, prefix: '',
      icon: CheckCircle, sparkData: [] as number[], link: '/client/tickets',
      color: 'hsl(142, 71%, 45%)', trend: 'up', trendValue: `${resolutionRate}% rate`,
      description: 'Successfully closed tickets',
    },
  ], [openTickets.length, activeSessions.length, pendingTotal, resolvedCount, ticketSpark, sessionSpark, paymentSpark, resolutionRate]);

  return (
    <PullToRefresh>
    <div className="space-y-6">
      <WelcomeBanner />
      <EmailVerificationBanner />
      <OnboardingProgressCard role="client" />

      {/* Hero Welcome Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary/90 to-accent/80 p-6 md:p-8 text-primary-foreground">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDE4YzAtOS45NC04LjA2LTE4LTE4LTE4UzAgOC4wNiAwIDE4czguMDYgMTggMTggMTggMTgtOC4wNiAxOC0xOHoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-primary-foreground/70 text-sm font-medium mb-1">
              {format(new Date(), 'EEEE, MMMM d, yyyy')}
            </p>
            <h1 className="text-2xl md:text-3xl font-bold">
              {t('client_dashboard.title')}, {displayName.split(' ')[0]} 👋
            </h1>
            {company && (
              <p className="text-primary-foreground/80 mt-1 text-sm">{company} · {t('client_dashboard.subtitle')}</p>
            )}
            <p className="text-primary-foreground/60 mt-2 text-xs max-w-lg">
              Track your support tickets, manage sessions, and connect with SAP experts — all from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <AIInsightsButton role="client" metrics={{ openTickets: openTickets.length, resolvedTickets: resolvedCount, activeSessions: activeSessions.length, pendingPayments: pendingTotal, totalTickets: tickets.length }} className="bg-white/10 border-white/25 text-white hover:bg-white/20 hover:text-white" />
            <Link to="/client/new-request">
              <Button className="bg-white/20 backdrop-blur-sm border border-white/20 text-white hover:bg-white/30 shadow-lg" size="sm">
                <TicketPlus className="w-4 h-4 me-1" /> {t('client_dashboard.new_request')}
              </Button>
            </Link>
            <Link to="/client/consultants">
              <Button variant="outline" size="sm" className="bg-white/10 border-white/25 text-white hover:bg-white/20 hover:text-white">
                <Users className="w-4 h-4 me-1" /> {t('consultants_page.title')}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-fade">
        {kpis.map((kpi, i) => (
          <Link key={i} to={kpi.link}>
            <Card className="rounded-2xl border-border/50 card-interactive group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.04] -translate-y-8 translate-x-8" style={{ background: kpi.color }} />
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${kpi.color}15` }}>
                    <kpi.icon className="w-5 h-5" style={{ color: kpi.color }} />
                  </div>
                  <Sparkline data={kpi.sparkData} color={kpi.color} width={64} height={22} />
                </div>
                {isLoading ? (
                  <Skeleton className="h-9 w-20" />
                ) : (
                  <div className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
                    <AnimatedCounter value={kpi.value} prefix={kpi.prefix} />
                  </div>
                )}
                <div className="text-xs font-medium text-muted-foreground mt-1">{t(kpi.labelKey)}</div>
                <div className="flex items-center gap-1 mt-2">
                  {kpi.trend === 'up' ? (
                    <ArrowUpRight className="w-3 h-3 text-green-500" />
                  ) : kpi.trend === 'down' ? (
                    <ArrowDownRight className="w-3 h-3 text-accent" />
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">{kpi.trendValue}</span>
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{kpi.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Resolution Health Bar */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                <Target className="w-5 h-5 text-green-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-foreground">Resolution Rate</span>
                  <span className="text-sm font-bold text-foreground">{resolutionRate}%</span>
                </div>
                <Progress value={resolutionRate} className="h-2" />
                <p className="text-[10px] text-muted-foreground mt-1">{resolvedCount} of {totalTickets} tickets resolved</p>
              </div>
            </div>
            <div className="flex gap-4 shrink-0">
              <div className="text-center">
                <div className="text-lg font-bold text-foreground">{openTickets.length}</div>
                <div className="text-[10px] text-muted-foreground">Open</div>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <div className="text-lg font-bold text-foreground">{activeSessions.length}</div>
                <div className="text-[10px] text-muted-foreground">Sessions</div>
              </div>
              <div className="w-px bg-border" />
              <div className="text-center">
                <div className="text-lg font-bold text-green-500">{resolvedCount}</div>
                <div className="text-[10px] text-muted-foreground">Resolved</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Recent Tickets */}
        <Card className="lg:col-span-2 rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-accent" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">{t('tickets_page.title')}</CardTitle>
                <p className="text-[10px] text-muted-foreground">{openTickets.length} open · {resolvedCount} resolved</p>
              </div>
            </div>
            <Link to="/client/tickets">
              <Button variant="ghost" size="sm" className="text-xs group">{t('client_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {ticketsLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
            ) : tickets.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
                  <Briefcase className="w-6 h-6 text-accent" />
                </div>
                <p className="text-sm font-medium text-foreground">No tickets yet</p>
                <p className="text-xs text-muted-foreground mt-1">Create your first support request to get started</p>
                <Link to="/client/new-request">
                  <Button size="sm" className="mt-3 gradient-primary border-0" variant="default">
                    <TicketPlus className="w-3 h-3 me-1" /> New Request
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="stagger-fade space-y-2">
                {tickets.slice(0, 5).map((ticket: any) => (
                  <Link key={ticket.id} to={`/client/tickets/${ticket.id}${bidCounts?.get(ticket.id) ? '?tab=bids' : ''}`} className="block">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 rounded-xl bg-muted/20 border border-border/30 card-interactive group sm:flex-nowrap">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{
                        background: ticket.urgency === 'critical' ? 'hsl(0, 84%, 60%, 0.1)' :
                          ticket.urgency === 'high' ? 'hsl(25, 95%, 53%, 0.1)' :
                          'hsl(var(--accent) / 0.1)'
                      }}>
                        {ticket.urgency === 'critical' ? <Flame className="w-4 h-4 text-red-500" /> :
                         ticket.urgency === 'high' ? <Activity className="w-4 h-4 text-orange-500" /> :
                         <Briefcase className="w-4 h-4 text-accent" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">{ticket.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border/50">{ticket.sap_module}</Badge>
                          {(bidCounts?.get(ticket.id) || 0) > 0 && <span className="text-warning">{bidCounts?.get(ticket.id)} bids to review</span>}
                          {ticket.consultant && (
                            <span className="truncate">→ {ticket.consultant}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex w-full items-center gap-2 ps-[3.25rem] sm:w-auto sm:shrink-0 sm:ps-0">
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
                          {ticket.urgency}
                        </Badge>
                        <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>
                          {ticket.status.replace(/_/g, ' ')}
                        </Badge>
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <Activity className="w-4 h-4 text-accent" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">{t('client_dashboard.recent_activity')}</CardTitle>
                <p className="text-[10px] text-muted-foreground">Latest updates & changes</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {activities.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-3">
                  <Activity className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">No activity yet</p>
                <p className="text-xs text-muted-foreground mt-1">Your recent actions will appear here</p>
              </div>
            ) : (
              <div className="stagger-fade space-y-1 relative">
                <div className="absolute start-[15px] top-4 bottom-4 w-px bg-border/50" />
                {activities.map((activity: any, idx: number) => {
                  const Icon = activityIcons[activity.icon] || Briefcase;
                  return (
                    <div key={activity.id} className="flex items-start gap-3 group relative p-2 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center shrink-0 z-10 group-hover:border-accent/50 transition-colors">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-xs text-foreground leading-snug">{activity.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{activity.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Sessions */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-green-500" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{t('consultant_dashboard.upcoming_sessions')}</CardTitle>
              <p className="text-[10px] text-muted-foreground">{activeSessions.length} session{activeSessions.length !== 1 ? 's' : ''} scheduled</p>
            </div>
          </div>
          <Link to="/client/sessions">
            <Button variant="ghost" size="sm" className="text-xs group">{t('client_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="grid md:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-sm font-medium text-foreground">No sessions scheduled</p>
              <p className="text-xs text-muted-foreground mt-1">Open a request to get started: sessions are scheduled with the consultant assigned to it</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 stagger-fade">
              {activeSessions.slice(0, 4).map((session: any) => {
                const typeIcons: Record<string, typeof Video> = { video: Video, chat: MessageSquare, screen_share: Monitor };
                const TypeIcon = typeIcons[session.session_type] || Video;
                const time = new Date(session.scheduled_at);
                const isToday = isSameDay(time, new Date());
                return (
                  <Link key={session.id} to={`/client/sessions/${session.id}`} className="block">
                    <div className="p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive relative overflow-hidden">
                      {isToday && (
                        <div className="absolute top-2 end-2">
                          <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px]">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse me-1" />
                            Today
                          </Badge>
                        </div>
                      )}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                          <TypeIcon className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{session.consultant}</p>
                          <p className="text-xs text-muted-foreground capitalize">{session.session_type.replace('_', ' ')} · {session.duration_minutes} min</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3 truncate">{session.ticket_title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">
                          {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <Button size="sm" className="gradient-primary border-0 text-xs h-7">{t('consultant_dashboard.join_session')}</Button>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommended Consultants */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-purple-500" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{t('client_dashboard.recommended_consultants')}</CardTitle>
              <p className="text-[10px] text-muted-foreground">Matched to your SAP environment</p>
            </div>
          </div>
          <Link to="/client/consultants">
            <Button variant="ghost" size="sm" className="text-xs group">{t('client_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recommendedConsultants.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-purple-500" />
              </div>
              <p className="text-sm font-medium text-foreground">Nothing here yet</p>
              <p className="text-xs text-muted-foreground mt-1">Recommended consultants will appear here once matches are available.</p>
            </div>
          ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-fade">
            {recommendedConsultants.map((c: any) => (
              <Link key={c.id} to={`/client/consultants/${c.id}`} className="block">
              <div className="p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive flex flex-col group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 rounded-full bg-accent/5 -translate-y-6 translate-x-6" />
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative">
                    <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                      {c.avatar}
                    </div>
                    <StatusDot status="online" size="sm" pulse className="absolute -bottom-0.5 -end-0.5 ring-2 ring-background" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">{c.name}</h4>
                    <p className="text-xs text-muted-foreground truncate">{c.specialty}</p>
                  </div>
                </div>
                <ContextFitBadges fit={c} className="mb-2" />

                <div className="flex items-center gap-1 mb-2">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-semibold text-foreground">{c.rating}</span>
                  <span className="text-xs text-muted-foreground">({c.reviews})</span>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {c.credlyVerified && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      <Award className="w-2.5 h-2.5" />
                      Credly
                    </span>
                  )}
                  {(c.badges || []).slice(0, 2).map((badge: string) => {
                    const config = badgeConfig[badge];
                    if (!config) return null;
                    const BIcon = config.icon;
                    return (
                      <span key={badge} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted">
                        <BIcon className={`w-2.5 h-2.5 ${config.color}`} />
                        {badge.replace('_', ' ')}
                      </span>
                    );
                  })}
                </div>
                <TrustBadge badge={(c as any).ai_interview_badge} credits={(c as any).credibility_credits} className="mb-2" />

                <div className="mt-auto flex items-center justify-between pt-2 border-t border-border/30">
                  <div>
                    <span className="text-base font-bold text-foreground">${c.rate}</span>
                    <span className="text-xs text-muted-foreground">/hr</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-accent/30 text-accent">
                    {c.matchScore}% match
                  </Badge>
                </div>
              </div>
              </Link>
            ))}
          </div>
          )}
        </CardContent>
      </Card>

      {!isGuest && <ClientCollaborationRatingCard />}

      {/* Quick Access Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Monitor, label: 'VM Console', desc: 'Power & Monitor', link: '/client/vmware-console', color: 'text-primary' },
          { icon: CreditCard, label: 'VM Pricing', desc: 'Plans & Billing', link: '/client/vmware-pricing', color: 'text-accent' },
          { icon: Shield, label: 'Remote Access', desc: 'Secure connect', link: '/client/remote-access', color: 'text-green-500' },
          { icon: TrendingUp, label: 'Reports', desc: 'Analytics', link: '/client/reports', color: 'text-purple-500' },
        ].map((item) => (
          <Link key={item.label} to={item.link}>
            <Card className="rounded-2xl border-border/50 card-interactive group">
              <CardContent className="p-4 text-center">
                <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                  <item.icon className={`w-5 h-5 ${item.color}`} />
                </div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-[10px] text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
    </PullToRefresh>
  );
}
