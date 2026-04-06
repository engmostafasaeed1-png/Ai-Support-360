import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, FileText, Filter, Download, Eye, Shield, Clock } from 'lucide-react';

const mockLogs = [
  { id: '1', action: 'user.role_changed', user: 'admin@qurtuba.com', target: 'mohammed@acme.sa', details: 'Role changed from client to consultant', ip: '192.168.1.1', timestamp: '2026-04-05 23:30:00' },
  { id: '2', action: 'ticket.status_changed', user: 'sarah.j@qurtuba.com', target: 'TKT-0042', details: 'Status changed to resolved', ip: '10.0.0.15', timestamp: '2026-04-05 23:25:00' },
  { id: '3', action: 'settings.updated', user: 'admin@qurtuba.com', target: 'maintenance_mode', details: 'Toggled maintenance mode OFF', ip: '192.168.1.1', timestamp: '2026-04-05 23:18:00' },
  { id: '4', action: 'nda.signed', user: 'david.p@qurtuba.com', target: 'NDA-0019', details: 'NDA signed for client Acme Corp', ip: '172.16.0.5', timestamp: '2026-04-05 23:10:00' },
  { id: '5', action: 'payment.completed', user: 'system', target: 'PAY-0085', details: 'Payment of $450 completed for session SES-0032', ip: '-', timestamp: '2026-04-05 22:55:00' },
  { id: '6', action: 'user.suspended', user: 'admin@qurtuba.com', target: 'spam@test.com', details: 'User suspended for policy violation', ip: '192.168.1.1', timestamp: '2026-04-05 22:40:00' },
  { id: '7', action: 'consultant.approved', user: 'admin@qurtuba.com', target: 'lisa.c@qurtuba.com', details: 'Consultant verification approved', ip: '192.168.1.1', timestamp: '2026-04-05 22:30:00' },
  { id: '8', action: 'user.login', user: 'admin@qurtuba.com', target: '-', details: 'Successful login', ip: '192.168.1.1', timestamp: '2026-04-05 22:20:00' },
  { id: '9', action: 'environment.created', user: 'admin@qurtuba.com', target: 'ENV-SAP-PROD', details: 'New remote environment created', ip: '192.168.1.1', timestamp: '2026-04-05 22:10:00' },
  { id: '10', action: 'ticket.created', user: 'client@corp.com', target: 'TKT-0043', details: 'New ticket: SAP FI posting error', ip: '10.0.0.22', timestamp: '2026-04-05 22:00:00' },
];

const actionColors: Record<string, string> = {
  'user.role_changed': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  'ticket.status_changed': 'bg-accent/10 text-accent border-accent/20',
  'settings.updated': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  'nda.signed': 'bg-green-500/10 text-green-600 border-green-500/20',
  'payment.completed': 'bg-primary/10 text-primary border-primary/20',
  'user.suspended': 'bg-destructive/10 text-destructive border-destructive/20',
  'consultant.approved': 'bg-green-500/10 text-green-600 border-green-500/20',
  'user.login': 'bg-muted text-muted-foreground border-border',
  'environment.created': 'bg-accent/10 text-accent border-accent/20',
  'ticket.created': 'bg-primary/10 text-primary border-primary/20',
};

export default function AuditLogsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const filtered = mockLogs.filter(log => {
    const matchSearch = log.action.includes(search.toLowerCase()) ||
      log.user.includes(search.toLowerCase()) ||
      log.details.toLowerCase().includes(search.toLowerCase());
    const matchAction = actionFilter === 'all' || log.action.startsWith(actionFilter);
    return matchSearch && matchAction;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.audit_title', 'Audit Logs')}</h1>
          <p className="text-sm text-muted-foreground">{t('super_admin.audit_subtitle', 'Complete audit trail of all system actions')}</p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="w-3.5 h-3.5 me-1" /> {t('super_admin.export_logs', 'Export Logs')}
        </Button>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={t('super_admin.search_logs', 'Search logs...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-40 h-9">
                <Filter className="w-3 h-3 me-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="user">User Actions</SelectItem>
                <SelectItem value="ticket">Ticket Actions</SelectItem>
                <SelectItem value="payment">Payments</SelectItem>
                <SelectItem value="settings">Settings</SelectItem>
                <SelectItem value="nda">NDA</SelectItem>
                <SelectItem value="consultant">Consultants</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30">
                  <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.action', 'Action')}</th>
                  <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.performed_by', 'Performed By')}</th>
                  <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.target', 'Target')}</th>
                  <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.details', 'Details')}</th>
                  <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.ip', 'IP')}</th>
                  <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.timestamp', 'Timestamp')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4">
                      <Badge variant="outline" className={`text-[9px] font-mono ${actionColors[log.action] || ''}`}>
                        {log.action}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-xs">{log.user}</td>
                    <td className="py-3 px-4 text-xs font-mono">{log.target}</td>
                    <td className="py-3 px-4 text-xs text-muted-foreground max-w-[200px] truncate">{log.details}</td>
                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">{log.ip}</td>
                    <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {log.timestamp}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
