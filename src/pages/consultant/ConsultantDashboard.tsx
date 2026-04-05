import { useTranslation } from 'react-i18next';
import {
  DollarSign, Briefcase, Clock, Star, TrendingUp, TrendingDown,
  Calendar, Video, MessageSquare, Monitor, ArrowUpRight, ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import {
  mockConsultantProfile, mockEarnings, mockCases, mockSessions, mockReviews,
} from '@/data/consultantMockData';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const urgencyColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  new: 'bg-accent/10 text-accent',
  matched: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-muted text-muted-foreground',
};

const sessionTypeIcons: Record<string, typeof Video> = {
  video: Video,
  chat: MessageSquare,
  screen_share: Monitor,
};

export default function ConsultantDashboard() {
  const profile = mockConsultantProfile;
  const earnings = mockEarnings;
  const activeCases = mockCases.filter((c) => c.status !== 'resolved' && c.status !== 'closed');
  const upcomingSessions = mockSessions.filter((s) => s.status === 'scheduled');

  const kpis = [
    { label: 'Monthly Earnings', value: `$${earnings.thisMonth.toLocaleString()}`, icon: DollarSign, trend: '+12%', up: true },
    { label: 'Active Cases', value: activeCases.length.toString(), icon: Briefcase, trend: '+2', up: true },
    { label: 'Avg Response', value: `${profile.response_time_minutes} min`, icon: Clock, trend: '-3 min', up: true },
    { label: 'Rating', value: profile.rating.toString(), icon: Star, trend: `${profile.total_reviews} reviews`, up: true },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {profile.display_name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1">Here's your activity overview for today.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Available
          </span>
          <Button size="sm" className="gradient-primary border-0">
            <Calendar className="w-4 h-4 me-1" /> Manage Availability
          </Button>
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
                <span className={`text-xs font-medium flex items-center gap-0.5 ${kpi.up ? 'text-green-600' : 'text-red-500'}`}>
                  {kpi.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {kpi.trend}
                </span>
              </div>
              <div className="text-2xl font-bold text-foreground">{kpi.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Earnings Chart */}
        <Card className="lg:col-span-2 rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">Earnings Overview</CardTitle>
            <Link to="/consultant/earnings">
              <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-3 rounded-xl bg-muted/50">
                <div className="text-xs text-muted-foreground">Total Earned</div>
                <div className="text-lg font-bold text-foreground">${earnings.total.toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-xl bg-muted/50">
                <div className="text-xs text-muted-foreground">Pending</div>
                <div className="text-lg font-bold text-foreground">${earnings.pending.toLocaleString()}</div>
              </div>
              <div className="p-3 rounded-xl bg-muted/50">
                <div className="text-xs text-muted-foreground">Available</div>
                <div className="text-lg font-bold text-foreground">${earnings.available.toLocaleString()}</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={earnings.monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Earnings']}
                  contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px' }}
                />
                <Bar dataKey="amount" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Upcoming Sessions */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">Upcoming Sessions</CardTitle>
            <Link to="/consultant/calendar">
              <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No upcoming sessions</p>
            ) : (
              upcomingSessions.map((session) => {
                const TypeIcon = sessionTypeIcons[session.session_type] || Video;
                const time = new Date(session.scheduled_at);
                return (
                  <div key={session.id} className="p-3 rounded-xl bg-muted/30 border border-border/30 hover:border-accent/30 transition-all">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                          <TypeIcon className="w-4 h-4 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{session.client}</p>
                          <p className="text-xs text-muted-foreground">{session.session_type.replace('_', ' ')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs text-muted-foreground">{session.duration_minutes} min</span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Cases */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">Active Cases</CardTitle>
          <Link to="/consultant/cases">
            <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {activeCases.map((ticket) => (
              <div key={ticket.id} className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-border/30 hover:border-accent/30 transition-all">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-foreground truncate">{ticket.title}</h4>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{ticket.client}</span>
                    <span>·</span>
                    <span>{ticket.sap_module}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className={`text-[10px] ${urgencyColors[ticket.urgency]}`}>
                    {ticket.urgency}
                  </Badge>
                  <Badge variant="secondary" className={`text-[10px] ${statusColors[ticket.status]}`}>
                    {ticket.status.replace('_', ' ')}
                  </Badge>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0">
                  <ArrowUpRight className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Reviews */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">Recent Reviews</CardTitle>
          <Link to="/consultant/reviews">
            <Button variant="ghost" size="sm" className="text-xs">View All <ChevronRight className="w-3 h-3 ms-1" /></Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            {mockReviews.map((review) => (
              <div key={review.id} className="p-4 rounded-xl bg-muted/20 border border-border/30">
                <div className="flex items-center gap-1 mb-2">
                  {Array.from({ length: review.score }).map((_, j) => (
                    <Star key={j} className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">"{review.comment}"</p>
                <p className="text-xs font-medium text-foreground">{review.client}</p>
                <p className="text-xs text-muted-foreground">{new Date(review.created_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
