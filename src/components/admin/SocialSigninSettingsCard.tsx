import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SOCIAL_MAIN_KEY, SOCIAL_PROVIDERS, socialProviderKey } from '@/lib/socialSignin';

const NAMES = { google: 'Google', apple: 'Apple', microsoft: 'Microsoft' } as const;

interface Props {
  settings: Record<string, boolean>;
  loading: boolean;
  updateSetting: (key: string, value: boolean) => Promise<void> | void;
}

/** Main social sign-in switch (default off) plus per-provider switches that only apply when it is on. */
export default function SocialSigninSettingsCard({ settings, loading, updateSetting }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mainOn = settings[SOCIAL_MAIN_KEY] === true;
  const save = async (key: string, val: boolean) => {
    await updateSetting(key, val);
    qc.invalidateQueries({ queryKey: ['social-signin-providers'] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <KeyRound className="h-5 w-5 text-primary" />
        <CardTitle className="text-base">{t('admin.social_title', 'Social sign-in (Google / Apple / Microsoft)')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor={SOCIAL_MAIN_KEY}>{t('admin.social_main', 'Social sign-in (Google / Apple / Microsoft)')}</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.social_note', 'Keep OFF until Google credentials are configured and tested')}</p>
          </div>
          {loading ? <Skeleton className="h-5 w-9 shrink-0 rounded-full" /> : (
            <Switch id={SOCIAL_MAIN_KEY} className="shrink-0" checked={mainOn} onCheckedChange={(v) => void save(SOCIAL_MAIN_KEY, v)} />
          )}
        </div>
        <fieldset className="space-y-3 border-t border-border pt-3" aria-describedby="social-providers-hint">
          <legend className="sr-only">{t('admin.social_providers', 'Providers')}</legend>
          <p id="social-providers-hint" className="text-xs text-muted-foreground">
            {t('admin.social_providers_hint', 'Each provider is shown on the sign-in pages only when the main switch is on.')}
          </p>
          {SOCIAL_PROVIDERS.map((p) => {
            const key = socialProviderKey(p);
            return (
              <div key={p} className="flex items-center justify-between gap-4">
                <Label htmlFor={key} className={mainOn ? '' : 'text-muted-foreground'}>{NAMES[p]}</Label>
                {loading ? <Skeleton className="h-5 w-9 shrink-0 rounded-full" /> : (
                  <Switch id={key} className="shrink-0" checked={settings[key] === true} onCheckedChange={(v) => void save(key, v)} />
                )}
              </div>
            );
          })}
        </fieldset>
      </CardContent>
    </Card>
  );
}
