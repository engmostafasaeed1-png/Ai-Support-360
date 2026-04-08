import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, PieChart, Pie, Cell, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend, ComposedChart,
} from 'recharts';
import ShareMenu from '@/components/ShareMenu';
import { format, subDays, startOfDay, subMonths } from 'date-fns';
import { useGuestMode } from '@/contexts/GuestModeContext';
import {
  revenueData as mockRevenueData,
  ticketsByStatus as mockTicketsByStatus,
  ticketsByModule as mockTicketsByModule,
} from '@/data/adminMockData';
import { TrendingUp, TrendingDown, Activity, DollarSign, Clock, CheckCircle2, Download, FileText } from 'lucide-react';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import { exportToCSV, exportToPDF } from '@/components/reports/exportUtils';



const COLORS = [
  'hsl(217, 91%, 60%)', 'hsl(45, 93%, 47%)', 'hsl(262, 83%, 58%)',
  'hsl(142, 76%, 36%)', 'hsl(0, 72%, 51%)', 'hsl(190, 80%, 42%)',
  'hsl(320, 70%, 50%)',
];

const URGENCY_COLORS: Record<string, string> = {
  low: 'hsl(142, 76%, 36%)',
  medium: 'hsl(45, 93%, 47%)',
  high: 'hsl(25, 95%, 53%)',
  critical: 'hsl(0, 72%, 51%)',
};

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(() => new Date());

  const { data, isLoading } = useQuery({
    queryKey: ['admin-analytics', timeRange],
    queryFn: async () => {
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

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
      const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));

      // Module distribution
      const moduleCounts: Record<string, number> = {};
      tickets.forEach(t => {
        moduleCounts[t.sap_module] = (moduleCounts[t.sap_module] || 0) + 1;
      });
      const ticketsByModule = Object.entries(moduleCounts)
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Urgency distribution
      const urgencyCounts: Record<string, number> = {};
      tickets.forEach(t => {
        const u = t.urgency || 'medium';
        urgencyCounts[u] = (urgencyCounts[u] || 0) + 1;
      });
      const urgencyData = Object.entries(urgencyCounts).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        fill: URGENCY_COLORS[name] || COLORS[0],
      }));

      // Daily tickets
      const dailyTickets: { day: string; created: number; resolved: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = subDays(new Date(), i);
        const dayStr = days <= 7 ? format(date, 'EEE') : format(date, 'MMM d');
        const dayStart = startOfDay(date).toISOString();
        const dayEnd = startOfDay(subDays(date, -1)).toISOString();
        const dayTickets = tickets.filter(t => t.created_at >= dayStart && t.created_at < dayEnd);
        const dayResolved = tickets.filter(t => t.resolved_at && t.resolved_at >= dayStart && t.resolved_at < dayEnd);
        dailyTickets.push({ day: dayStr, created: dayTickets.length, resolved: dayResolved.length });
      }

      // Avg resolution time
      const resolved = tickets.filter(t => t.resolved_at && t.created_at);
      let avgResHours = 0;
      if (resolved.length > 0) {
        const totalMs = resolved.reduce((sum, t) => sum + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()), 0);
        avgResHours = Math.round(totalMs / resolved.length / 3600000);
      }

      // Revenue by month
      const { data: payments } = await supabase
        .from('payments')
        .select('consultant_id, amount, status, created_at')
        .eq('status', 'completed');

      const monthlyRevenue: Record<string, { revenue: number; count: number }> = {};
      (payments || []).forEach(p => {
        const m = format(new Date(p.created_at), 'MMM yyyy');
        if (!monthlyRevenue[m]) monthlyRevenue[m] = { revenue: 0, count: 0 };
        monthlyRevenue[m].revenue += Number(p.amount);
        monthlyRevenue[m].count += 1;
      });
      const revenueTimeline = Object.entries(monthlyRevenue).map(([month, d]) => ({
        month: month.split(' ')[0],
        revenue: Math.round(d.revenue),
        transactions: d.count,
      }));

      // Sessions by type
      const { data: sessions } = await supabase
        .from('sessions')
        .select('consultant_id, status, session_type, duration_minutes');

      const sessionTypeCounts: Record<string, number> = {};
      const sessionStatusCounts: Record<string, number> = {};
      let totalDuration = 0;
      let durationCount = 0;
      (sessions || []).forEach(s => {
        const type = s.session_type || 'chat';
        sessionTypeCounts[type] = (sessionTypeCounts[type] || 0) + 1;
        const st = s.status || 'scheduled';
        sessionStatusCounts[st] = (sessionStatusCounts[st] || 0) + 1;
        if (s.duration_minutes) {
          totalDuration += s.duration_minutes;
          durationCount++;
        }
      });
      const sessionTypeData = Object.entries(sessionTypeCounts).map(([name, value]) => ({
        subject: name.charAt(0).toUpperCase() + name.replace(/_/g, ' ').slice(1),
        count: value,
        fullMark: Math.max(...Object.values(sessionTypeCounts), 1),
      }));

      // Consultant performance
      const consultantRevenue: Record<string, number> = {};
      const consultantSessions: Record<string, number> = {};
      (payments || []).forEach(p => {
        consultantRevenue[p.consultant_id] = (consultantRevenue[p.consultant_id] || 0) + Number(p.amount);
      });
      (sessions || []).filter(s => s.status === 'completed').forEach(s => {
        consultantSessions[s.consultant_id] = (consultantSessions[s.consultant_id] || 0) + 1;
      });

      const consultantIds = [...new Set([...Object.keys(consultantRevenue), ...Object.keys(consultantSessions)])];
      let consultantPerformance: { name: string; sessions: number; revenue: number }[] = [];
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase.from('consultants').select('id, user_id').in('id', consultantIds);
        const userIds = (consultants || []).map(c => c.user_id);
        const { data: profiles } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds);
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

      // User growth
      const { data: allProfiles } = await supabase
        .from('profiles')
        .select('created_at')
        .order('created_at', { ascending: true });

      const monthlyGrowth: Record<string, number> = {};
      let cumulative = 0;
      (allProfiles || []).forEach(p => {
        const m = format(new Date(p.created_at), 'MMM');
        monthlyGrowth[m] = (monthlyGrowth[m] || 0) + 1;
      });
      const userGrowth = Object.entries(monthlyGrowth).map(([month, users]) => {
        cumulative += users;
        return { month, newUsers: users, total: cumulative };
      });

      const totalRevenue = (payments || []).reduce((s, p) => s + Number(p.amount), 0);

      return {
        dailyTickets,
        ticketsByModule,
        statusData,
        urgencyData,
        avgResHours,
        consultantPerformance,
        userGrowth,
        revenueTimeline,
        sessionTypeData,
        totalTickets: tickets.length,
        totalResolved: resolved.length,
        totalRevenue,
        totalSessions: (sessions || []).length,
        avgSessionDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      };
    },
    enabled: !isGuest,
  });

  // Guest fallback data
  const guestData = {
    dailyTickets: [
      { day: 'Mon', created: 12, resolved: 8 }, { day: 'Tue', created: 18, resolved: 14 },
      { day: 'Wed', created: 15, resolved: 11 }, { day: 'Thu', created: 22, resolved: 16 },
      { day: 'Fri', created: 9, resolved: 7 }, { day: 'Sat', created: 6, resolved: 5 },
      { day: 'Sun', created: 4, resolved: 3 },
    ],
    ticketsByModule: mockTicketsByModule,
    statusData: mockTicketsByStatus.map(s => ({ name: s.name, value: s.value })),
    urgencyData: [
      { name: 'Low', value: 45, fill: URGENCY_COLORS.low },
      { name: 'Medium', value: 120, fill: URGENCY_COLORS.medium },
      { name: 'High', value: 68, fill: URGENCY_COLORS.high },
      { name: 'Critical', value: 22, fill: URGENCY_COLORS.critical },
    ],
    avgResHours: 4,
    consultantPerformance: [
      { name: 'Sarah Johnson', sessions: 24, revenue: 18000 },
      { name: 'David Park', sessions: 18, revenue: 13500 },
      { name: 'Lisa Chen', sessions: 15, revenue: 11200 },
    ],
    userGrowth: [
      { month: 'Jan', newUsers: 120, total: 120 }, { month: 'Feb', newUsers: 185, total: 305 },
      { month: 'Mar', newUsers: 240, total: 545 }, { month: 'Apr', newUsers: 310, total: 855 },
      { month: 'May', newUsers: 420, total: 1275 }, { month: 'Jun', newUsers: 580, total: 1855 },
    ],
    revenueTimeline: mockRevenueData.map(r => ({ month: r.month, revenue: r.revenue, transactions: Math.round(r.revenue / 250) })),
    sessionTypeData: [
      { subject: 'Chat', count: 145, fullMark: 200 },
      { subject: 'Video', count: 98, fullMark: 200 },
      { subject: 'Screen share', count: 67, fullMark: 200 },
    ],
    totalTickets: 342,
    totalResolved: 198,
    totalRevenue: 284500,
    totalSessions: 310,
    avgSessionDuration: 45,
  };

  const d = isGuest ? guestData : (data || {
    dailyTickets: [], ticketsByModule: [], statusData: [], urgencyData: [],
    avgResHours: 0, consultantPerformance: [], userGrowth: [], revenueTimeline: [],
    sessionTypeData: [], totalTickets: 0, totalResolved: 0, totalRevenue: 0,
    totalSessions: 0, avgSessionDuration: 0,
  });

  const tooltipStyle = {
    borderRadius: 12,
    border: '1px solid hsl(var(--border))',
    fontSize: 12,
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  };

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.05) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('analytics_page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('analytics_page.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="7d" className="text-xs px-3 h-7">7 Days</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs px-3 h-7">30 Days</TabsTrigger>
              <TabsTrigger value="90d" className="text-xs px-3 h-7">90 Days</TabsTrigger>
            </TabsList>
          </Tabs>
          <ShareMenu
            title="Analytics Report"
            text="Platform analytics overview"
            details={[
              { label: 'Total Tickets', value: d.totalTickets.toString() },
              { label: 'Revenue', value: `$${d.totalRevenue.toLocaleString()}` },
            ]}
            variant="outline"
            size="sm"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Tickets', value: d.totalTickets, icon: Activity, color: 'text-blue-500' },
          { label: 'Resolved', value: d.totalResolved, icon: CheckCircle2, color: 'text-green-500' },
          { label: 'Resolution Rate', value: d.totalTickets > 0 ? `${Math.round(d.totalResolved / d.totalTickets * 100)}%` : '0%', icon: TrendingUp, color: 'text-emerald-500' },
          { label: 'Avg Resolution', value: `${d.avgResHours}h`, icon: Clock, color: 'text-amber-500' },
          { label: 'Revenue', value: `$${(d.totalRevenue / 1000).toFixed(0)}k`, icon: DollarSign, color: 'text-violet-500' },
          { label: 'Avg Session', value: `${d.avgSessionDuration}m`, icon: Activity, color: 'text-cyan-500' },
        ].map((k, i) => (
          <Card key={i} className="rounded-2xl border-border/50 hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <k.icon className={`w-4 h-4 ${k.color}`} />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{k.label}</span>
              </div>
              {isLoading && !isGuest ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-xl font-bold text-foreground">{k.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 1: Ticket Trend + Revenue */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ticket Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !isGuest ? <Skeleton className="h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={d.dailyTickets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" fontSize={10} tickLine={false} interval={timeRange === '7d' ? 0 : 'preserveStartEnd'} />
                  <YAxis fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="created" fill="hsl(217, 91%, 60%)" radius={[3, 3, 0, 0]} name="Created" />
                  <Line type="monotone" dataKey="resolved" stroke="hsl(142, 76%, 36%)" strokeWidth={2} dot={false} name="Resolved" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !isGuest ? <Skeleton className="h-[240px]" /> : d.revenueTimeline.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No revenue data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={d.revenueTimeline}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" fontSize={11} tickLine={false} />
                  <YAxis fontSize={11} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(262, 83%, 58%)" fill="url(#revenueGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Status Donut + Urgency Pie + Session Radar */}
      <div className="grid md:grid-cols-3 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ticket Status</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {isLoading && !isGuest ? <Skeleton className="h-[200px] w-[200px] rounded-full" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={d.statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={85}
                    paddingAngle={3} dataKey="value" labelLine={false} label={renderCustomLabel}>
                    {d.statusData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Urgency Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {isLoading && !isGuest ? <Skeleton className="h-[200px] w-[200px] rounded-full" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={d.urgencyData} cx="50%" cy="50%" outerRadius={85}
                    dataKey="value" labelLine={false} label={renderCustomLabel}>
                    {d.urgencyData.map((entry: any, i: number) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Session Types</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {isLoading && !isGuest ? <Skeleton className="h-[200px]" /> : d.sessionTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No session data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={d.sessionTypeData} cx="50%" cy="50%" outerRadius={70}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="subject" fontSize={11} />
                  <PolarRadiusAxis fontSize={9} />
                  <Radar name="Sessions" dataKey="count" stroke="hsl(190, 80%, 42%)" fill="hsl(190, 80%, 42%)" fillOpacity={0.3} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: SAP Modules + User Growth */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tickets by SAP Module</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !isGuest ? <Skeleton className="h-[240px]" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.ticketsByModule} layout="vertical">
                  <XAxis type="number" fontSize={11} tickLine={false} />
                  <YAxis dataKey="module" type="category" fontSize={10} tickLine={false} width={90} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {d.ticketsByModule.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">User Growth</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && !isGuest ? <Skeleton className="h-[240px]" /> : d.userGrowth.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No growth data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={d.userGrowth}>
                  <defs>
                    <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" fontSize={11} tickLine={false} />
                  <YAxis fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="total" fill="url(#growthGrad)" stroke="hsl(217, 91%, 60%)" strokeWidth={2} name="Total Users" />
                  <Bar dataKey="newUsers" fill="hsl(262, 83%, 58%)" radius={[3, 3, 0, 0]} name="New Users" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Consultants */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Top Consultants</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && !isGuest ? <Skeleton className="h-40" /> : d.consultantPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No consultant activity data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.consultantPerformance} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" fontSize={11} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" fontSize={10} tickLine={false} width={100} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [name === 'revenue' ? `$${v.toLocaleString()}` : v, name === 'revenue' ? 'Revenue' : 'Sessions']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revenue" fill="hsl(262, 83%, 58%)" radius={[0, 4, 4, 0]} name="Revenue" />
                <Bar dataKey="sessions" fill="hsl(190, 80%, 42%)" radius={[0, 4, 4, 0]} name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
