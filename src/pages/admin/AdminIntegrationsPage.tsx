import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plug, Activity, AlertTriangle, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

const platformColors: Record<string, string> = {
  zendesk: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  freshdesk: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  jira: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  servicenow: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
};

const statusIcons: Record<string, React.ReactNode> = {
  active: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  inactive: <Clock className="w-4 h-4 text-muted-foreground" />,
  error: <XCircle className="w-4 h-4 text-destructive" />,
};

export default function AdminIntegrationsPage() {
  const { t } = useTranslation();

  const { data: integrations = [], isLoading: loadingIntegrations } = useQuery({
    queryKey: ['admin-integrations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integrations')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: syncLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['admin-sync-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const stats = {
    total: integrations.length,
    active: integrations.filter(i => i.status === 'active').length,
    errors: integrations.filter(i => i.status === 'error').length,
    syncSuccess: syncLogs.filter(l => l.status === 'success').length,
    syncFailed: syncLogs.filter(l => l.status === 'failed').length,
  };

  const statCards = [
    { label: t('admin.int_total', 'Total Integrations'), value: stats.total, icon: Plug, color: 'text-primary' },
    { label: t('admin.int_active', 'Active'), value: stats.active, icon: CheckCircle2, color: 'text-emerald-500' },
    { label: t('admin.int_errors', 'Errors'), value: stats.errors, icon: AlertTriangle, color: 'text-destructive' },
    { label: t('admin.int_sync_success', 'Syncs (Success)'), value: stats.syncSuccess, icon: Activity, color: 'text-blue-500' },
    { label: t('admin.int_sync_failed', 'Syncs (Failed)'), value: stats.syncFailed, icon: XCircle, color: 'text-orange-500' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.integrations_title', 'Integrations Monitor')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('admin.integrations_subtitle', 'Overview of all client integrations and sync health across the platform.')}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statCards.map(s => (
          <Card key={s.label} className="bg-card/80 backdrop-blur border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`w-5 h-5 ${s.color} shrink-0`} />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="integrations">
        <TabsList>
          <TabsTrigger value="integrations">{t('admin.int_tab_all', 'All Integrations')}</TabsTrigger>
          <TabsTrigger value="sync-log">{t('admin.int_tab_sync', 'Sync Activity Log')}</TabsTrigger>
        </TabsList>

        {/* Integrations Tab */}
        <TabsContent value="integrations">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('admin.int_card_title', 'Client Integrations')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingIntegrations ? (
                <div className="p-8 text-center text-muted-foreground">{t('common.loading', 'Loading...')}</div>
              ) : integrations.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">{t('admin.int_no_integrations', 'No integrations configured yet.')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('admin.int_col_platform', 'Platform')}</TableHead>
                        <TableHead>{t('admin.int_col_client_id', 'Client ID')}</TableHead>
                        <TableHead>{t('admin.int_col_status', 'Status')}</TableHead>
                        <TableHead>{t('admin.int_col_sync', 'Sync')}</TableHead>
                        <TableHead>{t('admin.int_col_last_synced', 'Last Synced')}</TableHead>
                        <TableHead>{t('admin.int_col_created', 'Created')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {integrations.map(int => (
                        <TableRow key={int.id}>
                          <TableCell>
                            <Badge variant="outline" className={platformColors[int.platform] || ''}>
                              {int.platform.charAt(0).toUpperCase() + int.platform.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[120px]">
                            {int.client_id.slice(0, 8)}…
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {statusIcons[int.status]}
                              <span className="text-sm capitalize">{int.status}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {int.sync_enabled ? (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <RefreshCw className="w-3 h-3" /> {t('admin.int_sync_auto', 'Auto')}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t('admin.int_sync_manual', 'Manual')}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {int.last_synced_at ? format(new Date(int.last_synced_at), 'MMM d, HH:mm') : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {format(new Date(int.created_at), 'MMM d, yyyy')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sync Log Tab */}
        <TabsContent value="sync-log">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('admin.int_sync_title', 'Recent Sync Activity')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingLogs ? (
                <div className="p-8 text-center text-muted-foreground">{t('common.loading', 'Loading...')}</div>
              ) : syncLogs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">{t('admin.int_no_sync', 'No sync activity yet.')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('admin.int_col_time', 'Time')}</TableHead>
                        <TableHead>{t('admin.int_col_direction', 'Direction')}</TableHead>
                        <TableHead>{t('admin.int_col_action', 'Action')}</TableHead>
                        <TableHead>{t('admin.int_col_status', 'Status')}</TableHead>
                        <TableHead>{t('admin.int_col_external_id', 'External ID')}</TableHead>
                        <TableHead>{t('admin.int_col_error', 'Error')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncLogs.map(log => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">
                              {log.direction === 'inbound' ? t('admin.int_dir_in', '← In') : t('admin.int_dir_out', '→ Out')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{log.action}</TableCell>
                          <TableCell>
                            <Badge
                              variant={log.status === 'success' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'}
                              className="text-xs capitalize"
                            >
                              {log.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {log.external_ticket_id || '—'}
                          </TableCell>
                          <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                            {log.error_message || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}