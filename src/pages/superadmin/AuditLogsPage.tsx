import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, Filter, Download, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { useAuditLogs } from '@/hooks/useAuditLogs';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';

const actionColors: Record<string, string> = {
  created: 'bg-green-500/10 text-green-600 border-green-500/20',
  updated: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  deleted: 'bg-destructive/10 text-destructive border-destructive/20',
};

function getActionColor(action: string) {
  if (action.includes('.created')) return actionColors.created;
  if (action.includes('.updated')) return actionColors.updated;
  if (action.includes('.deleted')) return actionColors.deleted;
  return 'bg-muted text-muted-foreground border-border';
}

function summarize(action: string, metadata: Record<string, any> | null): string {
  if (!metadata) return action;

  if (action.includes('.updated') && metadata.old && metadata.new) {
    const oldObj = metadata.old;
    const newObj = metadata.new;
    const changes: string[] = [];
    for (const key of Object.keys(newObj)) {
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key]) && !['updated_at', 'created_at'].includes(key)) {
        changes.push(key);
      }
    }
    return changes.length > 0 ? `Changed: ${changes.slice(0, 4).join(', ')}` : 'No visible changes';
  }

  if (action.includes('.created') && metadata.new) {
    const n = metadata.new;
    return n.title || n.key || n.name || n.role || 'New record';
  }

  return action;
}

export default function AuditLogsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const { data: logs, isLoading, isRefetching } = useAuditLogs(search, actionFilter);
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    toast.success(t('super_admin.logs_refreshed', 'Audit logs refreshed'));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('super_admin.audit_title', 'Audit Logs')}</h1>
          <p className="text-sm text-muted-foreground">{t('super_admin.audit_subtitle', 'Complete audit trail of all system actions')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefetching}>
            {isRefetching ? <Loader2 className="w-3.5 h-3.5 me-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 me-1" />}
            {t('common.refresh', 'Refresh')}
          </Button>
          <Button variant="outline" size="sm">
            <Download className="w-3.5 h-3.5 me-1" /> {t('super_admin.export_logs', 'Export Logs')}
          </Button>
        </div>
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
                <SelectItem value="all">{t('super_admin.all_actions', 'All Actions')}</SelectItem>
                <SelectItem value="tickets">{t('super_admin.ticket_actions', 'Tickets')}</SelectItem>
                <SelectItem value="user_roles">{t('super_admin.role_actions', 'User Roles')}</SelectItem>
                <SelectItem value="payments">{t('super_admin.payment_actions', 'Payments')}</SelectItem>
                <SelectItem value="platform_settings">{t('super_admin.settings_actions', 'Settings')}</SelectItem>
                <SelectItem value="nda">{t('super_admin.nda_actions', 'NDA')}</SelectItem>
                <SelectItem value="consultants">{t('super_admin.consultant_actions', 'Consultants')}</SelectItem>
                <SelectItem value="sessions">{t('super_admin.session_actions', 'Sessions')}</SelectItem>
                <SelectItem value="profiles">{t('super_admin.profile_actions', 'Profiles')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t('super_admin.no_logs', 'No audit logs found. Actions will appear here as users interact with the system.')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.action', 'Action')}</th>
                    <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.performed_by', 'Performed By')}</th>
                    <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.entity', 'Entity')}</th>
                    <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.details', 'Details')}</th>
                    <th className="text-start py-3 px-4 font-medium text-muted-foreground">{t('super_admin.timestamp', 'Timestamp')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={`text-[9px] font-mono ${getActionColor(log.action)}`}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-xs">{log.user_email}</td>
                      <td className="py-3 px-4">
                        <div className="text-xs">
                          <span className="text-muted-foreground">{log.entity_type}</span>
                          {log.entity_id && (
                            <span className="font-mono text-[10px] text-muted-foreground/60 block truncate max-w-[120px]">
                              {log.entity_id.slice(0, 8)}…
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground max-w-[250px] truncate">
                        {summarize(log.action, log.metadata)}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
