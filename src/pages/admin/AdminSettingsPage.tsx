import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Globe, Bell, Shield } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminSettings } from '@/hooks/useAdminSettings';

const sections = [
  {
    icon: Globe,
    titleKey: 'admin.settings_general',
    items: [
      { key: 'maintenance_mode', labelKey: 'admin.settings_maintenance' },
      { key: 'open_registration', labelKey: 'admin.settings_registration' },
    ],
  },
  {
    icon: Bell,
    titleKey: 'admin.settings_notifications',
    items: [
      { key: 'email_notifications', labelKey: 'admin.settings_email_notif' },
      { key: 'admin_alerts', labelKey: 'admin.settings_admin_alerts' },
    ],
  },
  {
    icon: Shield,
    titleKey: 'admin.settings_security',
    items: [
      { key: 'require_2fa', labelKey: 'admin.settings_2fa' },
      { key: 'audit_logging', labelKey: 'admin.settings_audit' },
    ],
  },
];

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const { settings, loading, updateSetting } = useAdminSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.settings_title', 'Platform Settings')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('admin.settings_subtitle', 'Manage global platform configuration')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.titleKey}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <section.icon className="w-5 h-5 text-primary" />
              <CardTitle className="text-base">{t(section.titleKey)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {section.items.map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <Label htmlFor={item.key}>{t(item.labelKey)}</Label>
                  {loading ? (
                    <Skeleton className="h-5 w-9 rounded-full" />
                  ) : (
                    <Switch
                      id={item.key}
                      checked={!!settings[item.key]}
                      onCheckedChange={(val) => updateSetting(item.key, val)}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
