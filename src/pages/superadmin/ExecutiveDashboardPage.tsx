import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PullToRefresh } from '@/components/PullToRefresh';
import {
  Building2, Users, DollarSign, TrendingUp, TrendingDown,
  Ticket, Clock, Target, ArrowUpRight, ArrowDownRight, Zap,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import { useExecutiveMetrics } from '@/hooks/useExecutiveMetrics';

const TIER_COLORS: Record<string, string> = {
  basic: 'hsl(217, 91%, 60%)',
  professional: 'hsl(142, 76%, 36%)',
  enterprise: 'hsl(38, 92%, 50%)',
};

export default function ExecutiveDashboardPage() {
  const { t } = useTranslation();
  const { data: metrics, isLoading } = useExecutiveMetrics();

  if (isLoading || !metrics) {
    return (
      <div className="space-y-6 p-1">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="border-border/50">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const kpiCards = [
    {
      label: 'Total Tenants',
      value: metrics.totalTenants,
      subtitle: `${metrics.activeTenants} active`,
      icon: Building2,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      label: 'Monthly Recurring Revenue',
      value: `$${metrics.mrr.toLocaleString()}`,
      subtitle: `ARR: $${metrics.arr.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      label: 'Growth Rate',
      value: `${metrics.growthRate.toFixed(1)}%`,
      subtitle: 'month-over-month',
      icon: metrics.growthRate >= 0 ? TrendingUp : TrendingDown,
      color: metrics.growthRate >= 0 ? 'text-green-500' : 'text-destructive',
      bgColor: metrics.growthRate >= 0 ? 'bg-green-500/10' : 'bg-destructive/10',
    },
    {
      label: 'Total Users',
      value: metrics.totalUsers,
      subtitle: `${metrics.activeUsersLast30} active (30d)`,
      icon: Users,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      label: 'Open Tickets',
      value: metrics.openTickets,
      subtitle: `${metrics.resolvedTicketsLast30} resolved (30d)`,
      icon: Ticket,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      label: 'Avg Resolution Time',
      value: metrics.avgResolutionHours > 0 ? `${metrics.avgResolutionHours.toFixed(1)}h` : 'N/A',
      subtitle: 'last 30 days',
      icon: Clock,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Churn Rate',
      value: `${metrics.churnRate.toFixed(1)}%`,
      subtitle: 'all time',
      icon: Target,
      color: metrics.churnRate <= 5 ? 'text-green-500' : 'text-destructive',
      bgColor: metrics.churnRate <= 5 ? 'bg-green-500/10' : 'bg-destructive/10',
    },
    {
      label: 'AI Usage',
      value: metrics.totalTenants > 0 ? `${Math.round((metrics.tierBreakdown.find(t => t.tier !== 'basic')?.count || 0) / metrics.totalTenants * 100)}%` : '0%',
      subtitle: 'tenants with AI access',
      icon: Zap,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  return (
    <PullToRefresh>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Executive Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Business metrics and growth analytics for investors
            </p>
          </div>
          <Badge variant="outline" className="text-xs border-green-500/30 text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 me-1.5 animate-pulse" />
            Live Data
          </Badge>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => (
            <Card key={kpi.label} className="border-border/50 hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-9 h-9 rounded-xl ${kpi.bgColor} flex items-center justify-center`}>
                    <kpi.icon className={`w-4.5 h-4.5 ${kpi.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground tracking-tight">{kpi.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.label}</p>
                <p className="text-[10px] text-muted-foreground/70">{kpi.subtitle}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Revenue & Growth Chart */}
        <div className="grid md:grid-cols-3 gap-6">
          <Card className="border-border/50 md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-500" />
                Revenue Trend (6 months)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={metrics.revenueByMonth}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toLocaleString()}`, 'MRR']}
                    contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(142, 76%, 36%)"
                    fill="url(#revenueGrad)"
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Tier Distribution */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Plan Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {metrics.tierBreakdown.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={metrics.tierBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={60}
                        dataKey="count"
                        nameKey="tier"
                        paddingAngle={4}
                      >
                        {metrics.tierBreakdown.map((entry) => (
                          <Cell key={entry.tier} fill={TIER_COLORS[entry.tier] || '#888'} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 mt-2">
                    {metrics.tierBreakdown.map((item) => (
                      <div key={item.tier} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: TIER_COLORS[item.tier] || '#888' }}
                          />
                          <span className="capitalize text-muted-foreground">{item.tier}</span>
                        </div>
                        <span className="font-semibold">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  No tenants yet
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Ticket Trends */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ticket className="w-4 h-4 text-amber-500" />
              Ticket Volume Trend (6 months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={metrics.ticketTrend}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="opened" fill="hsl(38, 92%, 50%)" radius={[4, 4, 0, 0]} name="Opened" />
                <Bar dataKey="resolved" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} name="Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Investor Highlights */}
        <Card className="border-border/50 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">📊 Key Investor Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-xl bg-background/50">
                <p className="text-xs text-muted-foreground mb-1">LTV Estimate</p>
                <p className="text-xl font-bold text-foreground">
                  ${metrics.mrr > 0 && metrics.churnRate > 0
                    ? Math.round(metrics.mrr / metrics.totalTenants / (metrics.churnRate / 100)).toLocaleString()
                    : metrics.mrr > 0 ? '∞' : '0'}
                </p>
              </div>
              <div className="text-center p-3 rounded-xl bg-background/50">
                <p className="text-xs text-muted-foreground mb-1">ARPU</p>
                <p className="text-xl font-bold text-foreground">
                  ${metrics.totalTenants > 0 ? Math.round(metrics.mrr / metrics.totalTenants) : 0}/mo
                </p>
              </div>
              <div className="text-center p-3 rounded-xl bg-background/50">
                <p className="text-xs text-muted-foreground mb-1">Users per Tenant</p>
                <p className="text-xl font-bold text-foreground">
                  {metrics.totalTenants > 0 ? (metrics.totalUsers / metrics.totalTenants).toFixed(1) : 0}
                </p>
              </div>
              <div className="text-center p-3 rounded-xl bg-background/50">
                <p className="text-xs text-muted-foreground mb-1">Net Revenue Retention</p>
                <p className="text-xl font-bold text-foreground">
                  {metrics.churnRate <= 5 ? '100%+' : `${(100 - metrics.churnRate).toFixed(0)}%`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PullToRefresh>
  );
}
