import { useTranslation } from 'react-i18next';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  DollarSign, Briefcase, Clock, Star, TrendingUp,
  Calendar, Video, MessageSquare, Monitor, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  mockConsultantProfile, mockEarnings, mockCases, mockReviews,
} from '@/data/consultantMockData';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import OnboardingProgressCard from '@/components/onboarding/OnboardingProgressCard';
import WelcomeBanner from '@/components/onboarding/WelcomeBanner';
import EmailVerificationBanner from '@/components/onboarding/EmailVerificationBanner';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Sparkline } from '@/components/ui/sparkline';

const sessionTypeIcons: Record<string, typeof Video> = {
  video: Video,
  chat: MessageSquare,
  screen_share: Monitor,
};

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  matched: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  closed: 'bg-muted text-muted-foreground',
};

export default function ConsultantDashboard() {
  const { t } = useTranslation();

  const { data: liveData, isLoading } = useQuery({
    queryKey: ['consultant-dashboard'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (!consultant) return null;

      const { data: sessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('consultant_id', consultant.id)
        .eq('status', 'scheduled')
        .order('scheduled_at', { ascending: true })
        .limit(5);

      const clientIds = [...new Set((sessions || []).map(s => s.client_id))];
      let clientMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', clientIds);
        if (profiles) {
          clientMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'Client']));
        }
      }

      const { data: tickets } = await supabase
        .from('tickets')
        .select('*')
        .eq('consultant_id', consultant.id)
        .not('status', 'in', '("resolved","closed")')
        .order('created_at', { ascending: false })
        .limit(5);

      const { data: payments } = await supabase
        .from('payments')
        .select('amount, status, created_at')
        .eq('consultant_id', consultant.id);

      const totalEarned = (payments || [])
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + Number(p.amount), 0);
      const pending = (payments || [])
        .filter(p => p.status === 'pending')
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const { data: ratings } = await supabase
        .from('ratings')
        .select('score, comment, created_at, client_id')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false })
        .limit(3);

      return {
        consultant,
        sessions: (sessions || []).map(s => ({ ...s, client_name: clientMap[s.client_id] || 'Client' })),
        tickets: tickets || [],
        totalEarned,
        pending,
        ratings: ratings || [],
      };
    },
  });

  const profile = liveData?.consultant || mockConsultantProfile;
  const earnings = mockEarnings;
  const activeCases = liveData ? liveData.tickets : mockCases.filter(c => c.status !== 'resolved' && c.status !== 'closed');
  const upcomingSessions = liveData?.sessions || [];

  const kpis = [
    {
      labelKey: 'consultant_dashboard.this_month',
      value: liveData?.totalEarned ?? earnings.thisMonth,
      prefix: '$',
      icon: DollarSign,
      trend: liveData ? `$${liveData.pending.toLocaleString()} pending` : '+12%',
      sparkData: [800, 1200, 950, 1400, 1100, 1600, liveData?.totalEarned ?? earnings.thisMonth],
      link: '/consultant/earnings',
      color: 'hsl(var(--accent))',
    },
    {
      labelKey: 'consultant_dashboard.active_cases',
      value: activeCases.length,
      prefix: '',
      icon: Briefcase,
      trend: `${upcomingSessions.length} ${t('consultant_dashboard.upcoming')}`,
      sparkData: [2, 3, 4, 3, 5, 4, activeCases.length],
      link: '/consultant/cases',
      color: 'hsl(262, 83%, 58%)',
    },
    {
      labelKey: 'consultant_dashboard.response_time',
      value: (profile as any).response_time_minutes ?? 0,
      prefix: '',
      icon: Clock,
      trend: t('consultant_dashboard.avg'),
      sparkData: [30, 25, 28, 22, 20, 18, (profile as any).response_time_minutes ?? 0],
      link: '/consultant/profile',
      color: 'hsl(38, 92%, 50%)',
    },
    {
      labelKey: 'consultant_dashboard.avg_rating',
      value: (profile as any).rating ?? 0,
      prefix: '',
      icon: Star,
      trend: `${(profile as any).total_reviews ?? 0} ${t('consultant_dashboard.reviews_label')}`,
      sparkData: [4.2, 4.5, 4.3, 4.6, 4.8, 4.7, (profile as any).rating ?? 0],
      link: '/consultant/reviews',
      color: 'hsl(142, 71%, 45%)',
    },
  ];

  return (
    <PullToRefresh>
    <div className="space-y-6">
      <WelcomeBanner />
      <EmailVerificationBanner />
      <OnboardingProgressCard role="consultant" />

      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('consultant_dashboard.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('consultant_dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {t('consultant_dashboard.available')}
          </span>
          <Link to="/consultant/calendar">
            <Button size="sm" className="gradient-primary border-0 shadow-premium hover:shadow-glow transition-all">
              <Calendar className="w-4 h-4 me-1" /> {t('consultant_dashboard.manage_availability')}
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
                    <AnimatedCounter value={kpi.value} prefix={kpi.prefix} decimals={kpi.labelKey.includes('rating') ? 1 : 0} />
                    {kpi.labelKey.includes('response_time') && <span className="text-sm font-normal text-muted-foreground ml-1">{t('consultant_dashboard.minutes')}</span>}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-1">{t(kpi.labelKey)}</div>
                <div className="text-[10px] text-green-600 dark:text-green-400 font-medium mt-0.5 flex items-center gap-0.5">
                  <TrendingUp className="w-2.5 h-2.5" />
                  {kpi.trend}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Earnings Chart */}
        <Card className="lg:col-span-2 rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">{t('consultant_dashboard.earnings_overview')}</CardTitle>
            <Link to="/consultant/earnings">
              <Button variant="ghost" size="sm" className="text-xs group">{t('consultant_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 stagger-fade">
              <div className="p-3 rounded-xl bg-muted/50">
                <div className="text-xs text-muted-foreground">{t('consultant_dashboard.total_earned')}</div>
                <div className="text-lg font-bold text-foreground">
                  <AnimatedCounter value={liveData?.totalEarned ?? earnings.total} prefix="$" />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/50">
                <div className="text-xs text-muted-foreground">{t('consultant_dashboard.pending_amount')}</div>
                <div className="text-lg font-bold text-foreground">
                  <AnimatedCounter value={liveData?.pending ?? earnings.pending} prefix="$" />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-muted/50">
                <div className="text-xs text-muted-foreground">{t('consultant_dashboard.sessions_count')}</div>
                <div className="text-lg font-bold text-foreground">
                  <AnimatedCounter value={upcomingSessions.length} />
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={earnings.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip
                  formatter={(value: number) => [`$${value.toLocaleString()}`, t('consultant_dashboard.earnings_label')]}
                  contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }}
                />
                <Bar dataKey="amount" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Upcoming Sessions */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">{t('consultant_dashboard.upcoming_sessions')}</CardTitle>
            <Link to="/consultant/calendar">
              <Button variant="ghost" size="sm" className="text-xs group">{t('consultant_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
            ) : upcomingSessions.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t('consultant_dashboard.no_sessions')}</p>
              </div>
            ) : (
              <div className="stagger-fade space-y-3">
                {upcomingSessions.map((session: any) => {
                  const TypeIcon = sessionTypeIcons[session.session_type] || Video;
                  return (
                    <Link key={session.id} to={`/consultant/cases`} className="block">
                    <div className="p-3 rounded-xl bg-muted/30 border border-border/30 card-interactive">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                            <TypeIcon className="w-4 h-4 text-accent" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{session.client_name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{session.session_type?.replace('_', ' ')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {session.scheduled_at ? format(new Date(session.scheduled_at), 'MMM d · h:mm a') : '—'}
                        </span>
                        <span className="text-xs text-muted-foreground">{session.duration_minutes || 60} min</span>
                      </div>
                    </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Cases */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">{t('consultant_dashboard.recent_cases')}</CardTitle>
          <Link to="/consultant/cases">
            <Button variant="ghost" size="sm" className="text-xs group">{t('consultant_dashboard.view_all')} <ChevronRight className="w-3 h-3 ms-1 group-hover:translate-x-0.5 transition-transform" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : activeCases.length === 0 ? (
            <div className="text-center py-8">
              <Briefcase className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t('consultant_dashboard.no_cases')}</p>
            </div>
          ) : (
            <div className="space-y-2 stagger-fade">
              {activeCases.map((ticket: any) => (
                <Link key={ticket.id} to={`/consultant/cases/${ticket.id}`} className="block">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-foreground truncate">{ticket.title}</h4>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>{ticket.sap_module}</span>
                      {ticket.created_at && (
                        <>
                          <span>·</span>
                          <span>{format(new Date(ticket.created_at), 'MMM d')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ticket.urgency && (
                      <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency] || ''}`}>
                        {ticket.urgency}
                      </Badge>
                    )}
                    <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status] || ''}`}>
                      {(ticket.status || '').replace('_', ' ')}
                    </Badge>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Reviews */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">{t('consultant_dashboard.recent_reviews')}</CardTitle>
        </CardHeader>
        <CardContent>
          {(liveData?.ratings && liveData.ratings.length > 0) ? (
            <div className="grid md:grid-cols-3 gap-4 stagger-fade">
              {liveData.ratings.map((review: any, i: number) => (
                <div key={i} className="p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive">
                  <div className="flex items-center gap-1 mb-2">
                    {Array.from({ length: review.score }).map((_, j) => (
                      <Star key={j} className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">"{review.comment || t('consultant_dashboard.no_comment')}"</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(review.created_at), 'MMM d, yyyy')}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-4 stagger-fade">
              {mockReviews.map((review) => (
                <div key={review.id} className="p-4 rounded-xl bg-muted/20 border border-border/30 card-interactive">
                  <div className="flex items-center gap-1 mb-2">
                    {Array.from({ length: review.score }).map((_, j) => (
                      <Star key={j} className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">"{review.comment}"</p>
                  <p className="text-xs font-medium text-foreground">{review.client}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </PullToRefresh>
  );
}
