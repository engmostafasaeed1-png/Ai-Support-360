import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import {
  Briefcase, Clock, CreditCard, CheckCircle, TrendingUp,
  ChevronRight, Star, BadgeCheck, Zap, TicketPlus, Users,
  Calendar, DollarSign, Video, MessageSquare, Monitor, Award, ExternalLink,
} from 'lucide-react';
import { subDays, isSameDay } from 'date-fns';
import { PullToRefresh } from '@/components/PullToRefresh';
import OnboardingProgressCard from '@/components/onboarding/OnboardingProgressCard';
import WelcomeBanner from '@/components/onboarding/WelcomeBanner';
import EmailVerificationBanner from '@/components/onboarding/EmailVerificationBanner';
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
    document.title = "Dashboard — Qurtuba Talks";
    return () => { document.title = "Qurtuba Talks"; };
  }, []);
  const { isGuest } = useGuestMode();
  const { profile: userProfile } = useUserProfile();
  const { data: tickets = [], isLoading: ticketsLoading } = useClientTickets();
  const { data: sessions = [], isLoading: sessionsLoading } = useClientSessions();
  const { data: payments = [], isLoading: paymentsLoading } = useClientPayments();
  const { data: activities = [] } = useActivityFeed();
  const { consultants: realtimeConsultants } = useRealtimeConsultants();

  const displayName = isGuest ? mockClientProfile.display_name : (userProfile?.displayName || 'User');
  const company = isGuest ? mockClientProfile.company : '';

  const openTickets = tickets.filter((t: any) => t.status !== 'resolved' && t.status !== 'closed');
  const pendingPayments = payments.filter((p: any) => p.status === 'pending');
  const activeSessions = sessions.filter((s: any) => s.status === 'scheduled');
  const resolvedCount = tickets.filter((t: any) => t.status === 'resolved').length;
  const pendingTotal = pendingPayments.reduce((a: number, p: any) => a + p.amount, 0);

  const recommendedConsultants = isGuest ? mockRecommendedConsultants : (
    realtimeConsultants.length > 0 ? realtimeConsultants.slice(0, 6).map(c => ({
      ...c, avatar: c.name.split(' ').map(w => w[0]).join('').slice(0, 2),
      reviews: c.reviews || 0, badges: c.badges || [], credly_username: c.credly_username,
    })) : mockRecommendedConsultants
  );

  const ticketSpark = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    tickets.filter((t: any) => isSameDay(new Date(t.created_at), subDays(new Date(), 6 - i))).length
  ), [tickets]);
  const sessionSpark = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    sessions.filter((s: any) => isSameDay(new Date(s.scheduled_at), subDays(new Date(), 6 - i))).length
  ), [sessions]);
  const paymentSpark = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    payments.filter((p: any) => isSameDay(new Date(p.date || p.created_at), subDays(new Date(), 6 - i))).reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  ), [payments]);

  const kpis = [
    { labelKey: 'client_dashboard.open_tickets', value: openTickets.length, prefix: '', icon: Briefcase, sparkData: ticketSpark, link: '/client/tickets', color: 'hsl(var(--accent))' },
    { labelKey: 'client_dashboard.active_sessions', value: activeSessions.length, prefix: '', icon: Calendar, sparkData: sessionSpark, link: '/client/sessions', color: 'hsl(142, 71%, 45%)' },
    { labelKey: 'client_dashboard.pending_payments', value: pendingTotal, prefix: '$', icon: CreditCard, sparkData: paymentSpark, link: '/client/payments', color: 'hsl(38, 92%, 50%)' },
    { labelKey: 'client_dashboard.resolved', value: resolvedCount, prefix: '', icon: CheckCircle, sparkData: [2, 4, 3, 5, 7, 6, resolvedCount], link: '/client/tickets', color: 'hsl(142, 71%, 45%)' },
  ];

  const isLoading = ticketsLoading || sessionsLoading || paymentsLoading;

  return (
    <PullToRefresh>
    <div className="space-y-6">
      <WelcomeBanner />
      <EmailVerificationBanner />
      <OnboardingProgressCard role="client" />

      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('client_dashboard.title')}, {displayName.split(' ')[0]}</h1>
          {company && <p className="text-sm text-muted-foreground mt-1">{company} · {t('client_dashboard.subtitle')}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <AIInsightsButton role="client" metrics={{ openTickets: openTickets.length, resolvedTickets: resolvedCount, activeSessions: activeSessions.length, pendingPayments: pendingTotal, totalTickets: tickets.length }} />
          <Link to="/client/new-request">
            <Button className="gradient-primary border-0 shadow-premium hover:shadow-glow transition-all" size="sm">
              <TicketPlus className="w-4 h-4 me-1" /> {t('client_dashboard.new_request')}
            </Button>
          </Link>
          <Link to="/client/consultants">
            <Button variant="outline" size="sm" className="hover:border-accent/50 transition-colors">
              <Users className="w-4 h-4 me-1" /> {t('consultants_page.title')}
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-fade">
        {kpis.map((kpi, i) => (
          <Link key={i} to={kpi.link}>
            <Card className="rounded-2xl border-border/50 card-interactive gradient-border">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <kpi.icon className="w-5 h-5 text-accent" />
                  </div>
                  <Sparkline data={kpi.sparkData} color={kpi.color} width={64} height={20} />
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-2xl font-bold text-foreground">
                    <AnimatedCounter value={kpi.value} prefix={kpi.prefix} />
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-1">{t(kpi.labelKey)}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Tickets */}
        <Card className="lg:col-span-2 rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">{t('tickets_page.title')}</CardTitle>
            <Link to="/client/tickets">
              <Button variant="ghost" size="sm" className="text-xs group">{t('client_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {ticketsLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
            ) : tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t('common.no_data', 'No tickets yet')}</p>
            ) : (
              <div className="stagger-fade">
                {tickets.slice(0, 4).map((ticket: any) => (
                  <Link key={ticket.id} to={`/client/tickets/${ticket.id}`} className="block">
                    <div className="flex items-center gap-4 p-3 rounded-xl bg-muted/20 border border-border/30 card-interactive">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-foreground truncate">{ticket.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                          <span>{ticket.sap_module}</span>
                          {ticket.consultant && (
                            <>
                              <span>·</span>
                              <span>{ticket.consultant}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
                          {ticket.urgency}
                        </Badge>
                        <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>
                          {ticket.status.replace(/_/g, ' ')}
                        </Badge>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
            <CardTitle className="text-base font-semibold">{t('client_dashboard.recent_activity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t('common.no_data', 'No activity yet')}</p>
            ) : (
              <div className="stagger-fade space-y-4">
                {activities.map((activity: any) => {
                  const Icon = activityIcons[activity.icon] || Briefcase;
                  return (
                    <div key={activity.id} className="flex items-start gap-3 group">
                      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-accent/20 transition-colors">
                        <Icon className="w-4 h-4 text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground leading-snug">{activity.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">{activity.time}</p>
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
          <CardTitle className="text-base font-semibold">{t('consultant_dashboard.upcoming_sessions')}</CardTitle>
          <Link to="/client/sessions">
            <Button variant="ghost" size="sm" className="text-xs group">{t('client_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="grid md:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">{t('common.no_data', 'No sessions scheduled')}</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 stagger-fade">
              {sessions.slice(0, 4).map((session: any) => {
                const typeIcons: Record<string, typeof Video> = { video: Video, chat: MessageSquare, screen_share: Monitor };
                const TypeIcon = typeIcons[session.session_type] || Video;
                const time = new Date(session.scheduled_at);
                return (
                  <Link key={session.id} to={`/client/sessions/${session.id}`} className="block">
                    <div className="p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive">
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
          <CardTitle className="text-base font-semibold">{t('client_dashboard.recommended_consultants')}</CardTitle>
          <Link to="/client/consultants">
            <Button variant="ghost" size="sm" className="text-xs group">{t('client_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger-fade">
            {recommendedConsultants.map((c: any) => (
              <Link key={c.id} to={`/client/consultants/${c.id}`} className="block">
              <div className="p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive flex flex-col gradient-border">
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative">
                    <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                      {c.avatar}
                    </div>
                    <StatusDot status="online" size="sm" pulse className="absolute -bottom-0.5 -end-0.5 ring-2 ring-background" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-foreground truncate">{c.name}</h4>
                    <p className="text-xs text-muted-foreground truncate">{c.specialty}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 mb-2">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-semibold text-foreground">{c.rating}</span>
                  <span className="text-xs text-muted-foreground">({c.reviews})</span>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {c.credly_username && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      <Award className="w-2.5 h-2.5" />
                      {t('consultants.credly_verified', 'Credly Verified')}
                    </span>
                  )}
                  {(c.badges || []).map((badge: string) => {
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

                <div className="mt-auto flex items-center justify-between">
                  <div>
                    <span className="text-base font-bold text-foreground">${c.rate}</span>
                    <span className="text-xs text-muted-foreground">/hr</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-accent">{c.matchScore}% match</span>
                  </div>
                </div>
              </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* VMware Infrastructure */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Monitor className="w-4 h-4 text-primary" /> VMware Infrastructure
          </CardTitle>
          <Link to="/client/vmware-console">
            <Button variant="ghost" size="sm" className="text-xs group">Console <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Link to="/client/vmware-console">
              <div className="p-3 rounded-xl bg-muted/20 border border-border/30 text-center card-interactive">
                <Monitor className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-xs font-medium">Console</p>
                <p className="text-[10px] text-muted-foreground">Power & Monitor</p>
              </div>
            </Link>
            <Link to="/client/vmware-pricing">
              <div className="p-3 rounded-xl bg-muted/20 border border-border/30 text-center card-interactive">
                <CreditCard className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-xs font-medium">Pricing</p>
                <p className="text-[10px] text-muted-foreground">Plans & Billing</p>
              </div>
            </Link>
            <Link to="/client/vmware-settings">
              <div className="p-3 rounded-xl bg-muted/20 border border-border/30 text-center card-interactive">
                <TrendingUp className="w-5 h-5 text-primary mx-auto mb-1" />
                <p className="text-xs font-medium">Settings</p>
                <p className="text-[10px] text-muted-foreground">Configure VMs</p>
              </div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
    </PullToRefresh>
  );
}

