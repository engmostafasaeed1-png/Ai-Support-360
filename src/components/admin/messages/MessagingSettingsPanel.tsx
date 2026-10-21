import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PROVIDER_SECRETS } from '@/lib/bulkMessaging';
import { useBulkActions, type BulkSettings } from '@/hooks/useBulkMessaging';

export default function MessagingSettingsPanel({ settings }: { settings: BulkSettings }) {
  const { t } = useTranslation();
  const { setSettings } = useBulkActions();
  const [v, setV] = useState({ inapp: settings.inapp_per_minute, tg: settings.telegram_per_minute, cap: settings.daily_cap });
  useEffect(() => setV({ inapp: settings.inapp_per_minute, tg: settings.telegram_per_minute, cap: settings.daily_cap }), [settings]);
  const save = async (payload: Record<string, unknown>) => {
    try { await setSettings.mutateAsync(payload); toast.success(t('bmsg.saved', 'Saved')); } catch (e) { toast.error((e as Error).message); }
  };
  const ro = !settings.can_edit;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="border-border/40">
        <CardHeader className="pb-3"><CardTitle className="text-base">{t('bmsg.set_sending', 'Sending')}</CardTitle>
          {ro && <CardDescription>{t('bmsg.set_ro', 'Only super admins can change these settings.')}</CardDescription>}</CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div><Label htmlFor="bm-enabled">{t('bmsg.set_enabled', 'Bulk messages on')}</Label>
              <p className="text-xs text-muted-foreground">{t('bmsg.set_enabled_hint', 'Turning this off stops everything that has not gone out yet, at once.')}</p></div>
            <Switch id="bm-enabled" checked={settings.enabled} disabled={ro || setSettings.isPending} onCheckedChange={(on) => save({ enabled: on })} />
          </div>
          {([['inapp', t('bmsg.set_inapp', 'In-app per minute'), 1000], ['tg', t('bmsg.set_tg', 'Telegram per minute (platform limit about 1,800)'), 1200], ['cap', t('bmsg.set_cap', 'Recipients per day (all messages)'), 100000]] as const).map(([k, label, max]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <Label htmlFor={`bm-${k}`} className="font-normal">{label}</Label>
              <Input id={`bm-${k}`} type="number" min={1} max={max} className="w-28" disabled={ro} value={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: Number(e.target.value) }))} />
            </div>
          ))}
          {!ro && <Button size="sm" disabled={setSettings.isPending} onClick={() => save({ inapp_per_minute: v.inapp, telegram_per_minute: v.tg, daily_cap: v.cap })}>{t('bmsg.save', 'Save')}</Button>}
        </CardContent>
      </Card>
      <Card className="border-border/40">
        <CardHeader className="pb-3"><CardTitle className="text-base">{t('bmsg.set_channels', 'Channels')}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p><span className="font-medium">{t('bmsg.ch_email', 'E-mail')}</span> <Badge variant="outline">{t('bmsg.st_unavailable', 'Not available')}</Badge><br />
            <span className="text-xs text-muted-foreground">{t('bmsg.set_email_hint', 'The app e-mail service sends only personal, event-based e-mails. For newsletters use a separate newsletter service.')}</span></p>
          <div>
            <p><span className="font-medium">{t('bmsg.ch_paid', 'Automatic WhatsApp / SMS')}</span> <Badge variant="outline">{t('bmsg.st_off', 'Off')}</Badge></p>
            <p className="text-xs text-muted-foreground">{t('bmsg.set_paid_hint', 'Paid per message. Nothing is sent automatically until the owner chooses a provider; the secret names it will need are:')}</p>
            <ul className="mt-1 space-y-0.5 text-xs">{Object.entries(PROVIDER_SECRETS).map(([p, names]) => <li key={p}><span className="font-medium">{p === 'twilio' ? 'Twilio' : 'WhatsApp Business Cloud'}:</span> <code className="font-mono">{names.join(', ')}</code></li>)}</ul>
          </div>
          <p className="text-xs text-muted-foreground">{settings.pause_installed ? t('bmsg.set_pause_on', 'Notification pauses are respected for news and offers.') : t('bmsg.set_pause_off', 'Notification pauses are not set up yet, so only unsubscribed addresses are left out of news and offers.')}</p>
          <p className="text-xs text-muted-foreground">{t('bmsg.set_consent', 'There is no separate marketing consent setting today; unsubscribes and pauses are what count.')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
