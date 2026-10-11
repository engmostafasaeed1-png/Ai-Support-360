import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Download, FileText, Ticket, Clock, DollarSign, Users, TrendingUp, CheckCircle2 } from 'lucide-react';
import { format, subDays, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import { exportToCSV, exportToPDF } from '@/components/reports/exportUtils';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Sparkline } from '@/components/ui/sparkline';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';

const COLORS = [
  'hsl(217, 91%, 60%)', 'hsl(45, 93%, 47%)', 'hsl(262, 83%, 58%)',
  'hsl(142, 76%, 36%)', 'hsl(0, 72%, 51%)', 'hsl(190, 80%, 42%)',
];

const tooltipStyle = {
  borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12,
  backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))',
};

export default function ReportsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { tenant } = useTenant();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(() => new Date());
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  // another company has other modules: the module filter starts again
  useEffect(() => { setModuleFilter('all'); }, [tenant?.id]);

  const { data, isLoading } = useQuery({
    queryKey: ['client-reports', tenant?.id ?? null, timeRange, dateFrom.toISOString(), dateTo.toISOString(), moduleFilter],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const fromISO = startOfDay(dateFrom).toISOString();
      const toISO = startOfDay(subDays(dateTo, -1)).toISOString();

      // Tickets of the active company (the user's own and, read-only, their colleagues'); without a company the user's own
      const ticketBase = supabase
        .from('tickets')
        .select('id, title, status, sap_module, urgency, created_at, resolved_at, consultant_id');
      const { data: tickets } = await (tenant?.id ? ticketBase.eq('tenant_id', tenant.id) : ticketBase.eq('client_id', user.id));

      const companyTickets = tickets || [];
      const modules = [...new Set(companyTickets.map(tk => tk.sap_module).filter(Boolean))].sort() as string[];
      const inModule = (tk: { sap_module: string | null }) => moduleFilter === 'all' || tk.sap_module === moduleFilter;
      const allTickets = companyTickets.filter(inModule);
      const moduleTicketIds = new Set(allTickets.map(tk => tk.id));
      const rangeTickets = allTickets.filter(tk => tk.created_at >= fromISO && tk.created_at < toISO);

      // Status breakdown
      const statusCounts: Record<string, number> = {};
      rangeTickets.forEach(tk => { const key = tk.status || 'unknown'; statusCounts[key] = (statusCounts[key] || 0) + 1; });
      const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));

      // Module breakdown
      const moduleCounts: Record<string, number> = {};
      rangeTickets.forEach(tk => { moduleCounts[tk.sap_module] = (moduleCounts[tk.sap_module] || 0) + 1; });
      const moduleData = Object.entries(moduleCounts)
        .map(([module, count]) => ({ module, count, pct: Math.round(count / (rangeTickets.length || 1) * 100) }))
        .sort((a, b) => b.count - a.count);

      // Daily trend
      const days = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / 86400000);
      const dailyTrend: { day: string; created: number; resolved: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = subDays(dateTo, i);
        const dayStr = days <= 14 ? format(d, 'EEE') : format(d, 'MMM d');
        const dayStart = startOfDay(d).toISOString();
        const dayEnd = startOfDay(subDays(d, -1)).toISOString();
        dailyTrend.push({
          day: dayStr,
          created: allTickets.filter(tk => tk.created_at >= dayStart && tk.created_at < dayEnd).length,
          resolved: allTickets.filter(tk => tk.resolved_at && tk.resolved_at >= dayStart && tk.resolved_at < dayEnd).length,
        });
      }

      // Payments of the active company (a payment that belongs to no company shows in every company)
      const payBase = supabase
        .from('payments')
        .select('amount, status, created_at, currency, ticket_id')
        .eq('client_id', user.id);
      const { data: payments } = await (tenant?.id ? payBase.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`) : payBase);

      const allPayments = (payments || []).filter(p => moduleFilter === 'all' || (p.ticket_id && moduleTicketIds.has(p.ticket_id)));
      const rangePayments = allPayments.filter(p => p.created_at >= fromISO && p.created_at < toISO);
      const totalSpent = rangePayments.filter(p => p.status === 'completed').reduce((s, p) => s + Number(p.amount), 0);
      const pending = rangePayments.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0);

      // Monthly spend of the selected period (the same period as the tiles)
      const monthlySpend: Record<string, number> = {};
      [...rangePayments].filter(p => p.status === 'completed').sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(p => {
        const m = format(new Date(p.created_at), 'MMM');
        monthlySpend[m] = (monthlySpend[m] || 0) + Number(p.amount);
      });
      const spendTrend = Object.entries(monthlySpend).map(([month, amount]) => ({ month, amount: Math.round(amount) }));

      // Sessions of the active company
      const sessBase = supabase
        .from('sessions')
        .select('id, status, session_type, duration_minutes, created_at, ticket_id')
        .eq('client_id', user.id);
      const { data: sessions } = await (tenant?.id ? sessBase.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`) : sessBase);

      const rangeSessions = (sessions || [])
        .filter(s => moduleFilter === 'all' || (s.ticket_id && moduleTicketIds.has(s.ticket_id)))
        .filter(s => s.created_at >= fromISO && s.created_at < toISO);
      const totalSessionMin = rangeSessions.reduce((s, se) => s + (se.duration_minutes || 0), 0);

      // Avg resolution
      const resolved = rangeTickets.filter(tk => tk.resolved_at);
      let avgResHours = 0;
      if (resolved.length > 0) {
        avgResHours = Math.round(resolved.reduce((s, tk) => s + (new Date(tk.resolved_at!).getTime() - new Date(tk.created_at).getTime()), 0) / resolved.length / 3600000);
      }

      return {
        modules,
        totalTickets: rangeTickets.length,
        resolvedCount: resolved.length,
        totalSpent,
        pending,
        avgResHours,
        totalSessions: rangeSessions.length,
        totalSessionMin,
        statusData,
        moduleData,
        dailyTrend,
        spendTrend,
        // For export
        ticketsExport: rangeTickets.map(tk => ({
          Title: tk.title, Status: tk.status || 'unknown', Module: tk.sap_module, Urgency: tk.urgency || 'medium',
          Created: format(new Date(tk.created_at), 'PPP'),
          Resolved: tk.resolved_at ? format(new Date(tk.resolved_at), 'PPP') : '—',
        })),
        paymentsExport: rangePayments.map(p => ({
          Amount: `$${Number(p.amount).toFixed(2)}`, Status: p.status || 'unknown',
          Date: format(new Date(p.created_at), 'PPP'), Currency: p.currency || 'USD',
        })),
      };
    },
    enabled: !isGuest,
  });

  const d = data || {
    modules: [] as string[], totalTickets: 0, resolvedCount: 0, totalSpent: 0, pending: 0, avgResHours: 0,
    totalSessions: 0, totalSessionMin: 0, statusData: [], moduleData: [],
    dailyTrend: [], spendTrend: [], ticketsExport: [], paymentsExport: [],
  };

  const kpis = [
    { label: 'Total Tickets', value: d.totalTickets, prefix: '', icon: Ticket, sparkData: [] as number[], color: 'hsl(var(--accent))' },
    { label: 'Resolved', value: d.resolvedCount, prefix: '', icon: CheckCircle2, sparkData: [] as number[], color: 'hsl(142, 71%, 45%)' },
    { label: 'Avg Resolution', value: d.avgResHours, prefix: '', suffix: 'h', icon: Clock, sparkData: [] as number[], color: 'hsl(38, 92%, 50%)' },
    { label: 'Total Spent', value: d.totalSpent, prefix: '$', icon: DollarSign, sparkData: [] as number[], color: 'hsl(262, 83%, 58%)' },
    { label: 'Sessions', value: d.totalSessions, prefix: '', icon: Users, sparkData: [] as number[], color: 'hsl(190, 80%, 42%)' },
    { label: 'Resolution Rate', value: d.totalTickets > 0 ? Math.round(d.resolvedCount / d.totalTickets * 100) : 0, prefix: '', suffix: '%', icon: TrendingUp, sparkData: [] as number[], color: 'hsl(142, 71%, 45%)' },
  ];

  // an empty period says so (exportToCSV shows the message)
  const handleExportCSV = () => exportToCSV(d.ticketsExport, 'tickets_report');

  const handleExportPDF = () => {
    if (d.ticketsExport.length === 0 && d.paymentsExport.length === 0) {
      toast.info('There is no data to export for the selected period.');
      return;
    }
    exportToPDF('Client Analytics Report', [
      {
        heading: 'Summary',
        data: [
          { Item: 'Period', Value: `${format(dateFrom, 'PPP')} - ${format(dateTo, 'PPP')}` },
          { Item: 'SAP module', Value: moduleFilter === 'all' ? 'All modules' : moduleFilter },
          { Item: 'Tickets', Value: d.totalTickets },
          { Item: 'Resolved', Value: d.resolvedCount },
          { Item: 'Sessions', Value: d.totalSessions },
          { Item: 'Total spent', Value: `$${d.totalSpent.toFixed(2)}` },
        ],
      },
      { heading: 'Tickets', data: d.ticketsExport },
      { heading: 'Payments', data: d.paymentsExport },
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('sidebar.reports', 'Reports & Analytics')}</h1>
          <p className="text-sm text-muted-foreground mt-1">Performance overview and spending insights</p>
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
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, to) => { setDateFrom(f); setDateTo(to); }} />
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="SAP module filter">
              <SelectValue placeholder="All modules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {d.modules.map((m: string) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={handleExportCSV}>
            <Download className="w-3.5 h-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={handleExportPDF}>
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
                  <AnimatedCounter value={kpi.value} prefix={kpi.prefix} />
                  {kpi.suffix && <span className="text-sm font-normal text-muted-foreground">{kpi.suffix}</span>}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ticket Activity + Spend Trend */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Ticket Activity</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={d.dailyTrend}>
                  <defs>
                    <linearGradient id="createdGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" fontSize={10} tickLine={false} />
                  <YAxis fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area type="monotone" dataKey="created" stroke="hsl(217, 91%, 60%)" fill="url(#createdGrad)" name="Created" />
                  <Area type="monotone" dataKey="resolved" stroke="hsl(142, 76%, 36%)" fill="hsl(142, 76%, 36%)" fillOpacity={0.1} name="Resolved" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Monthly Spend</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : d.spendTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No spend in this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.spendTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" fontSize={10} tickLine={false} />
                  <YAxis fontSize={10} tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Spend']} />
                  <Bar dataKey="amount" fill="hsl(262, 83%, 58%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status + Module Breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Ticket Status</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            {isLoading ? <Skeleton className="h-[200px] w-[200px] rounded-full" /> : d.statusData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16">No ticket data</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={d.statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value">
                    {d.statusData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-base">Tickets by SAP Module</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-[220px]" /> : d.moduleData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-16 text-center">No module data</p>
            ) : (
              <div className="space-y-3">
                {d.moduleData.map((item: any, i: number) => (
                  <div key={item.module} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground font-medium">{item.module}</span>
                      <span className="text-muted-foreground text-xs">{item.count} ({item.pct}%)</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${item.pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
