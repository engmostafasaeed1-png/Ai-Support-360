import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PullToRefresh } from '@/components/PullToRefresh';
import {
  Users, Ticket, DollarSign, TrendingUp, Shield, Server,
  Activity, Database, Clock, CheckCircle, AlertTriangle, Zap,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { useAdminStats } from '@/hooks/useAdminData';

const systemMetrics = [
  { label: 'API Uptime', value: '99.97%', status: 'healthy', icon: Activity },
  { label: 'Database', value: '12ms avg', status: 'healthy', icon: Database },
  { label: 'Edge Functions', value: '8 active', status: 'healthy', icon: Zap },
  { label: 'Storage', value: '2.4GB / 5GB', status: 'warning', icon: Server },
];

const recentActivity = [
  { action: 'User signed up', user: 'mohammed@acme.sa', time: '2 min ago', type: 'user' },
  { action: 'Ticket resolved', user: 'sarah.j', time: '5 min ago', type: 'ticket' },
  { action: 'Role changed to admin', user: 'admin@qurtuba.com', time: '12 min ago', type: 'security' },
  { action: 'Payment completed', user: 'client@corp.com', time: '18 min ago', type: 'payment' },
  { action: 'Consultant approved', user: 'david.p', time: '25 min ago', type: 'approval' },
  { action: 'NDA signed', user: 'lisa.c', time: '32 min ago', type: 'nda' },
];

const roleDistribution = [
  { name: 'Clients', value: 68, color: 'hsl(217, 91%, 60%)' },
  { name: 'Consultants', value: 24, color: 'hsl(142, 76%, 36%)' },
  { name: 'Admins', value: 8, color: 'hsl(38, 92%, 50%)' },
];

const hourlyTraffic = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i}:00`,
  requests: Math.floor(Math.random() * 500 + 100),
  errors: Math.floor(Math.random() * 10),
}));

export default function SuperAdminOverview() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useAdminStats();
  const s = stats || { totalUsers: 0, activeConsultants: 0, openTickets: 0, revenue: 0, pendingApprovals: 0 };

  const kpis = [
    { label: t('super_admin.total_users', 'Total Users'), value: s.totalUsers, icon: Users, color: 'text-accent' },
    { label: t('super_admin.active_consultants', 'Active Consultants'), value: s.activeConsultants, icon: Shield, color: 'text-green-500' },
    { label: t('super_admin.open_tickets', 'Open Tickets'), value: s.openTickets, icon: Ticket, color: 'text-amber-500' },
    { label: t('super_admin.revenue', 'Total Revenue'), value: `$${(s.revenue / 1000).toFixed(0)}K`, icon: DollarSign, color: 'text-primary' },
    { label: t('super_admin.pending_approvals', 'Pending Approvals'), value: s.pendingApprovals, icon: AlertTriangle, color: 'text-destructive' },
    { label: t('super_admin.uptime', 'System Uptime'), value: '99.97%', icon: CheckCircle, color: 'text-green-500' },
  ];

  const typeIcons: Record<string, string> = {
    user: '👤', ticket: '🎫', security: '🔒', payment: '💰', approval: '✅', nda: '📝',
  };

  return (
    <PullToRefresh>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.overview_title', 'Super Admin Overview')}</h1>
          <p className="text-sm text-muted-foreground">{t('super_admin.overview_subtitle', 'Complete system overview with all metrics and controls')}</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="border-border/50">
              <CardContent className="p-3">
                <kpi.icon className={`w-5 h-5 ${kpi.color} mb-1`} />
                <p className="text-xl font-bold text-foreground">{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* System Health */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {systemMetrics.map((m) => (
            <Card key={m.label} className="border-border/50">
              <CardContent className="p-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  m.status === 'healthy' ? 'bg-green-500/10' : 'bg-amber-500/10'
                }`}>
                  <m.icon className={`w-4 h-4 ${m.status === 'healthy' ? 'text-green-500' : 'text-amber-500'}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-sm font-bold text-foreground">{m.value}</p>
                </div>
                <Badge variant="outline" className={`ms-auto text-[9px] ${
                  m.status === 'healthy' ? 'border-green-500/30 text-green-600' : 'border-amber-500/30 text-amber-600'
                }`}>
                  {m.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Traffic Chart */}
          <Card className="border-border/50 md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('super_admin.api_traffic', 'API Traffic (24h)')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={hourlyTraffic}>
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <defs>
                    <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area dataKey="requests" stroke="hsl(217, 91%, 60%)" fill="url(#trafficGrad)" strokeWidth={2} name="Requests" />
                  <Line dataKey="errors" stroke="hsl(0, 72%, 51%)" strokeWidth={1.5} dot={false} name="Errors" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Role Distribution */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('super_admin.role_distribution', 'Role Distribution')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={roleDistribution} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={3}>
                    {roleDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {roleDistribution.map((r) => (
                  <div key={r.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                      <span className="text-muted-foreground">{r.name}</span>
                    </div>
                    <span className="font-medium">{r.value}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('super_admin.recent_activity', 'Recent Activity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.map((a, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-lg">{typeIcons[a.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{a.action}</p>
                    <p className="text-xs text-muted-foreground">{a.user}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{a.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PullToRefresh>
  );
}
