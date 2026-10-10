import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Layout, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAdminSettings } from '@/hooks/useAdminSettings';
import NDATemplateEditor from '@/components/admin/NDATemplateEditor';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/** Only switches that really change what the platform does. */
const GENERAL = [
  {
    key: 'maintenance_mode',
    labelKey: 'admin.settings_maintenance',
    label: 'Maintenance mode',
    hint: 'On: everyone except administrators sees a maintenance page. Administrators can still sign in and work.',
  },
  {
    key: 'open_registration',
    labelKey: 'admin.settings_registration',
    label: 'Open registration',
    hint: 'Off: nobody can create a new account and the sign-up page says that registration is closed. People who already have an account can still sign in.',
  },
] as const;

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const { settings, loading, updateSetting } = useAdminSettings();
  const { toast } = useToast();
  const [portalMargin, setPortalMargin] = useState(5);
  const [marginLoading, setMarginLoading] = useState(true);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'portal_margin')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value != null) {
          const v = Number(data.value);
          if (!isNaN(v)) setPortalMargin(v);
        }
        setMarginLoading(false);
      });
  }, []);

  const saveMargin = useCallback(async (val: number) => {
    setPortalMargin(val);
    const { error } = await supabase
      .from('platform_settings')
      .update({ value: String(val) as any })
      .eq('key', 'portal_margin');
    if (error) {
      toast({ title: 'Error saving margin', description: error.message, variant: 'destructive' });
    }
  }, [toast]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.settings_title', 'Platform Settings')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.settings_subtitle', 'Manage global platform configuration')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Globe className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t('admin.settings_general', 'General')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {GENERAL.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor={item.key}>{t(item.labelKey, item.label)}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>
                </div>
                {loading ? (
                  <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                ) : (
                  <Switch
                    id={item.key}
                    className="shrink-0"
                    checked={item.key === 'open_registration' ? settings.open_registration !== false : !!settings[item.key]}
                    onCheckedChange={(val) => {
                      if (item.key === 'maintenance_mode' && val) {
                        setConfirmMaintenance(true);
                        return;
                      }
                      void updateSetting(item.key, val);
                    }}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Portal Layout Card */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Layout className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t('admin.settings_layout', 'Portal Layout')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('admin.settings_portal_margin', 'Content Margin')}</Label>
                <span className="text-sm font-medium text-primary">{portalMargin}%</span>
              </div>
              {marginLoading ? (
                <Skeleton className="h-5 w-full rounded-full" />
              ) : (
                <Slider
                  value={[portalMargin]}
                  onValueChange={([v]) => setPortalMargin(v)}
                  onValueCommit={([v]) => saveMargin(v)}
                  min={0}
                  max={15}
                  step={1}
                  className="w-full"
                />
              )}
              <p className="text-[10px] text-muted-foreground">
                {t('admin.settings_margin_hint', 'Horizontal margin applied to client portal content. Not visible to clients.')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Email notifications: this key is read by the feature flags hook. */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t('admin.settings_email_notifications', 'Email Notifications')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {([
              ['email_notifications', 'Email Notifications', 'Automatic e-mails (demo requests, verification items, interview replies). Invitations you send yourself always go out.', true],
              ['admin_alerts', 'Admin Alerts', 'In-app notifications to administrators. When off, new alerts for admins are not stored.', true],
              ['audit_logging', 'Audit Logging', 'Records activity in the audit log. Changes to settings and roles are always recorded.', true],
              ['require_2fa', 'Require two-step sign-in', 'Everyone must use an authenticator app code before the portal opens.', false],
            ] as const).map(([key, label, hint, def]) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor={key}>{label}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
                </div>
                {loading ? (
                  <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                ) : (
                  <Switch
                    id={key}
                    className="shrink-0"
                    checked={settings[key] === undefined ? def : settings[key]}
                    onCheckedChange={(val) => void updateSetting(key, val)}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <NDATemplateEditor />

      <AlertDialog open={confirmMaintenance} onOpenChange={setConfirmMaintenance}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on maintenance mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone except administrators will see a maintenance page until you turn it off again. Work in progress on their screens stops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void updateSetting('maintenance_mode', true)}>Turn on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
