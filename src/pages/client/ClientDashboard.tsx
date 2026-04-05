import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import {
  Briefcase, Clock, CreditCard, CheckCircle, TrendingUp, TrendingDown,
  ChevronRight, Star, BadgeCheck, Zap, TicketPlus, Users,
  Calendar, DollarSign, FileText, Video, MessageSquare, Monitor,
} from 'lucide-react';
import {
  mockClientProfile, mockClientTickets, mockClientSessions,
  mockClientPayments, mockRecommendedConsultants, mockActivityFeed,
} from '@/data/clientMockData';

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
  const profile = mockClientProfile;
  const openTickets = mockClientTickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
  const pendingPayments = mockClientPayments.filter((p) => p.status === 'pending');
  const activeSessions = mockClientSessions.filter((s) => s.status === 'scheduled');

  const kpis = [
    { labelKey: 'client_dashboard.open_tickets', value: openTickets.length.toString(), icon: Briefcase, trend: '+1 today', up: true },
    { labelKey: 'client_dashboard.active_sessions', value: activeSessions.length.toString(), icon: Calendar, trend: '2 upcoming', up: true },
    { labelKey: 'client_dashboard.pending_payments', value: `$${pendingPayments.reduce((a, p) => a + p.amount, 0)}`, icon: CreditCard, trend: '1 invoice', up: false },
    { labelKey: 'client_dashboard.resolved', value: '4', icon: CheckCircle, trend: '+25%', up: true },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('client_dashboard.title')}, {profile.display_name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1">{profile.company} · {t('client_dashboard.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/client/new-request">
            <Button className="gradient-primary border-0" size="sm">
              <TicketPlus className="w-4 h-4 me-1" /> {t('client_dashboard.new_request')}
            </Button>
          </Link>
          <Link to="/client/consultants">
            <Button variant="outline" size="sm">
              <Users className="w-4 h-4 me-1" /> Browse Consultants
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <kpi.icon className="w-5 h-5 text-accent" />
                </div>
                <span className={`text-xs font-medium flex items-center gap-0.5 ${kpi.up ? 'text-green-600' : 'text-yellow-600'}`}>
                  {kpi.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {kpi.trend}
                </span>
              </div>
              <div className="text-2xl font-bold text-foreground">{kpi.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{t(kpi.labelKey)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Tickets */}
        <Card className="lg:col-span-2 rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">Recent Tickets</CardTitle>
            <Link to="/client/tickets">
              <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {mockClientTickets.slice(0, 4).map((ticket) => (
              <div key={ticket.id} className="flex items-center gap-4 p-3 rounded-xl bg-muted/20 border border-border/30 hover:border-accent/30 transition-all">
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
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('client_dashboard.recent_activity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mockActivityFeed.map((activity) => {
              const Icon = activityIcons[activity.icon] || Briefcase;
              return (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">{activity.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{activity.time}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Sessions */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">{t('consultant_dashboard.upcoming_sessions')}</CardTitle>
          <Link to="/client/sessions">
            <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            {mockClientSessions.map((session) => {
              const typeIcons: Record<string, typeof Video> = { video: Video, chat: MessageSquare, screen_share: Monitor };
              const TypeIcon = typeIcons[session.session_type] || Video;
              const time = new Date(session.scheduled_at);
              return (
                <div key={session.id} className="p-4 rounded-xl bg-muted/20 border border-border/30 hover:border-accent/30 transition-all">
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
                    <Button size="sm" className="gradient-primary border-0 text-xs h-7">Join</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recommended Consultants */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">{t('client_dashboard.recommended_consultants')}</CardTitle>
          <Link to="/client/consultants">
            <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {mockRecommendedConsultants.map((c) => (
              <div key={c.id} className="p-4 rounded-xl bg-muted/20 border border-border/30 hover:border-accent/30 hover:shadow-premium transition-all flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                    {c.avatar}
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
                  {c.badges.map((badge) => {
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
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
