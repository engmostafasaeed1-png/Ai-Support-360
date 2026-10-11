import { useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDisablePush, useEnablePush, usePushConfig, usePushDevice, useTestPush } from '@/hooks/usePush';
import { requestPushPermission } from '@/lib/webPush';

const UNSUPPORTED: Record<string, string> = {
  ios_needs_install:
    'On iPhone and iPad, phone alerts work only after you add this portal to your Home Screen: tap the Share button in Safari, choose "Add to Home Screen", then open the portal from the new icon, sign in again there (the Home Screen app does not share your Safari sign-in) and turn phone alerts on on that page. It needs iOS 16.4 or newer.',
  in_frame: 'Open the portal in its own browser tab to turn on phone alerts: they cannot be turned on inside another page.',
  preview_host: 'Phone alerts can only be turned on on the real website (www.aisupport360.com), not in the editor preview.',
  unsupported: 'This browser does not support push alerts. Use a current version of Chrome, Edge, Firefox or Safari (on iPhone: iOS 16.4 or newer, opened from the Home Screen icon and signed in there).',
};

/**
 * Consultant settings: phone alerts in the browser (Web Push). The consultant taps "Enable phone alerts" on a phone or a computer; from then on a critical
 * request for the SAP area of the consultant shows as a notification on that device, also when the portal is closed. Free, nothing to install on Android.
 */
export default function PushAlertsCard() {
  const config = usePushConfig();
  const publicKey = config.data?.public_key ?? null;
  const device = usePushDevice(publicKey);
  const enable = useEnablePush();
  const disable = useDisablePush();
  const test = useTestPush();
  const [asking, setAsking] = useState(false);
  const d = device.data;

  const turnOn = async () => {
    if (!publicKey) return;
    setAsking(true);
    try {
      // the question to the user comes first and straight from the tap: Safari on iPhone refuses it after other waiting
      const permission = await requestPushPermission();
      if (permission === 'granted') await enable.mutateAsync(publicKey);
      else {
        if (permission === 'default') toast.error('Notifications were not allowed. Press the button again and choose Allow.');
        await device.refetch();
      }
    } catch {
      // the hook already showed the error
    } finally {
      setAsking(false);
    }
  };

  const sendTest = async () => {
    try {
      const answer = await test.mutateAsync();
      if (!answer.configured) toast.error('Phone alerts are not available yet.');
      else if ((answer.devices ?? 0) === 0) toast.error('No device is turned on yet.');
      else if ((answer.sent ?? 0) > 0 && (answer.failed ?? 0) === 0) toast.success('Test alert sent: it should appear on your device in a few seconds');
      else if ((answer.sent ?? 0) > 0) toast.error('The test alert reached only some of your devices. Turn alerts off and on again on the device that did not get it.');
      else toast.error('The test alert could not be delivered. Please turn phone alerts off and on again.');
    } catch {
      // the hook already showed the error
    }
  };

  const busy = asking || enable.isPending;
  const on = !!d && d.support === 'ok' && d.subscribed && d.registered && !d.keyMismatch;

  return (
    <Card className="border-border/40" data-testid="push-alerts-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4" /> Phone alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {config.isLoading || device.isLoading ? (
          <Skeleton className="h-10 rounded-lg" />
        ) : (config.isError && !config.data) || (device.isError && !device.data) || !d ? (
          <p className="text-xs text-destructive">Phone alerts could not be checked. Please reload the page.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Get an alert on this phone or computer as soon as a client opens a critical request for your SAP area, also when the portal is closed. On a computer the browser must still be running. It is free and works in your browser: nothing to install on Android; on iPhone the portal must first be added to the Home Screen.
            </p>
            <p className="text-xs text-muted-foreground">
              You get it only while your account is verified and "New case alerts" is switched on in your Notifications settings. It is an extra channel next to the in-app alarm, the e-mail and Telegram, not a replacement.
            </p>
            <p className="text-xs text-muted-foreground" data-testid="push-privacy-note">
              The alert is encrypted, so the push service of your browser (Google, Apple, Mozilla or Microsoft) cannot read it: it only passes it on and sees that a message was sent. We store a technical address, two keys and the type of this browser, only to send you alerts, and we delete them when you turn alerts off, when the device stops answering for 30 days or when your account is deleted.
            </p>

            {d.support !== 'ok' && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="push-unsupported">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{UNSUPPORTED[d.support] ?? UNSUPPORTED.unsupported}</span>
              </div>
            )}

            {d.support === 'ok' && !config.data?.configured && (
              <p className="text-xs text-muted-foreground" data-testid="push-not-configured">
                Phone alerts are not available yet: the platform administrator has not finished setting them up. Please try again later.
              </p>
            )}

            {d.support === 'ok' && config.data?.configured && d.permission === 'denied' && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="push-denied">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Notifications are blocked for this site in your browser. Allow them in the browser settings for this site (the lock icon next to the address, then Notifications, then Allow), reload the page and press the button again.</span>
              </div>
            )}

            {on && (
              <div className="space-y-3" data-testid="push-on">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 bg-green-600 text-xs text-white"><CheckCircle2 className="h-3 w-3" /> On for this device</Badge>
                  <span className="text-xs text-muted-foreground">{d.devices === 1 ? '1 device in total' : `${d.devices} devices in total`}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={sendTest} disabled={test.isPending}>
                    {test.isPending && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />} Send me a test alert
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => disable.mutate()} disabled={disable.isPending}>Turn off on this device</Button>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">So that the alert reaches you:</p>
                  <ul className="list-disc space-y-0.5 ps-4">
                    <li>Allow notifications for your browser in the settings of your phone.</li>
                    <li>Do not clear the data of this site and do not force-stop the browser.</li>
                    <li>Do Not Disturb and Focus modes silence the alert: allow your browser as an exception.</li>
                    <li>Signing out turns phone alerts off on this device: turn them on again after you sign in.</li>
                  </ul>
                </div>
              </div>
            )}

            {d.support === 'ok' && config.data?.configured && d.permission !== 'denied' && !on && (
              <div className="space-y-2">
                {(d.subscribed && !d.registered) || d.keyMismatch ? (
                  <p className="text-xs text-muted-foreground" data-testid="push-repair">Phone alerts need to be turned on again for this device.</p>
                ) : null}
                <Button size="sm" onClick={turnOn} disabled={busy} className="gap-1.5">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />} Enable phone alerts
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

