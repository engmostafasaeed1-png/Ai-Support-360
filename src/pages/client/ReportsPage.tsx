import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, TrendingUp, Ticket, Clock, DollarSign, Users } from 'lucide-react';

const stats = [
  { label: 'Total Tickets', value: '47', change: '+12%', icon: Ticket, color: 'text-primary' },
  { label: 'Avg Resolution', value: '18.4 hrs', change: '-8%', icon: Clock, color: 'text-emerald-500' },
  { label: 'Total Spent', value: '$12,840', change: '+5%', icon: DollarSign, color: 'text-amber-500' },
  { label: 'Active Consultants', value: '3', change: '0%', icon: Users, color: 'text-blue-500' },
];

const moduleBreakdown = [
  { module: 'SAP FI/CO', tickets: 18, percentage: 38, color: 'bg-primary' },
  { module: 'SAP MM', tickets: 12, percentage: 26, color: 'bg-blue-500' },
  { module: 'SAP SD', tickets: 9, percentage: 19, color: 'bg-emerald-500' },
  { module: 'SAP ABAP', tickets: 5, percentage: 11, color: 'bg-amber-500' },
  { module: 'SAP Basis', tickets: 3, percentage: 6, color: 'bg-violet-500' },
];

const monthlyTrend = [
  { month: 'Jan', tickets: 5, resolved: 4 },
  { month: 'Feb', tickets: 8, resolved: 7 },
  { month: 'Mar', tickets: 6, resolved: 6 },
  { month: 'Apr', tickets: 11, resolved: 9 },
  { month: 'May', tickets: 9, resolved: 8 },
  { month: 'Jun', tickets: 8, resolved: 8 },
];

export default function ReportsPage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.reports', 'Reports & Analytics')}</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your company's performance and spending</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between mb-2">
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
                <Badge variant="outline" className="text-[10px] font-normal">
                  <TrendingUp className="w-3 h-3 me-1" />
                  {stat.change}
                </Badge>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Tickets by SAP Module
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {moduleBreakdown.map((item) => (
              <div key={item.module} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{item.module}</span>
                  <span className="text-muted-foreground">{item.tickets} tickets ({item.percentage}%)</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.percentage}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Monthly Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {monthlyTrend.map((item) => (
                <div key={item.month} className="flex items-center gap-3">
                  <span className="text-sm w-8 text-muted-foreground">{item.month}</span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden flex">
                      <div className="bg-primary/70 h-full" style={{ width: `${(item.resolved / 12) * 100}%` }} />
                      <div className="bg-primary/20 h-full" style={{ width: `${((item.tickets - item.resolved) / 12) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground w-12">{item.resolved}/{item.tickets}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-primary/70" /> Resolved</div>
                <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-primary/20" /> Open</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
