import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Link2, ExternalLink, Info } from 'lucide-react';

interface PlatformInfo {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
}

const platforms: PlatformInfo[] = [
  {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Sync tickets, comments and statuses with Zendesk Support.',
    docsUrl: 'https://developer.zendesk.com/api-reference',
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    description: 'Import and export tickets and customer data with the Freshdesk helpdesk.',
    docsUrl: 'https://developers.freshdesk.com/api',
  },
  {
    id: 'jira',
    name: 'Jira Service Management',
    description: 'Link SAP tickets to Jira issues with a full lifecycle sync.',
    docsUrl: 'https://developer.atlassian.com/cloud/jira/service-desk/rest/intro/',
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    description: 'Enterprise ITSM integration for incident and change management.',
    docsUrl: 'https://developer.servicenow.com/dev.do',
  },
];

const statusLabel = (status: string) => (status === 'active' ? 'Active' : status === 'error' ? 'Error' : 'Not verified');

export default function IntegrationsPage() {
  const { t } = useTranslation();

  const { data: saved = [] } = useQuery({
    queryKey: ['client-integrations-saved'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('integrations')
        .select('id, platform, status, last_synced_at')
        .eq('client_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t('integrations.title', 'Integrations')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('integrations.subtitle_planned', 'Connect your existing support platforms for ticket sync. Not open yet.')}
        </p>
      </div>

      <div role="note" className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground">Integrations are not open yet</p>
          <p className="text-muted-foreground">
            The platforms below are planned. Nothing is connected or synced from this page, and no credentials are collected here.
          </p>
        </div>
      </div>

      {saved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="w-5 h-5 text-accent" />
            Saved connections
          </h2>
          {saved.map((row) => {
            const platform = platforms.find((p) => p.id === row.platform);
            return (
              <Card key={row.id}>
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-medium text-foreground">{platform?.name ?? row.platform}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.last_synced_at ? `Last synced ${format(new Date(row.last_synced_at), 'MMM d, yyyy HH:mm')}` : 'Never synced'}
                    </p>
                  </div>
                  <Badge variant="outline">{statusLabel(row.status)}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          {t('integrations.planned', 'Planned platforms')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {platforms.map((platform) => (
            <Card key={platform.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Link2 className="w-5 h-5 text-muted-foreground shrink-0" />
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
                <Button size="sm" variant="outline" disabled title="Not available yet">
                  Coming soon
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
