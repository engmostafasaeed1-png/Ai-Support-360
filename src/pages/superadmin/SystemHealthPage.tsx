import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Activity, Database, Server, Zap, HardDrive, Cpu,
  Clock, CheckCircle, AlertTriangle, XCircle, RefreshCw,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { toast } from 'sonner';

const healthChecks = [
  { service: 'Authentication', status: 'healthy', latency: '12ms', uptime: 99.99 },
  { service: 'Database', status: 'healthy', latency: '8ms', uptime: 99.97 },
  { service: 'Edge Functions', status: 'healthy', latency: '45ms', uptime: 99.95 },
  { service: 'Storage', status: 'warning', latency: '120ms', uptime: 99.80 },
  { service: 'Realtime', status: 'healthy', latency: '15ms', uptime: 99.98 },
  { service: 'AI Gateway', status: 'healthy', latency: '280ms', uptime: 99.90 },
];

const resourceUsage = [
  { name: 'Database', used: 2.4, total: 5, unit: 'GB' },
  { name: 'Storage', used: 1.8, total: 5, unit: 'GB' },
  { name: 'Bandwidth', used: 12.5, total: 50, unit: 'GB' },
  { name: 'Edge Invocations', used: 45000, total: 100000, unit: '' },
];

const cpuHistory = Array.from({ length: 24 }, (_, i) => ({
  hour: `${i}:00`,
  cpu: Math.floor(Math.random() * 40 + 10),
  memory: Math.floor(Math.random() * 30 + 40),
}));

const statusColors: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  healthy: { bg: 'bg-green-500/10', text: 'text-green-600', icon: CheckCircle },
  warning: { bg: 'bg-amber-500/10', text: 'text-amber-600', icon: AlertTriangle },
  error: { bg: 'bg-destructive/10', text: 'text-destructive', icon: XCircle },
};

export default function SystemHealthPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.system_title', 'System Health')}</h1>
          <p className="text-sm text-muted-foreground">{t('super_admin.system_subtitle', 'Monitor infrastructure, resources, and service health')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => toast.success('Health check refreshed')}>
          <RefreshCw className="w-3.5 h-3.5 me-1" /> Refresh
        </Button>
      </div>

      {/* Service Health */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {healthChecks.map((check) => {
          const status = statusColors[check.status];
          const StatusIcon = status.icon;
          return (
            <Card key={check.service} className="border-border/50">
              <CardContent className="p-3 text-center">
                <div className={`w-10 h-10 rounded-full ${status.bg} flex items-center justify-center mx-auto mb-2`}>
                  <StatusIcon className={`w-5 h-5 ${status.text}`} />
                </div>
                <p className="text-sm font-medium text-foreground">{check.service}</p>
                <p className="text-[10px] text-muted-foreground">{check.latency} · {check.uptime}%</p>
                <Badge variant="outline" className={`mt-1 text-[9px] ${status.bg} ${status.text}`}>
                  {check.status}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Resource Usage */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('super_admin.resource_usage', 'Resource Usage')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {resourceUsage.map((r) => {
            const pct = (r.used / r.total) * 100;
            return (
              <div key={r.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground">
                    {r.unit ? `${r.used} ${r.unit} / ${r.total} ${r.unit}` : `${r.used.toLocaleString()} / ${r.total.toLocaleString()}`}
                  </span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* CPU & Memory */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('super_admin.cpu_memory', 'CPU & Memory (24h)')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={cpuHistory}>
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip />
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area dataKey="cpu" stroke="hsl(217, 91%, 60%)" fill="url(#cpuGrad)" strokeWidth={2} name="CPU %" />
              <Area dataKey="memory" stroke="hsl(142, 76%, 36%)" fill="url(#memGrad)" strokeWidth={2} name="Memory %" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
