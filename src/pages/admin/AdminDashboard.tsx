import { useTranslation } from 'react-i18next';
import { PullToRefresh } from '@/components/PullToRefresh';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Ticket, DollarSign, Clock, Star, TrendingUp, UserCheck, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAdminStats } from '@/hooks/useAdminData';
import { revenueData, ticketsByStatus, ticketsByModule } from '@/data/adminMockData';
import { Link } from 'react-router-dom';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Sparkline } from '@/components/ui/sparkline';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useAdminStats();

  const s = stats || { totalUsers: 0, activeConsultants: 0, openTickets: 0, revenue: 0, avgResolutionTime: '—', satisfaction: 0, ticketsThisMonth: 0, pendingApprovals: 0 };

  const kpis = [
    { labelKey: 'admin_dashboard.total_users', value: s.totalUsers, prefix: '', icon: Users, link: '/admin/users', sparkData: [50, 80, 100, 130, 160, 190, s.totalUsers], color: 'hsl(var(--accent))' },
    { labelKey: 'admin_dashboard.active_consultants', value: s.activeConsultants, prefix: '', icon: UserCheck, link: '/admin/approvals', sparkData: [5, 8, 10, 12, 15, 18, s.activeConsultants], color: 'hsl(142, 71%, 45%)' },
    { labelKey: 'admin_dashboard.open_tickets', value: s.openTickets, prefix: '', icon: Ticket, link: '/admin/tickets', sparkData: [10, 15, 12, 18, 20, 16, s.openTickets], color: 'hsl(38, 92%, 50%)' },
    { labelKey: 'admin_dashboard.monthly_revenue', value: Math.round(s.revenue / 1000), prefix: '$', suffix: 'K', icon: DollarSign, link: '/admin/analytics', sparkData: [20, 30, 25, 35, 40, 38, Math.round(s.revenue / 1000)], color: 'hsl(262, 83%, 58%)' },
    { labelKey: 'admin_dashboard.avg_resolution', value: 0, displayValue: s.avgResolutionTime, icon: Clock, link: '/admin/analytics', sparkData: [5, 4.5, 4, 3.5, 3, 2.5, 2], color: 'hsl(var(--accent))' },
    { labelKey: 'admin_dashboard.satisfaction', value: s.satisfaction, prefix: '', suffix: '/5', icon: Star, link: '/admin/analytics', sparkData: [3.8, 4.0, 4.2, 4.1, 4.3, 4.5, s.satisfaction], color: 'hsl(38, 92%, 50%)' },
    { labelKey: 'admin_dashboard.tickets_this_month', value: s.ticketsThisMonth, prefix: '', icon: TrendingUp, link: '/admin/tickets', sparkData: [20, 25, 30, 28, 35, 32, s.ticketsThisMonth], color: 'hsl(142, 71%, 45%)' },
    { labelKey: 'admin_dashboard.pending_approvals', value: s.pendingApprovals, prefix: '', icon: AlertTriangle, link: '/admin/approvals', sparkData: [3, 5, 4, 6, 3, 4, s.pendingApprovals], color: 'hsl(0, 84%, 60%)' },
  ];

  return (
    <PullToRefresh>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin_dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin_dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger-fade">
        {kpis.map((kpi) => (
          <Link key={kpi.labelKey} to={kpi.link}>
            <Card className="border-border/50 card-interactive gradient-border rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                    <kpi.icon className="w-4 h-4 text-accent" />
                  </div>
                  <Sparkline data={kpi.sparkData} color={kpi.color} width={56} height={18} />
                </div>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-2xl font-bold text-foreground">
                    {(kpi as any).displayValue || <AnimatedCounter value={kpi.value} prefix={kpi.prefix || ''} />}
                    {(kpi as any).suffix && <span className="text-sm font-normal text-muted-foreground">{(kpi as any).suffix}</span>}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{t(kpi.labelKey)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/50 rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('admin_dashboard.revenue_vs_expenses')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={revenueData}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v / 1000}K`} />
                <Tooltip
                  formatter={(v: number) => `$${v.toLocaleString()}`}
                  contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }}
                />
                <Bar dataKey="revenue" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="Revenue" />
                <Bar dataKey="expenses" fill="hsl(214, 32%, 91%)" radius={[4, 4, 0, 0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50 rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('admin_dashboard.tickets_by_status')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
              <ResponsiveContainer width="100%" height={180} className="sm:max-w-[50%]">
                <PieChart>
                  <Pie data={ticketsByStatus} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {ticketsByStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 w-full sm:flex-1">
                {ticketsByStatus.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-muted-foreground">{s.name}</span>
                    </div>
                    <span className="font-medium text-foreground">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('admin_dashboard.tickets_by_module')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ticketsByModule} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="module" type="category" tick={{ fontSize: 12 }} width={70} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
              <Bar dataKey="count" fill="hsl(226, 53%, 22%)" radius={[0, 4, 4, 0]} name="Tickets" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
    </PullToRefresh>
  );
}
