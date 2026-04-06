import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import ShareMenu from '@/components/ShareMenu';

const dailyTickets = [
  { day: 'Mon', tickets: 42, resolved: 38 },
  { day: 'Tue', tickets: 56, resolved: 48 },
  { day: 'Wed', tickets: 38, resolved: 35 },
  { day: 'Thu', tickets: 64, resolved: 55 },
  { day: 'Fri', tickets: 48, resolved: 44 },
  { day: 'Sat', tickets: 22, resolved: 20 },
  { day: 'Sun', tickets: 18, resolved: 16 },
];

const responseTimeData = [
  { week: 'W1', avgMinutes: 48 },
  { week: 'W2', avgMinutes: 42 },
  { week: 'W3', avgMinutes: 38 },
  { week: 'W4', avgMinutes: 35 },
  { week: 'W5', avgMinutes: 32 },
  { week: 'W6', avgMinutes: 28 },
];

const consultantPerformance = [
  { name: 'Sarah J.', sessions: 42, rating: 4.9, revenue: 12600 },
  { name: 'Lisa C.', sessions: 38, rating: 4.8, revenue: 11400 },
  { name: 'David P.', sessions: 35, rating: 4.7, revenue: 10500 },
  { name: 'Amira H.', sessions: 31, rating: 4.6, revenue: 9300 },
  { name: 'Michael T.', sessions: 28, rating: 4.5, revenue: 8400 },
];

const userGrowth = [
  { month: 'Oct', clients: 820, consultants: 45 },
  { month: 'Nov', clients: 960, consultants: 62 },
  { month: 'Dec', clients: 1100, consultants: 78 },
  { month: 'Jan', clients: 1340, consultants: 95 },
  { month: 'Feb', clients: 1620, consultants: 124 },
  { month: 'Mar', clients: 1950, consultants: 156 },
];

export default function AnalyticsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('analytics_page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('analytics_page.subtitle')}</p>
        </div>
        <ShareMenu
          title="Platform Analytics"
          text="Analytics Report Summary"
          details={[
            { label: 'Avg Response Time', value: '28 min' },
            { label: 'Weekly Tickets', value: dailyTickets.reduce((s, d) => s + d.tickets, 0).toString() },
            { label: 'Resolution Rate', value: `${Math.round(dailyTickets.reduce((s, d) => s + d.resolved, 0) / dailyTickets.reduce((s, d) => s + d.tickets, 0) * 100)}%` },
            { label: 'Top Consultant', value: consultantPerformance[0]?.name || '—' },
          ]}
          variant="outline"
          size="sm"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('analytics_page.daily_ticket_volume')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dailyTickets}>
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="tickets" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="Created" />
                <Bar dataKey="resolved" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} name="Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t('analytics_page.avg_response_time')}</CardTitle>
              <Badge variant="secondary" className="text-[10px]">↓ 42% {t('analytics_page.improvement')}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={responseTimeData}>
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="m" />
                <Tooltip formatter={(v: number) => `${v} min`} />
                <defs>
                  <linearGradient id="responseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area dataKey="avgMinutes" stroke="hsl(217, 91%, 60%)" fill="url(#responseGrad)" strokeWidth={2} name="Response Time" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('analytics_page.user_growth')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={userGrowth}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line dataKey="clients" stroke="hsl(226, 53%, 22%)" strokeWidth={2} dot={{ r: 3 }} name="Clients" />
                <Line dataKey="consultants" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={{ r: 3 }} name="Consultants" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('analytics_page.top_consultants')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {consultantPerformance.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                    {c.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.sessions} {t('common.sessions')} · ⭐ {c.rating}</p>
                  </div>
                  <span className="text-sm font-bold text-foreground">${c.revenue.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
