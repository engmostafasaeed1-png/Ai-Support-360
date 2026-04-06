import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BarChart3, Download, TrendingUp, TrendingDown, DollarSign,
  Users, Ticket, Calendar, Filter, FileText,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { toast } from 'sonner';

const monthlyRevenue = [
  { month: 'Jan', revenue: 42000, expenses: 18000, profit: 24000 },
  { month: 'Feb', revenue: 56000, expenses: 22000, profit: 34000 },
  { month: 'Mar', revenue: 48000, expenses: 19000, profit: 29000 },
  { month: 'Apr', revenue: 62000, expenses: 24000, profit: 38000 },
  { month: 'May', revenue: 71000, expenses: 28000, profit: 43000 },
  { month: 'Jun', revenue: 85000, expenses: 32000, profit: 53000 },
];

const ticketsByModule = [
  { module: 'SAP FI', count: 145, resolved: 132 },
  { module: 'SAP MM', count: 98, resolved: 89 },
  { module: 'SAP SD', count: 76, resolved: 71 },
  { module: 'SAP HR', count: 54, resolved: 48 },
  { module: 'SAP BASIS', count: 42, resolved: 38 },
  { module: 'SAP ABAP', count: 38, resolved: 35 },
  { module: 'SAP BW', count: 28, resolved: 25 },
];

const consultantMetrics = [
  { name: 'Sarah J.', sessions: 42, rating: 4.9, revenue: 12600, responseTime: 12, satisfactionRate: 98 },
  { name: 'Lisa C.', sessions: 38, rating: 4.8, revenue: 11400, responseTime: 15, satisfactionRate: 96 },
  { name: 'David P.', sessions: 35, rating: 4.7, revenue: 10500, responseTime: 18, satisfactionRate: 94 },
  { name: 'Amira H.', sessions: 31, rating: 4.6, revenue: 9300, responseTime: 22, satisfactionRate: 92 },
  { name: 'Michael T.', sessions: 28, rating: 4.5, revenue: 8400, responseTime: 25, satisfactionRate: 90 },
];

const clientRetention = [
  { month: 'Jan', newClients: 45, returning: 180, churnRate: 3.2 },
  { month: 'Feb', newClients: 52, returning: 195, churnRate: 2.8 },
  { month: 'Mar', newClients: 61, returning: 218, churnRate: 2.5 },
  { month: 'Apr', newClients: 48, returning: 230, churnRate: 2.1 },
  { month: 'May', newClients: 67, returning: 255, churnRate: 1.9 },
  { month: 'Jun', newClients: 73, returning: 282, churnRate: 1.7 },
];

const paymentStatus = [
  { name: 'Completed', value: 78, color: 'hsl(142, 76%, 36%)' },
  { name: 'Pending', value: 15, color: 'hsl(38, 92%, 50%)' },
  { name: 'Refunded', value: 5, color: 'hsl(217, 91%, 60%)' },
  { name: 'Disputed', value: 2, color: 'hsl(0, 72%, 51%)' },
];

export default function ReportsPage() {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState('6months');

  const handleExport = (reportType: string) => {
    toast.success(t('super_admin.report_exported', `${reportType} report exported as CSV`));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.reports_title', 'Reports & Analytics')}</h1>
          <p className="text-sm text-muted-foreground">{t('super_admin.reports_subtitle', 'Comprehensive business intelligence and data reports')}</p>
        </div>
        <div className="flex gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-36 h-9 text-xs">
              <Calendar className="w-3 h-3 me-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
              <SelectItem value="3months">Last 3 Months</SelectItem>
              <SelectItem value="6months">Last 6 Months</SelectItem>
              <SelectItem value="1year">Last Year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => handleExport('Full')}>
            <Download className="w-3.5 h-3.5 me-1" />
            {t('super_admin.export_all', 'Export All')}
          </Button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue', value: '$364K', change: '+18%', up: true, icon: DollarSign },
          { label: 'Total Tickets', value: '481', change: '+12%', up: true, icon: Ticket },
          { label: 'Active Users', value: '1,950', change: '+22%', up: true, icon: Users },
          { label: 'Avg Resolution', value: '28 min', change: '-15%', up: false, icon: TrendingDown },
        ].map((kpi) => (
          <Card key={kpi.label} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <kpi.icon className="w-4 h-4 text-muted-foreground" />
                <Badge variant="outline" className={`text-[9px] ${kpi.up ? 'text-green-600 border-green-500/30' : 'text-amber-600 border-amber-500/30'}`}>
                  {kpi.change}
                </Badge>
              </div>
              <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="financial" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="financial">{t('super_admin.financial', 'Financial')}</TabsTrigger>
          <TabsTrigger value="tickets_report">{t('super_admin.tickets_report', 'Tickets')}</TabsTrigger>
          <TabsTrigger value="consultants_report">{t('super_admin.consultants_report', 'Consultants')}</TabsTrigger>
          <TabsTrigger value="clients_report">{t('super_admin.clients_report', 'Client Retention')}</TabsTrigger>
        </TabsList>

        {/* Financial Reports */}
        <TabsContent value="financial">
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="border-border/50 md:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t('super_admin.revenue_breakdown', 'Revenue vs Expenses vs Profit')}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => handleExport('Revenue')}>
                    <Download className="w-3 h-3 me-1" /> CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyRevenue}>
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v/1000}K`} />
                    <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                    <Bar dataKey="revenue" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="Revenue" />
                    <Bar dataKey="expenses" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} name="Expenses" />
                    <Bar dataKey="profit" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} name="Profit" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('super_admin.payment_status', 'Payment Status')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={paymentStatus} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                      {paymentStatus.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {paymentStatus.map((p) => (
                    <div key={p.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-muted-foreground">{p.name}</span>
                      </div>
                      <span className="font-medium">{p.value}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tickets Report */}
        <TabsContent value="tickets_report">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('super_admin.tickets_by_module', 'Tickets by SAP Module')}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => handleExport('Tickets')}>
                  <Download className="w-3 h-3 me-1" /> CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={ticketsByModule} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="module" type="category" tick={{ fontSize: 12 }} width={70} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(217, 91%, 60%)" radius={[0, 4, 4, 0]} name="Created" />
                  <Bar dataKey="resolved" fill="hsl(142, 76%, 36%)" radius={[0, 4, 4, 0]} name="Resolved" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Consultant Performance */}
        <TabsContent value="consultants_report">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('super_admin.consultant_performance', 'Consultant Performance')}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => handleExport('Consultants')}>
                  <Download className="w-3 h-3 me-1" /> CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">#</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">Consultant</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">Sessions</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">Rating</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">Revenue</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">Avg Response</th>
                      <th className="text-start py-3 px-4 font-medium text-muted-foreground">Satisfaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {consultantMetrics.map((c, i) => (
                      <tr key={c.name} className="hover:bg-muted/20">
                        <td className="py-3 px-4 font-bold text-muted-foreground">#{i + 1}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center text-[10px] font-bold text-accent">
                              {c.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <span className="font-medium">{c.name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">{c.sessions}</td>
                        <td className="py-3 px-4">⭐ {c.rating}</td>
                        <td className="py-3 px-4 font-medium">${c.revenue.toLocaleString()}</td>
                        <td className="py-3 px-4">{c.responseTime} min</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                            {c.satisfactionRate}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Client Retention */}
        <TabsContent value="clients_report">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('super_admin.client_retention', 'Client Retention & Growth')}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => handleExport('Clients')}>
                  <Download className="w-3 h-3 me-1" /> CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={clientRetention}>
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <defs>
                    <linearGradient id="newGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area dataKey="returning" stroke="hsl(142, 76%, 36%)" fill="url(#retGrad)" strokeWidth={2} name="Returning" />
                  <Area dataKey="newClients" stroke="hsl(217, 91%, 60%)" fill="url(#newGrad)" strokeWidth={2} name="New Clients" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
