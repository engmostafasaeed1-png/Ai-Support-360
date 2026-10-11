import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectTelegram, useDisconnectTelegram, useTelegramStatus, useTestTelegram } from '@/hooks/useTelegram';
import { pausedMessage, telegramView } from '@/lib/telegramAlerts';

const WAIT_MS = 15 * 60 * 1000; // the link code lives 15 minutes

/**
 * Consultant settings: a free Telegram message when a client opens a critical request for the consultant's SAP area. The consultant presses
 * "Connect Telegram", the bot opens in Telegram, and one tap on Start links the chat. Only the SAP area, the time limit and the surcharge are sent.
 */
export default function TelegramAlertsCard() {
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<'admin' | 'unreachable' | null>(null);
  const statusQ = useTelegramStatus(waitingSince !== null);
  const connect = useConnectTelegram();
  const test = useTestTelegram();
  const disconnect = useDisconnectTelegram();
  const view = telegramView(statusQ.data);
  const announced = useRef(false);

  // the chat got linked while we were waiting: stop waiting
  useEffect(() => {
    if (waitingSince !== null && view === 'connected') {
      setWaitingSince(null);
      setLink(null);
      if (!announced.current) {
        announced.current = true;
        toast.success('Telegram is connected');
      }
    }
  }, [waitingSince, view]);

  // give up waiting when the link has expired
  useEffect(() => {
    if (waitingSince === null) return;
    const id = window.setTimeout(() => { setWaitingSince(null); setLink(null); }, WAIT_MS);
    return () => window.clearTimeout(id);
  }, [waitingSince]);

  const start = async () => {
    announced.current = false;
    try {
      const answer = await connect.mutateAsync();
      if (!answer.configured || !answer.url) {
        setUnavailable(answer.reason === 'bot_unreachable' ? 'unreachable' : 'admin');
        return;
      }
      setUnavailable(null);
      setLink(answer.url);
      setWaitingSince(Date.now());
      window.open(answer.url, '_blank', 'noopener,noreferrer');
    } catch {
      // the hook already showed the error
    }
  };

  const sendTest = async () => {
    try {
      const answer = await test.mutateAsync();
      if (answer.sent) toast.success('Test message sent: check Telegram');
      else if (answer.reason === 'bot_blocked') toast.error('Telegram says that you blocked the bot. Press Reconnect.');
      else toast.error('The test message could not be sent. Please try again.');
    } catch {
      // the hook already showed the error
    }
  };

  return (
    <Card className="border-border/40" data-testid="telegram-alerts-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" /> Telegram alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusQ.isLoading ? (
          <Skeleton className="h-10 rounded-lg" />
        ) : statusQ.isError && !statusQ.data ? (
          <p className="text-xs text-destructive">Your Telegram status could not be loaded. Please reload the page.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Get a free message on your phone when a client opens or extends a critical request for your SAP area. The message only tells you the SAP area, the time limit and the surcharge: the title and the description stay in the portal.
            </p>
            <p className="text-xs text-muted-foreground">
              You get it only while your account is verified and "New case alerts" is switched on in your Notifications settings. It is an extra channel next to the in-app alarm and the e-mail, not a replacement.
            </p>
            <p className="text-xs text-muted-foreground" data-testid="telegram-privacy-note">
              The messages are sent through Telegram, a service of a third party that sees the messages and your Telegram account. We store your Telegram chat number and user name to send you the messages and to show which Telegram account is connected, and we delete both when you press Disconnect or when your account is deleted. Sending /stop to the bot only pauses the messages.
            </p>
            <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="inline-block text-xs underline">Privacy Policy</a>

            {view === 'connected' && (
              <div className="space-y-3" data-testid="telegram-connected">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1 bg-green-600 text-xs text-white"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
                  {statusQ.data?.username && <span className="text-sm font-medium">{statusQ.data.username}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={sendTest} disabled={test.isPending}>
                    {test.isPending && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />} Send a test message
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">A Telegram message is a normal notification, not a phone call. So that you notice it:</p>
                  <ul className="list-disc space-y-0.5 ps-4">
                    <li>Do not mute the chat with the bot.</li>
                    <li>In Telegram, open the chat with the bot, tap its name, open Notifications and choose a sound that you will notice.</li>
                    <li>Allow Telegram notifications and background activity in your phone settings.</li>
                    <li>Do Not Disturb and Focus modes silence Telegram: allow Telegram as an exception.</li>
                  </ul>
                </div>
              </div>
            )}

            {view === 'paused' && (
              <div className="space-y-2" data-testid="telegram-paused">
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{pausedMessage(statusQ.data?.paused_reason)}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>Disconnect</Button>
              </div>
            )}

            {view !== 'connected' && waitingSince !== null && link && (
              <div className="rounded-lg border border-border/60 p-3 text-xs" data-testid="telegram-waiting">
                <p className="flex items-center gap-2 font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for you to press Start in Telegram…</p>
                <p className="mt-1 text-muted-foreground">Telegram did not open? Tap the button, then press Start in the chat with the bot. The link works for 15 minutes.</p>
                <Button asChild size="sm" variant="outline" className="mt-2 gap-1.5">
                  <a href={link} target="_blank" rel="noopener noreferrer"><Send className="h-3.5 w-3.5" /> Open Telegram</a>
                </Button>
              </div>
            )}

            {view !== 'connected' && waitingSince === null && (
              <Button size="sm" onClick={start} disabled={connect.isPending} className="gap-1.5">
                {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {view === 'paused' ? 'Reconnect Telegram' : 'Connect Telegram'}
              </Button>
            )}

            {unavailable === 'admin' && (
              <p className="text-xs text-muted-foreground" data-testid="telegram-unavailable">
                Telegram alerts are not available yet: the platform administrator has not finished connecting the bot. Please try again later.
              </p>
            )}
            {unavailable === 'unreachable' && (
              <p className="text-xs text-muted-foreground" data-testid="telegram-unreachable">
                Telegram could not be reached right now. Please try again in a few minutes.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
