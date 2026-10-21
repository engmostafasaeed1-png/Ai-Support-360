import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Archive, Loader2, Megaphone } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ComposeMessage from '@/components/admin/messages/ComposeMessage';
import CampaignsPanel from '@/components/admin/messages/CampaignsPanel';
import MessagingSettingsPanel from '@/components/admin/messages/MessagingSettingsPanel';
import { useBulkAccess, useBulkActions, useTemplates } from '@/hooks/useBulkMessaging';

export default function MessagesPage() {
  const { t } = useTranslation();
  const access = useBulkAccess();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'compose';
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Megaphone className="h-6 w-6" />{t('bmsg.title', 'Messages / Campaigns')}</h1>
        <p className="text-sm text-muted-foreground">{t('bmsg.subtitle', 'Send one message to many users in the app, on Telegram, or by WhatsApp / SMS from your own phone.')}</p>
      </div>
      {access.state === 'loading' && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t('bmsg.loading', 'Loading')} />}
      {access.state === 'not_installed' && (
        <Card className="border-dashed"><CardContent className="p-6 text-sm text-muted-foreground">{t('bmsg.not_installed', 'Bulk messages are ready but switch on after the next database update. Nothing can be sent until then.')}</CardContent></Card>
      )}
      {access.state === 'denied' && (
        <Card className="border-dashed"><CardContent className="p-6 text-sm text-muted-foreground">{t('bmsg.denied', 'You do not have the "Send bulk messages" permission. A super admin can give it to you through an admin group.')}</CardContent></Card>
      )}
      {access.state === 'ready' && (
        <Tabs value={tab} onValueChange={(v) => setParam('tab', v)}>
          <TabsList>
            <TabsTrigger value="compose">{t('bmsg.tab_compose', 'New message')}</TabsTrigger>
            <TabsTrigger value="campaigns">{t('bmsg.tab_campaigns', 'Sent and scheduled')}</TabsTrigger>
            <TabsTrigger value="templates">{t('bmsg.tab_templates', 'Templates')}</TabsTrigger>
            <TabsTrigger value="settings">{t('bmsg.tab_settings', 'Settings')}</TabsTrigger>
          </TabsList>
          <TabsContent value="compose" className="mt-4">
            <ComposeMessage settings={access.settings} onSent={(id) => { const n = new URLSearchParams(params); n.set('tab', 'campaigns'); n.set('open', id); setParams(n, { replace: true }); }} />
          </TabsContent>
          <TabsContent value="campaigns" className="mt-4"><CampaignsPanel openId={params.get('open')} onOpen={(id) => setParam('open', id)} /></TabsContent>
          <TabsContent value="templates" className="mt-4"><TemplatesPanel /></TabsContent>
          <TabsContent value="settings" className="mt-4"><MessagingSettingsPanel settings={access.settings} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function TemplatesPanel() {
  const { t } = useTranslation();
  const q = useTemplates(true);
  const { archiveTemplate } = useBulkActions();
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!q.data?.length) return <Card className="border-dashed"><CardContent className="p-6 text-sm text-muted-foreground">{t('bmsg.no_templates', 'No templates yet. Use "Save as template" while writing a message.')}</CardContent></Card>;
  return (
    <ul className="space-y-2">
      {q.data.map((tpl) => (
        <li key={tpl.id} className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{tpl.name}</p><p className="truncate text-xs text-muted-foreground">{tpl.subject_en}</p></div>
          <Badge variant="outline">{tpl.category === 'marketing' ? t('bmsg.marketing_short', 'marketing') : t('bmsg.service_short', 'service')}</Badge>
          {tpl.body_ar && <Badge variant="secondary">العربية</Badge>}
          <Button size="sm" variant="ghost" onClick={async () => { try { await archiveTemplate.mutateAsync(tpl.id); toast.success(t('bmsg.archived', 'Template archived')); } catch (e) { toast.error((e as Error).message); } }}>
            <Archive className="me-1 h-4 w-4" />{t('bmsg.archive', 'Archive')}</Button>
        </li>
      ))}
    </ul>
  );
}
