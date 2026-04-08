import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, UserCheck, Ticket, TrendingUp, DollarSign, Star, AlertTriangle, BarChart3 } from 'lucide-react';
import { useAdminStats } from '@/hooks/useAdminData';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Sparkline } from '@/components/ui/sparkline';

export default function OverviewSection() {
  const { data: stats, isLoading } = useAdminStats();
  const s = stats || { totalUsers: 0, activeConsultants: 0, openTickets: 0, revenue: 0, avgResolutionTime: '—', satisfaction: 0, ticketsThisMonth: 0, pendingApprovals: 0 };

  const kpis = [
    { label: 'Total Users', value: s.totalUsers, icon: Users, sparkData: [50, 80, 100, 130, 160, 190, s.totalUsers], color: 'hsl(var(--accent))' },
    { label: 'Active Consultants', value: s.activeConsultants, icon: UserCheck, sparkData: [5, 8, 10, 12, 15, 18, s.activeConsultants], color: 'hsl(142, 71%, 45%)' },
    { label: 'Open Tickets', value: s.openTickets, icon: Ticket, sparkData: [10, 15, 12, 18, 20, 16, s.openTickets], color: 'hsl(38, 92%, 50%)' },
    { label: 'Revenue', value: Math.round(s.revenue / 1000), prefix: '$', suffix: 'K', icon: DollarSign, sparkData: [20, 30, 25, 35, 40, 38, Math.round(s.revenue / 1000)], color: 'hsl(262, 83%, 58%)' },
    { label: 'Avg Resolution', value: 0, displayValue: s.avgResolutionTime, icon: TrendingUp, sparkData: [5, 4.5, 4, 3.5, 3, 2.5, 2], color: 'hsl(var(--accent))' },
    { label: 'Satisfaction', value: s.satisfaction, suffix: '/5', icon: Star, sparkData: [3.8, 4.0, 4.2, 4.1, 4.3, 4.5, s.satisfaction], color: 'hsl(38, 92%, 50%)' },
    { label: 'Tickets This Month', value: s.ticketsThisMonth, icon: TrendingUp, sparkData: [20, 25, 30, 28, 35, 32, s.ticketsThisMonth], color: 'hsl(142, 71%, 45%)' },
    { label: 'Pending Approvals', value: s.pendingApprovals, icon: AlertTriangle, sparkData: [3, 5, 4, 6, 3, 4, s.pendingApprovals], color: 'hsl(0, 84%, 60%)' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" /> Overview & Analytics
        </h2>
        <p className="text-sm text-muted-foreground">Platform-wide statistics at a glance</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="border-border/50 rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                  <kpi.icon className="w-4 h-4 text-accent" />
                </div>
                <Sparkline data={kpi.sparkData} color={kpi.color} width={56} height={18} />
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-bold text-foreground">
                  {(kpi as any).displayValue || <AnimatedCounter value={kpi.value} prefix={kpi.prefix || ''} />}
                  {(kpi as any).suffix && <span className="text-sm font-normal text-muted-foreground">{(kpi as any).suffix}</span>}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Role Distribution */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Role Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: 'Clients', value: Math.max(0, s.totalUsers - s.activeConsultants - s.pendingApprovals), color: 'bg-primary' },
              { label: 'Consultants', value: s.activeConsultants, color: 'bg-accent' },
              { label: 'Pending', value: s.pendingApprovals, color: 'bg-destructive' },
            ].map((item) => (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-medium text-foreground">{item.value}</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.color}`}
                    style={{ width: `${s.totalUsers > 0 ? (item.value / s.totalUsers) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Pending Approvals', count: s.pendingApprovals, variant: 'destructive' as const },
              { label: 'Open Tickets', count: s.openTickets, variant: 'secondary' as const },
              { label: 'New This Month', count: s.ticketsThisMonth, variant: 'outline' as const },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm text-foreground">{item.label}</span>
                <Badge variant={item.variant}>{item.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
