import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Server, Monitor, Settings2 } from 'lucide-react';
import { useRemoteEnvironments } from '@/hooks/useRemoteEnvironments';
import { useVMwareSettings, useSaveVMwareSettings } from '@/hooks/useVMwareSettings';
import VMwareSettingsForm from '@/components/remote/VMwareSettingsForm';

export default function ClientVMwareSettingsPage() {
  const { t } = useTranslation();
  const { data: environments, isLoading: envsLoading } = useRemoteEnvironments();
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const { data: settings, isLoading: settingsLoading } = useVMwareSettings(selectedEnvId || undefined);
  const saveSettings = useSaveVMwareSettings();

  const selectedEnv = (environments || []).find(e => e.id === selectedEnvId);

  if (envsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const envs = environments || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Settings2 className="w-6 h-6 text-primary" /> {t('client.vmware_title', 'VMware Settings')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('client.vmware_subtitle', 'Configure your VMware infrastructure, VM defaults, and network security')}
        </p>
      </div>

      {/* Environment selector */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground">{t('client.vmware_select_env', 'Select Environment')}</label>
              <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder={t('client.vmware_select_placeholder', 'Choose an environment...')} />
                </SelectTrigger>
                <SelectContent>
                  {envs.map(env => (
                    <SelectItem key={env.id} value={env.id}>
                      <div className="flex items-center gap-2">
                        <Monitor className="w-3.5 h-3.5" />
                        {env.name}
                        <Badge variant="outline" className="text-[9px]">
                          {env.platform_type === 'vmware' ? 'VMware' : env.platform_type}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Settings form */}
      {selectedEnvId ? (
        settingsLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : (
          <VMwareSettingsForm
            settings={settings || null}
            environmentId={selectedEnvId}
            environmentName={selectedEnv?.name || ''}
            onSave={(data) => saveSettings.mutate(data)}
            saving={saveSettings.isPending}
          />
        )
      ) : (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Settings2 className="w-12 h-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">{t('client.vmware_select_hint', 'Select an environment above to configure its VMware settings')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
