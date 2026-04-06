import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import ShareMenu from '@/components/ShareMenu';
import { format, subDays, startOfDay } from 'date-fns';

export default function AnalyticsPage() {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: async () => {
      // Tickets by status
      const { data: allTickets } = await supabase
        .from('tickets')
        .select('status, sap_module, created_at, resolved_at, urgency');

      const tickets = allTickets || [];

      // Status distribution
      const statusCounts: Record<string, number> = {};
      tickets.forEach(t => {
        const s = t.status || 'new';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });

      // Module distribution
      const moduleCounts: Record<string, number> = {};
      tickets.forEach(t => {
        moduleCounts[t.sap_module] = (moduleCounts[t.sap_module] || 0) + 1;
      });
      const ticketsByModule = Object.entries(moduleCounts)
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Daily tickets (last 7 days)
      const dailyTickets: { day: string; tickets: number; resolved: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = subDays(new Date(), i);
        const dayStr = format(date, 'EEE');
        const dayStart = startOfDay(date).toISOString();
        const dayEnd = startOfDay(subDays(date, -1)).toISOString();
        const dayTickets = tickets.filter(t => t.created_at >= dayStart && t.created_at < dayEnd);
        const dayResolved = tickets.filter(t => t.resolved_at && t.resolved_at >= dayStart && t.resolved_at < dayEnd);
        dailyTickets.push({ day: dayStr, tickets: dayTickets.length, resolved: dayResolved.length });
      }

      // Average resolution time
      const resolved = tickets.filter(t => t.resolved_at && t.created_at);
      let avgResHours = 0;
      if (resolved.length > 0) {
        const totalMs = resolved.reduce((sum, t) => {
          return sum + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime());
        }, 0);
        avgResHours = Math.round(totalMs / resolved.length / 3600000);
      }

      // Consultant performance
      const { data: payments } = await supabase
        .from('payments')
        .select('consultant_id, amount, status')
        .eq('status', 'completed');

      const { data: sessions } = await supabase
        .from('sessions')
        .select('consultant_id, status')
        .eq('status', 'completed');

      const consultantRevenue: Record<string, number> = {};
      const consultantSessions: Record<string, number> = {};
      (payments || []).forEach(p => {
        consultantRevenue[p.consultant_id] = (consultantRevenue[p.consultant_id] || 0) + Number(p.amount);
      });
      (sessions || []).forEach(s => {
        consultantSessions[s.consultant_id] = (consultantSessions[s.consultant_id] || 0) + 1;
      });

      // Get consultant names
      const consultantIds = [...new Set([...Object.keys(consultantRevenue), ...Object.keys(consultantSessions)])];
      let consultantPerformance: { name: string; sessions: number; revenue: number }[] = [];
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds);
        const userIds = (consultants || []).map(c => c.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);
        const nameMap = new Map((profiles || []).map(p => [p.user_id, p.display_name || 'Consultant']));
        const idToUser = new Map((consultants || []).map(c => [c.id, c.user_id]));

        consultantPerformance = consultantIds
          .map(id => ({
            name: nameMap.get(idToUser.get(id) || '') || 'Consultant',
            sessions: consultantSessions[id] || 0,
            revenue: consultantRevenue[id] || 0,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);
      }

      // User growth (profiles by month)
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('created_at')
        .order('created_at', { ascending: true });

      const monthlyGrowth: Record<string, number> = {};
      (allProfiles || []).forEach(p => {
        const m = format(new Date(p.created_at), 'MMM');
        monthlyGrowth[m] = (monthlyGrowth[m] || 0) + 1;
      });
      const userGrowth = Object.entries(monthlyGrowth).map(([month, users]) => ({ month, users }));

      return {
        dailyTickets,
        ticketsByModule,
        avgResHours,
        consultantPerformance,
        userGrowth,
        totalTickets: tickets.length,
        totalResolved: resolved.length,
      };
    },
  });

  const d = data || {
    dailyTickets: [], ticketsByModule: [], avgResHours: 0,
    consultantPerformance: [], userGrowth: [], totalTickets: 0, totalResolved: 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('analytics_page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('analytics_page.subtitle')}</p>
        </div>
        <ShareMenu
          title="Analytics Report"
          text="Platform analytics overview"
          details={[
            { label: 'Total Tickets', value: d.totalTickets.toString() },
            { label: 'Resolved', value: d.totalResolved.toString() },
            { label: 'Avg Resolution', value: `${d.avgResHours}h` },
          ]}
          variant="outline"
          size="sm"
        />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Tickets', value: d.totalTickets },
          { label: 'Resolved', value: d.totalResolved },
          { label: 'Avg Resolution', value: `${d.avgResHours}h` },
          { label: 'Resolution Rate', value: d.totalTickets > 0 ? `${Math.round(d.totalResolved / d.totalTickets * 100)}%` : '0%' },
        ].map((k, i) => (
          <Card key={i} className="rounded-2xl border-border/50">
            <CardContent className="p-5">
              {isLoading ? <Skeleton className="h-8 w-16" /> : (
                <div className="text-2xl font-bold text-foreground">{k.value}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Daily Tickets */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('analytics_page.daily_tickets', 'Daily Tickets (7 days)')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.dailyTickets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" fontSize={12} tickLine={false} />
                  <YAxis fontSize={12} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Bar dataKey="tickets" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="Created" />
                  <Bar dataKey="resolved" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} name="Resolved" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Tickets by Module */}
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('analytics_page.by_module', 'Tickets by SAP Module')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.ticketsByModule} layout="vertical">
                  <XAxis type="number" fontSize={12} tickLine={false} />
                  <YAxis dataKey="module" type="category" fontSize={11} tickLine={false} width={100} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(217, 91%, 60%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Consultant Performance */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('analytics_page.top_consultants', 'Top Consultants')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-40" /> : d.consultantPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No consultant activity data yet.</p>
          ) : (
            <div className="space-y-3">
              {d.consultantPerformance.map((c, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      #{i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.sessions} sessions</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">${c.revenue.toLocaleString()}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Growth */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('analytics_page.user_growth', 'User Growth')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-[220px]" /> : d.userGrowth.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No growth data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d.userGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" fontSize={12} tickLine={false} />
                <YAxis fontSize={12} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                <Area type="monotone" dataKey="users" stroke="hsl(217, 91%, 60%)" fill="hsl(217, 91%, 60%)" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
