import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, Globe, Bell, Shield } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function AdminSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.settings_title', 'Platform Settings')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('admin.settings_subtitle', 'Manage global platform configuration')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Globe className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">{t('admin.settings_general', 'General')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="maintenance">{t('admin.settings_maintenance', 'Maintenance Mode')}</Label>
              <Switch id="maintenance" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="registration">{t('admin.settings_registration', 'Open Registration')}</Label>
              <Switch id="registration" defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Bell className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">{t('admin.settings_notifications', 'Notifications')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="email-notif">{t('admin.settings_email_notif', 'Email Notifications')}</Label>
              <Switch id="email-notif" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="admin-alerts">{t('admin.settings_admin_alerts', 'Admin Alerts')}</Label>
              <Switch id="admin-alerts" defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Shield className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">{t('admin.settings_security', 'Security')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="2fa">{t('admin.settings_2fa', 'Require 2FA for Admins')}</Label>
              <Switch id="2fa" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="audit">{t('admin.settings_audit', 'Audit Logging')}</Label>
              <Switch id="audit" defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
