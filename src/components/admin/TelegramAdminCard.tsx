import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSetTelegramWebhook, useTelegramAdminStatus } from '@/hooks/useTelegram';
import { adminNextStep } from '@/lib/telegramAlerts';

/**
 * Admin settings: the free Telegram channel of the critical request alert. Shows what is left to do (create the bot, add its token as the secret
 * TELEGRAM_BOT_TOKEN, connect the bot to the portal) and, when it runs, how many consultants are connected.
 */
export default function TelegramAdminCard() {
  const statusQ = useTelegramAdminStatus();
  const setWebhook = useSetTelegramWebhook();
  const s = statusQ.data;
  const step = s ? adminNextStep(s) : null;

  return (
    <Card className="rounded-2xl border-border/50" data-testid="telegram-admin-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Send className="h-4 w-4" /> Telegram alerts for consultants</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A free push message on the consultant's phone when a critical request is opened, next to the in-app alarm and the e-mail. It needs a Telegram bot of the platform; each consultant connects it in the own settings.
        </p>

        {statusQ.isLoading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : !s ? (
          <p className="text-xs text-destructive">The state of the Telegram bot could not be loaded. Please reload the page.</p>
        ) : (
          <>
            {step === 'create_bot' && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" data-testid="telegram-step-create">
                <p className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> The bot is not created yet</p>
                <ol className="list-decimal space-y-0.5 ps-4">
                  <li>In Telegram open the chat with @BotFather and send /newbot.</li>
                  <li>Choose a name and a user name that ends with "bot".</li>
                  <li>Copy the token that BotFather sends you. Keep it private: it works like a password.</li>
                  <li>Add the token as the secret TELEGRAM_BOT_TOKEN in the Lovable project (Cloud, Secrets).</li>
                  <li>Come back here and press Refresh.</li>
                </ol>
              </div>
            )}

            {step === 'fix_token' && (
              <div className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" data-testid="telegram-step-fix">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Telegram did not accept the token. Check the secret TELEGRAM_BOT_TOKEN: it must be the token that BotFather sent for this bot.</span>
              </div>
            )}

            {step === 'webhook_down' && (
              <div className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300" data-testid="telegram-step-down">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{`The portal function that receives the Telegram messages is not answering (${s.webhook_probe_status ? `HTTP ${s.webhook_probe_status}` : 'no answer'}). Check that the function telegram-webhook is deployed with sign-in switched off, then press Refresh.`}</span>
              </div>
            )}

            {(step === 'connect' || step === 'ready' || step === 'webhook_down') && (
              <div className="space-y-2" data-testid="telegram-bot-info">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{s.bot_name || 'Telegram bot'}</span>
                  {s.bot_username && <span className="text-muted-foreground">@{s.bot_username}</span>}
                  {step === 'ready' ? (
                    <Badge className="gap-1 bg-green-600 text-xs text-white"><CheckCircle2 className="h-3 w-3" /> Connected to the portal</Badge>
                  ) : (
                    <Badge className="bg-amber-500 text-xs text-white">{step === 'connect' ? 'Not connected to the portal yet' : 'Connected, but not answering'}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{s.links_active === 1 ? '1 consultant connected' : `${s.links_active} consultants connected`}</Badge>
                  {s.links_total > s.links_active && <Badge variant="outline" className="text-[10px]">{`${s.links_total - s.links_active} paused`}</Badge>}
                  {s.pending_updates > 0 && <Badge variant="outline" className="text-[10px]">{s.pending_updates === 1 ? '1 message waiting' : `${s.pending_updates} messages waiting`}</Badge>}
                </div>
                {s.last_error && <p className="text-xs text-red-700 dark:text-red-400">{`Telegram reported an error: ${s.last_error}`}</p>}
                {step === 'connect' && (
                  <p className="text-xs text-muted-foreground">Press the button once: it tells Telegram to send the messages of the bot to this portal, so that the consultants can connect.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {step === 'connect' && (
                <Button size="sm" onClick={() => setWebhook.mutate()} disabled={setWebhook.isPending} className="gap-1.5">
                  {setWebhook.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Connect the bot to the portal
                </Button>
              )}
              {step === 'ready' && (
                <Button size="sm" variant="outline" onClick={() => setWebhook.mutate()} disabled={setWebhook.isPending}>
                  {setWebhook.isPending && <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />} Connect again
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => statusQ.refetch()} disabled={statusQ.isFetching} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
