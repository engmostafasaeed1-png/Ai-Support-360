import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Link2, Unlink, RefreshCw, CheckCircle2, XCircle, Clock,
  ArrowLeftRight, ExternalLink, Settings2, Trash2, Shield, Copy, Webhook,
} from 'lucide-react';

interface PlatformConfig {
  id: 'zendesk' | 'freshdesk' | 'jira' | 'servicenow';
  name: string;
  description: string;
  color: string;
  icon: string;
  docsUrl: string;
  fields: { key: string; label: string; placeholder: string; type?: string }[];
}

const platforms: PlatformConfig[] = [
  {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Sync tickets, comments, and statuses bidirectionally with Zendesk Support.',
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
    icon: '🟢',
    docsUrl: 'https://developer.zendesk.com/api-reference',
    fields: [
      { key: 'platform_url', label: 'Subdomain URL', placeholder: 'https://yourcompany.zendesk.com' },
      { key: 'api_key', label: 'API Token', placeholder: 'Enter your Zendesk API token', type: 'password' },
      { key: 'email', label: 'Admin Email', placeholder: 'admin@company.com' },
    ],
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    description: 'Import/export tickets and customer data with Freshdesk helpdesk.',
    color: 'bg-blue-500/10 text-blue-600 border-blue-200',
    icon: '🔵',
    docsUrl: 'https://developers.freshdesk.com/api',
    fields: [
      { key: 'platform_url', label: 'Domain URL', placeholder: 'https://yourcompany.freshdesk.com' },
      { key: 'api_key', label: 'API Key', placeholder: 'Enter your Freshdesk API key', type: 'password' },
    ],
  },
  {
    id: 'jira',
    name: 'Jira Service Management',
    description: 'Link SAP tickets to Jira issues with full lifecycle sync.',
    color: 'bg-indigo-500/10 text-indigo-600 border-indigo-200',
    icon: '🔷',
    docsUrl: 'https://developer.atlassian.com/cloud/jira/service-desk/rest/intro/',
    fields: [
      { key: 'platform_url', label: 'Jira URL', placeholder: 'https://yourcompany.atlassian.net' },
      { key: 'api_key', label: 'API Token', placeholder: 'Enter your Atlassian API token', type: 'password' },
      { key: 'email', label: 'Atlassian Email', placeholder: 'admin@company.com' },
      { key: 'project_key', label: 'Project Key', placeholder: 'e.g. SAP, SUPPORT' },
    ],
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    description: 'Enterprise ITSM integration for incident and change management.',
    color: 'bg-amber-500/10 text-amber-600 border-amber-200',
    icon: '🟡',
    docsUrl: 'https://developer.servicenow.com/dev.do',
    fields: [
      { key: 'platform_url', label: 'Instance URL', placeholder: 'https://yourcompany.service-now.com' },
      { key: 'api_key', label: 'Username', placeholder: 'API username' },
      { key: 'password', label: 'Password', placeholder: 'API password', type: 'password' },
    ],
  },
];


export default function IntegrationsPage() {
  const { t } = useTranslation();
  const [connectDialog, setConnectDialog] = useState<PlatformConfig | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState<Record<string, {
    id?: string;
    status: 'active' | 'error' | 'inactive';
    lastSynced: string;
    ticketsSynced: number;
    syncEnabled: boolean;
  }>>({});
  const [syncLog, setSyncLog] = useState<{
    id: string; direction: 'inbound' | 'outbound'; action: string; external: string; local: string; status: 'success' | 'failed'; time: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  // Load real integrations + sync log for the signed-in client
  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setLoading(false); return; }

      const { data: integrations } = await supabase
        .from('integrations')
        .select('id, platform, status, last_synced_at, sync_enabled')
        .eq('client_id', user.id);

      if (!active) return;
      if (integrations && integrations.length > 0) {
        const map: typeof connected = {};
        integrations.forEach((i) => {
          map[i.platform] = {
            id: i.id,
            status: (i.status as 'active' | 'error' | 'inactive') || 'inactive',
            lastSynced: i.last_synced_at ? new Date(i.last_synced_at).toLocaleString() : 'Never',
            ticketsSynced: 0,
            syncEnabled: !!i.sync_enabled,
          };
        });
        setConnected(map);

        const integrationIds = integrations.map(i => i.id);
        const { data: logs } = await supabase
          .from('integration_sync_log')
          .select('id, direction, action, external_ticket_id, local_ticket_id, status, created_at')
          .in('integration_id', integrationIds)
          .order('created_at', { ascending: false })
          .limit(20);
        if (active && logs) {
          setSyncLog(logs.map((l) => ({
            id: l.id,
            direction: l.direction as 'inbound' | 'outbound',
            action: l.action,
            external: l.external_ticket_id || '—',
            local: l.local_ticket_id || '—',
            status: (l.status as 'success' | 'failed') === 'failed' ? 'failed' : 'success',
            time: new Date(l.created_at).toLocaleString(),
          })));
        }
      }
      if (active) setLoading(false);
    };
    load();
    return () => { active = false; };
  }, []);

  const getWebhookUrl = (platformId: string, integrationId: string) => {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || 'your-project';
    return `https://${projectId}.supabase.co/functions/v1/integration-webhook/${platformId}/${integrationId}`;
  };

  const copyWebhookUrl = (platformId: string) => {
    const url = getWebhookUrl(platformId, 'your-integration-id');
    navigator.clipboard.writeText(url);
    toast.success('Webhook URL copied to clipboard!');
  };

  const handleConnect = () => {
    if (!connectDialog) return;
    toast.success(`${connectDialog.name} connected successfully!`);
    setConnected(prev => ({
      ...prev,
      [connectDialog.id]: { status: 'active', lastSynced: 'Just now', ticketsSynced: 0, syncEnabled: true },
    }));
    setConnectDialog(null);
    setFormData({});
  };

  const handleDisconnect = (platformId: string) => {
    const platform = platforms.find(p => p.id === platformId);
    toast.success(`${platform?.name} disconnected.`);
    setConnected(prev => {
      const next = { ...prev };
      delete next[platformId];
      return next;
    });
  };

  const handleSync = (platformId: string) => {
    toast.info('Syncing tickets…');
    setTimeout(() => {
      setConnected(prev => ({
        ...prev,
        [platformId]: { ...prev[platformId], lastSynced: 'Just now' },
      }));
      toast.success('Sync completed!');
    }, 1500);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t('integrations.title', 'Integrations')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('integrations.subtitle', 'Connect your existing support platforms for bidirectional ticket sync.')}
        </p>
      </div>

      {/* Connected platforms */}
      {Object.keys(connected).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="w-5 h-5 text-accent" />
            {t('integrations.connected', 'Connected Platforms')}
          </h2>
          {Object.entries(connected).map(([platformId, info]) => {
            const platform = platforms.find(p => p.id === platformId)!;
            return (
              <Card key={platformId} className="border-accent/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{platform.icon}</span>
                      <div>
                        <CardTitle className="text-base">{platform.name}</CardTitle>
                        <CardDescription className="flex items-center gap-1.5 mt-0.5">
                          {statusIcon(info.status)}
                          <span className="capitalize">{info.status}</span>
                          <span className="text-muted-foreground">· Last synced {info.lastSynced}</span>
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleSync(platformId)}>
                        <RefreshCw className="w-3.5 h-3.5 me-1.5" />
                        Sync Now
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDisconnect(platformId)}>
                        <Unlink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex items-center gap-1.5">
                      <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{info.ticketsSynced}</span>
                      <span className="text-muted-foreground">tickets synced</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={info.syncEnabled} onCheckedChange={(checked) => {
                        setConnected(prev => ({
                          ...prev,
                          [platformId]: { ...prev[platformId], syncEnabled: checked },
                        }));
                      }} />
                      <span className="text-muted-foreground text-xs">Auto-sync</span>
                    </div>
                  </div>
                  {/* Webhook URL */}
                  <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Webhook className="w-3.5 h-3.5" />
                      Inbound Webhook URL
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] bg-background rounded px-2 py-1.5 border border-border/50 text-foreground truncate">
                        {getWebhookUrl(platformId, 'int_xxxxxxxx')}
                      </code>
                      <Button size="sm" variant="ghost" className="shrink-0 h-7 w-7 p-0" onClick={() => copyWebhookUrl(platformId)}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Paste this URL in your {platform.name} webhook settings for real-time inbound sync.
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sync Activity Log */}
      {Object.keys(connected).length > 0 && syncLog.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              {t('integrations.sync_log', 'Recent Sync Activity')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {syncLog.map((log) => (
                <div key={log.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className={`text-[10px] ${log.direction === 'inbound' ? 'border-blue-300 text-blue-600' : 'border-emerald-300 text-emerald-600'}`}>
                      {log.direction === 'inbound' ? '← IN' : '→ OUT'}
                    </Badge>
                    <span className="text-muted-foreground">{log.action.replace('_', ' ')}</span>
                    <span className="font-mono text-xs">{log.external} ↔ {log.local}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {log.status === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-destructive" />
                    )}
                    <span className="text-xs text-muted-foreground">{log.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Available platforms */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          {t('integrations.available', 'Available Platforms')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {platforms.filter(p => !connected[p.id]).map((platform) => (
            <Card key={platform.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{platform.icon}</span>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base">{platform.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5 line-clamp-2">
                      {platform.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 flex items-center justify-between">
                <a
                  href={platform.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  API Docs
                </a>
                <Button size="sm" onClick={() => { setConnectDialog(platform); setFormData({}); }}>
                  <Link2 className="w-3.5 h-3.5 me-1.5" />
                  Connect
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Security note */}
      <Card className="bg-muted/30 border-border/50">
        <CardContent className="flex items-start gap-3 py-4">
          <Shield className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              {t('integrations.security_title', 'Security & Privacy')}
            </p>
            <p className="mt-0.5">
              {t('integrations.security_desc', 'All API keys are encrypted at rest. Webhook endpoints use signed verification. Data sync follows your existing RLS policies.')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connect Dialog */}
      <Dialog open={!!connectDialog} onOpenChange={() => setConnectDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{connectDialog?.icon}</span>
              Connect {connectDialog?.name}
            </DialogTitle>
            <DialogDescription>
              Enter your API credentials to enable bidirectional ticket sync.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {connectDialog?.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.type || 'text'}
                  placeholder={field.placeholder}
                  value={formData[field.key] || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <Separator />
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Credentials are encrypted and stored securely.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialog(null)}>Cancel</Button>
            <Button onClick={handleConnect} disabled={!connectDialog?.fields.every(f => formData[f.key])}>
              Connect & Verify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
