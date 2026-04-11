import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { Download, FileText, DollarSign, Briefcase, Clock, Star, TrendingUp, CheckCircle2 } from 'lucide-react';
import { format, subDays, startOfDay } from 'date-fns';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import { exportToCSV, exportToPDF } from '@/components/reports/exportUtils';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Sparkline } from '@/components/ui/sparkline';

const COLORS = [
  'hsl(217, 91%, 60%)', 'hsl(45, 93%, 47%)', 'hsl(262, 83%, 58%)',
  'hsl(142, 76%, 36%)', 'hsl(0, 72%, 51%)', 'hsl(190, 80%, 42%)',
];

const tooltipStyle = {
  borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12,
  backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
};

export default function ConsultantReportsPage() {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(() => new Date());

  const { data, isLoading } = useQuery({
    queryKey: ['consultant-reports', timeRange, dateFrom.toISOString(), dateTo.toISOString()],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id, rating, total_reviews, response_time_minutes')
        .eq('user_id', user.id)
        .single();
      if (!consultant) return null;

      const fromISO = startOfDay(dateFrom).toISOString();
      const toISO = startOfDay(subDays(dateTo, -1)).toISOString();

      // Tickets/cases
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, title, status, sap_module, urgency, created_at, resolved_at')
        .eq('consultant_id', consultant.id);

      const allTickets = tickets || [];
      const rangeTickets = allTickets.filter(t => t.created_at >= fromISO && t.created_at < toISO);
      const resolved = rangeTickets.filter(t => t.resolved_at);

      // Module breakdown
      const moduleCounts: Record<string, number> = {};
      rangeTickets.forEach(t => { moduleCounts[t.sap_module] = (moduleCounts[t.sap_module] || 0) + 1; });
      const moduleData = Object.entries(moduleCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

      // Payments / earnings
      const { data: payments } = await supabase
        .from('payments')
        .select('amount, status, created_at')
        .eq('consultant_id', consultant.id);

      const allPayments = payments || [];
      const rangePayments = allPayments.filter(p => p.created_at >= fromISO && p.created_at < toISO);
      const totalEarned = rangePayments.filter(p => p.status === 'completed').reduce((s, p) => s + Number(p.amount), 0);
      const pendingAmount = rangePayments.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0);

      // Monthly earnings trend
      const monthlyEarnings: Record<string, number> = {};
      allPayments.filter(p => p.status === 'completed').forEach(p => {
        const m = format(new Date(p.created_at), 'MMM');
        monthlyEarnings[m] = (monthlyEarnings[m] || 0) + Number(p.amount);
      });
      const earningsTrend = Object.entries(monthlyEarnings).map(([month, amount]) => ({ month, amount: Math.round(amount) }));

      // Sessions
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, status, session_type, duration_minutes, created_at')
        .eq('consultant_id', consultant.id);

      const rangeSessions = (sessions || []).filter(s => s.created_at >= fromISO && s.created_at < toISO);
      const completedSessions = rangeSessions.filter(s => s.status === 'completed');
      const totalHours = Math.round(completedSessions.reduce((s, se) => s + (se.duration_minutes || 0), 0) / 60);

      // Session type breakdown
      const typeCounts: Record<string, number> = {};
      rangeSessions.forEach(s => { typeCounts[s.session_type || 'chat'] = (typeCounts[s.session_type || 'chat'] || 0) + 1; });
      const sessionTypeData = Object.entries(typeCounts).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));

      // Ratings
      const { data: ratings } = await supabase
        .from('ratings')
        .select('score, created_at')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: true });

      const ratingTrend = (ratings || []).map((r, i) => ({
        index: i + 1,
        score: r.score,
        avg: (ratings || []).slice(0, i + 1).reduce((s, rr) => s + rr.score, 0) / (i + 1),
      }));

      // Avg resolution
      let avgResHours = 0;
      if (resolved.length > 0) {
        avgResHours = Math.round(resolved.reduce((s, t) => s + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()), 0) / resolved.length / 3600000);
      }

      return {
        rating: consultant.rating || 0,
        totalReviews: consultant.total_reviews || 0,
        responseTime: consultant.response_time_minutes || 0,
        totalCases: rangeTickets.length,
        resolvedCases: resolved.length,
        totalEarned,
        pendingAmount,
        avgResHours,
        totalSessions: rangeSessions.length,
        totalHours,
        moduleData,
        earningsTrend,
        sessionTypeData,
        ratingTrend,
        // Export data
        casesExport: rangeTickets.map(t => ({
          Title: t.title, Status: t.status || 'unknown', Module: t.sap_module,
          Created: format(new Date(t.created_at), 'PPP'),
          Resolved: t.resolved_at ? format(new Date(t.resolved_at), 'PPP') : '—',
        })),
        earningsExport: rangePayments.map(p => ({
          Amount: `$${Number(p.amount).toFixed(2)}`, Status: p.status || 'unknown',
          Date: format(new Date(p.created_at), 'PPP'),
        })),
      };
    },
  });

  const d = data || {
    rating: 0, totalReviews: 0, responseTime: 0, totalCases: 0, resolvedCases: 0,
    totalEarned: 0, pendingAmount: 0, avgResHours: 0, totalSessions: 0, totalHours: 0,
    moduleData: [], earningsTrend: [], sessionTypeData: [], ratingTrend: [],
    casesExport: [], earningsExport: [],
  };

  const kpis = [
    { label: 'Total Earned', value: d.totalEarned, prefix: '$', icon: DollarSign, sparkData: [800, 1200, 950, 1400, 1100, 1600, d.totalEarned || 100], color: 'hsl(var(--accent))' },
    { label: 'Cases', value: d.totalCases, prefix: '', icon: Briefcase, sparkData: [2, 3, 4, 3, 5, 4, d.totalCases], color: 'hsl(262, 83%, 58%)' },
    { label: 'Resolved', value: d.resolvedCases, prefix: '', icon: CheckCircle2, sparkData: [1, 2, 3, 2, 4, 3, d.resolvedCases], color: 'hsl(142, 71%, 45%)' },
    { label: 'Avg Resolution', value: d.avgResHours, prefix: '', suffix: 'h', icon: Clock, sparkData: [8, 6, 7, 5, 4, 3, d.avgResHours], color: 'hsl(38, 92%, 50%)' },
    { label: 'Rating', value: Number(d.rating), prefix: '', suffix: '/5', icon: Star, sparkData: [4, 4.2, 4.3, 4.5, 4.4, 4.6, Number(d.rating)], color: 'hsl(45, 93%, 47%)' },
    { label: 'Billable Hours', value: d.totalHours, prefix: '', suffix: 'h', icon: TrendingUp, sparkData: [10, 15, 12, 18, 20, 16, d.totalHours], color: 'hsl(190, 80%, 42%)' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Performance Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Track your earnings, cases, and performance metrics</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs value={timeRange} onValueChange={(v) => {
            const r = v as '7d' | '30d' | '90d';
            setTimeRange(r);
            setDateFrom(subDays(new Date(), r === '7d' ? 7 : r === '30d' ? 30 : 90));
            setDateTo(new Date());
          }}>
            <TabsList className="h-8">
              <TabsTrigger value="7d" className="text-xs px-3 h-7">7D</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs px-3 h-7">30D</TabsTrigger>
              <TabsTrigger value="90d" className="text-xs px-3 h-7">90D</TabsTrigger>
            </TabsList>
          </Tabs>
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
          <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={() => d.casesExport.length > 0 && exportToCSV(d.casesExport, 'consultant_cases')}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={() => exportToPDF('Consultant Performance Report', [
            { heading: 'Cases', data: d.casesExport },
            { heading: 'Earnings', data: d.earningsExport },
          ])}>
            <FileText className="w-3.5 h-3.5" /> PDF
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 stagger-fade">
        {kpis.map((kpi, i) => (
          <Card key={i} className="rounded-2xl border-border/50 card-interactive gradient-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <kpi.icon className="w-4 h-4 text-accent" />
                <Sparkline data={kpi.sparkData} color={kpi.color} width={48} height={16} />
              </div>
              {isLoading ? <Skeleton className="h-7 w-16" /> : (
                <div className="text-xl font-bold text-foreground">
                  <AnimatedCounter value={kpi.value} prefix={kpi.prefix} decimals={kpi.label === 'Rating' ? 1 : 0} />
                  {kpi.suffix && <span className="text-sm font-normal text-muted-foreground">{kpi.suffix}</span>}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Earnings Trend + Rating Trend */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Earnings Trend</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : d.earningsTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No earnings data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.earningsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" fontSize={10} tickLine={false} />
                  <YAxis fontSize={10} tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Earned']} />
                  <Bar dataKey="amount" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Rating Over Time</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : d.ratingTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No ratings yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.ratingTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="index" fontSize={10} tickLine={false} label={{ value: 'Review #', position: 'bottom', fontSize: 10 }} />
                  <YAxis fontSize={10} tickLine={false} domain={[0, 5]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="score" stroke="hsl(45, 93%, 47%)" strokeWidth={1} dot={{ r: 3 }} name="Score" />
                  <Line type="monotone" dataKey="avg" stroke="hsl(262, 83%, 58%)" strokeWidth={2} dot={false} name="Running Avg" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Module + Session Breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Cases by SAP Module</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            {isLoading ? <Skeleton className="h-[200px] w-[200px] rounded-full" /> : d.moduleData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16">No case data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={d.moduleData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value">
                    {d.moduleData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Session Types</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            {isLoading ? <Skeleton className="h-[200px] w-[200px] rounded-full" /> : d.sessionTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16">No session data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={d.sessionTypeData} cx="50%" cy="50%" outerRadius={85} dataKey="value" label>
                    {d.sessionTypeData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
