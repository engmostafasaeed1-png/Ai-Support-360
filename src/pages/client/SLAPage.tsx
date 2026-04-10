import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Clock, CheckCircle2, AlertTriangle, Settings2, BarChart3 } from 'lucide-react';
import SLAPolicyManager from '@/components/client/SLAPolicyManager';

const slaMetrics = [
  { label: 'Avg. First Response', value: '1.2 hrs', target: '< 2 hrs', met: true, progress: 85 },
  { label: 'Avg. Resolution Time', value: '18.4 hrs', target: '< 24 hrs', met: true, progress: 72 },
  { label: 'Uptime This Month', value: '99.8%', target: '≥ 99.5%', met: true, progress: 99.8 },
  { label: 'SLA Breach Rate', value: '3.2%', target: '< 5%', met: true, progress: 36 },
];

const ticketSLA = [
  { id: 'TKT-1041', title: 'SAP FI Month-End Close', priority: 'Critical', responseTime: '0.5 hrs', status: 'On Track' },
  { id: 'TKT-1038', title: 'MM Purchase Order Error', priority: 'High', responseTime: '1.8 hrs', status: 'On Track' },
  { id: 'TKT-1035', title: 'SD Pricing Discrepancy', priority: 'Medium', responseTime: '3.1 hrs', status: 'At Risk' },
  { id: 'TKT-1029', title: 'ABAP Report Performance', priority: 'Low', responseTime: '6.2 hrs', status: 'Breached' },
];

const statusColors: Record<string, string> = {
  'On Track': 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  'At Risk': 'bg-amber-500/10 text-amber-600 border-amber-200',
  'Breached': 'bg-destructive/10 text-destructive border-destructive/20',
};

const priorityColors: Record<string, string> = {
  Critical: 'bg-destructive/10 text-destructive',
  High: 'bg-amber-500/10 text-amber-600',
  Medium: 'bg-blue-500/10 text-blue-600',
  Low: 'bg-muted text-muted-foreground',
};

export default function SLAPage() {
  const { t } = useTranslation();

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.sla', 'Service Level Agreements')}</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor SLA metrics, compliance & configure your policies</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="configure" className="gap-1.5"><Settings2 className="w-3.5 h-3.5" /> Configure</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {slaMetrics.map((metric) => (
              <Card key={metric.label}>
                <CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{metric.label}</span>
                    {metric.met ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <p className="text-2xl font-bold">{metric.value}</p>
                  <Progress value={metric.progress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground">Target: {metric.target}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Ticket SLA Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Ticket</th>
                      <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Priority</th>
                      <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Response</th>
                      <th className="text-start px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ticketSLA.map((ticket) => (
                      <tr key={ticket.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{ticket.id}</p>
                          <p className="text-xs text-muted-foreground">{ticket.title}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={priorityColors[ticket.priority]}>{ticket.priority}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            <span>{ticket.responseTime}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={statusColors[ticket.status]}>{ticket.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="configure">
          <SLAPolicyManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
