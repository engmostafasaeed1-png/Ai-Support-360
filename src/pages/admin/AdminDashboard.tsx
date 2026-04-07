import { useTranslation } from 'react-i18next';
import { PullToRefresh } from '@/components/PullToRefresh';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Ticket, DollarSign, Clock, Star, TrendingUp, UserCheck, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAdminStats } from '@/hooks/useAdminData';
import { revenueData, ticketsByStatus, ticketsByModule } from '@/data/adminMockData';
import { Link } from 'react-router-dom';
import { revenueData, ticketsByStatus, ticketsByModule } from '@/data/adminMockData';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useAdminStats();

  const s = stats || { totalUsers: 0, activeConsultants: 0, openTickets: 0, revenue: 0, avgResolutionTime: '—', satisfaction: 0, ticketsThisMonth: 0, pendingApprovals: 0 };

  const kpis = [
    { labelKey: 'admin_dashboard.total_users', value: s.totalUsers.toLocaleString(), icon: Users, change: '', link: '/admin/users' },
    { labelKey: 'admin_dashboard.active_consultants', value: s.activeConsultants.toString(), icon: UserCheck, change: '', link: '/admin/approvals' },
    { labelKey: 'admin_dashboard.open_tickets', value: s.openTickets.toString(), icon: Ticket, change: '', link: '/admin/tickets' },
    { labelKey: 'admin_dashboard.monthly_revenue', value: `$${(s.revenue / 1000).toFixed(0)}K`, icon: DollarSign, change: '', link: '/admin/analytics' },
    { labelKey: 'admin_dashboard.avg_resolution', value: s.avgResolutionTime, icon: Clock, change: '', link: '/admin/analytics' },
    { labelKey: 'admin_dashboard.satisfaction', value: `${s.satisfaction}/5`, icon: Star, change: '', link: '/admin/analytics' },
    { labelKey: 'admin_dashboard.tickets_this_month', value: s.ticketsThisMonth.toString(), icon: TrendingUp, change: '', link: '/admin/tickets' },
    { labelKey: 'admin_dashboard.pending_approvals', value: s.pendingApprovals.toString(), icon: AlertTriangle, change: '', link: '/admin/approvals' },
  ];

  return (
    <PullToRefresh>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin_dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin_dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Link key={kpi.labelKey} to={kpi.link}>
            <Card className="border-border/50 hover:shadow-premium transition-all cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                    <kpi.icon className="w-4 h-4 text-accent" />
                  </div>
                </div>
                {isLoading ? <Skeleton className="h-8 w-16" /> : (
                  <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
                )}
                <p className="text-xs text-muted-foreground">{t(kpi.labelKey)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('admin_dashboard.revenue_vs_expenses')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={revenueData}>
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v / 1000}K`} />
                <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                <Bar dataKey="revenue" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="Revenue" />
                <Bar dataKey="expenses" fill="hsl(214, 32%, 91%)" radius={[4, 4, 0, 0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('admin_dashboard.tickets_by_status')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie data={ticketsByStatus} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                    {ticketsByStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {ticketsByStatus.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
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

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('admin_dashboard.tickets_by_module')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ticketsByModule} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="module" type="category" tick={{ fontSize: 12 }} width={70} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(226, 53%, 22%)" radius={[0, 4, 4, 0]} name="Tickets" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
    </PullToRefresh>
  );
}
