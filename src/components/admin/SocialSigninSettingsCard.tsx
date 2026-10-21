import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_LOGIN_PROVIDERS, SOCIAL_LOGIN_PROVIDERS_KEY, SOCIAL_PROVIDERS, SOCIAL_SIGNUP_KEY,
  socialConfigFromRows, type SocialProvider,
} from '@/lib/socialSignin';

const NAMES = { google: 'Google', apple: 'Apple', microsoft: 'Microsoft' } as const;

interface Props {
  settings: Record<string, boolean>;
  loading: boolean;
  updateSetting: (key: string, value: boolean) => Promise<void> | void;
}

/** Social sign-up switch (default off) and the providers offered to returning users on /login (default Google). */
export default function SocialSigninSettingsCard({ settings, loading, updateSetting }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [login, setLogin] = useState<SocialProvider[] | null>(null);

  useEffect(() => {
    supabase.from('platform_settings').select('value').eq('key', SOCIAL_LOGIN_PROVIDERS_KEY).maybeSingle()
      .then(({ data }) => setLogin(socialConfigFromRows(data ? [{ key: SOCIAL_LOGIN_PROVIDERS_KEY, value: data.value }] : []).login))
      .then(undefined, () => setLogin(DEFAULT_LOGIN_PROVIDERS));
  }, []);

  const toggleLogin = async (p: SocialProvider, on: boolean) => {
    const prev = login ?? DEFAULT_LOGIN_PROVIDERS;
    const next = SOCIAL_PROVIDERS.filter((x) => (x === p ? on : prev.includes(x)));
    setLogin(next);
    const { error } = await supabase.from('platform_settings').upsert({ key: SOCIAL_LOGIN_PROVIDERS_KEY, value: next as any }, { onConflict: 'key' });
    if (error) { setLogin(prev); toast({ title: 'Error saving setting', description: error.message, variant: 'destructive' }); }
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
            <Label htmlFor={SOCIAL_SIGNUP_KEY}>{t('admin.social_signup', 'Sign-up with social providers')}</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.social_signup_note', 'Keep sign-up with social providers OFF until Google credentials are configured and tested')}</p>
          </div>
          {loading ? <Skeleton className="h-5 w-9 shrink-0 rounded-full" /> : (
            <Switch id={SOCIAL_SIGNUP_KEY} className="shrink-0" checked={settings[SOCIAL_SIGNUP_KEY] === true} onCheckedChange={(v) => void updateSetting(SOCIAL_SIGNUP_KEY, v)} />
          )}
        </div>
        <fieldset className="space-y-3 border-t border-border pt-3" aria-describedby="social-login-hint">
          <legend className="text-sm font-medium">{t('admin.social_login', 'Sign-in for returning users')}</legend>
          <p id="social-login-hint" className="text-xs text-muted-foreground">
            {t('admin.social_login_hint', 'Shown on the sign-in page only. Turn on Apple or Microsoft only after they are configured.')}
          </p>
          {SOCIAL_PROVIDERS.map((p) => {
            const id = `social_login_${p}`;
            return (
              <div key={p} className="flex items-center justify-between gap-4">
                <Label htmlFor={id}>{NAMES[p]}</Label>
                {login === null ? <Skeleton className="h-5 w-9 shrink-0 rounded-full" /> : (
                  <Switch id={id} className="shrink-0" checked={login.includes(p)} onCheckedChange={(v) => void toggleLogin(p, v)} />
                )}
              </div>
            );
          })}
        </fieldset>
      </CardContent>
    </Card>
  );
}
