import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { BellOff, BellRing, CheckCircle2, Loader2, MailX, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { formatPauseEnd } from '@/lib/notificationPause';

type State = 'loading' | 'paused' | 'resumed' | 'unsubscribed' | 'not_paused' | 'error';
type ErrorCode = 'invalid_link' | 'expired_link' | 'too_many' | 'disabled' | 'unavailable';
interface Result { ok?: boolean; state?: string; until?: string | null; can_mark_unavailable?: boolean; unavailable?: boolean; error?: ErrorCode }

/**
 * Feature Q: confirmation page for the one-click pause links in notification e-mails. No sign-in needed: the signed
 * link is checked by the server. Shows only the pause state and end date, never names or addresses.
 */
export default function NotificationPausePage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [state, setState] = useState<State>('loading');
  const [result, setResult] = useState<Result>({});
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (params.get('lang') === 'ar' && i18n.language !== 'ar') void i18n.changeLanguage('ar');
  }, [params, i18n]);

  const call = useCallback(async (action: 'apply' | 'resume' | 'unavailable') => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('notification-pause', { body: { token, action } });
      let r = (data ?? {}) as Result;
      if (error) {
        // Error responses still carry a short code (invalid / expired link, too many tries).
        try { r = await (error as { context?: Response }).context?.json() ?? {}; } catch { r = {}; }
      }
      setResult(r);
      if (!r.ok) { setState('error'); return; }
      setState(r.state === 'paused' ? 'paused' : r.state === 'resumed' ? 'resumed' : r.state === 'unsubscribed' ? 'unsubscribed' : 'not_paused');
    } catch {
      setResult({ error: 'unavailable' });
      setState('error');
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) { setResult({ error: 'invalid_link' }); setState('error'); return; }
    void call('apply');
  }, [token, call]);

  const until = result.until ? formatPauseEnd(result.until, i18n.language) : '';
  const errorText: Record<ErrorCode, string> = {
    invalid_link: t('npause.err_invalid', 'This link is not valid. Please use the newest e-mail, or sign in and pause notifications in your settings.'),
    expired_link: t('npause.err_expired', 'This link has expired. Sign in and pause notifications in your settings.'),
    too_many: t('npause.err_too_many', 'Too many tries. Please wait a little and try again.'),
    disabled: t('npause.disabled', 'Pausing notifications is currently switched off.'),
    unavailable: t('npause.err_unavailable', 'This is not available right now. Please try again later.'),
  };

  const Icon = state === 'loading' ? Loader2 : state === 'paused' ? BellOff : state === 'resumed' ? BellRing
    : state === 'unsubscribed' ? MailX : state === 'error' ? XCircle : CheckCircle2;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4" dir={i18n.language === 'ar' ? 'rtl' : 'ltr'}>
      <Card className="w-full max-w-md rounded-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icon className={`h-6 w-6 ${state === 'error' ? 'text-destructive' : 'text-primary'} ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden />
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight" aria-live="polite">
            {state === 'loading' && t('npause.page_saving', 'Saving your choice…')}
            {state === 'paused' && t('npause.paused_until', 'Paused until {{date}}', { date: until })}
            {state === 'resumed' && t('npause.resumed_toast', 'Your notifications are back on.')}
            {state === 'unsubscribed' && t('npause.page_unsubscribed', 'You are unsubscribed')}
            {state === 'not_paused' && t('npause.page_not_paused', 'Your notifications are on')}
            {state === 'error' && t('npause.page_error', 'We could not change your notifications')}
          </h1>
          <CardDescription className="pt-1">
            {state === 'paused' && t('npause.page_paused_desc', 'Reminders, digests and activity e-mails are paused until then. Security, payment, legal and policy messages, Critical alarms and new assignment requests still arrive. The pause ends by itself.')}
            {state === 'resumed' && t('npause.page_resumed_desc', 'You will receive e-mails and alerts as usual again.')}
            {state === 'unsubscribed' && t('npause.page_unsub_desc', 'You will no longer receive notification e-mails from AI Support 360 at this address.')}
            {state === 'error' && errorText[result.error ?? 'unavailable']}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'paused' && result.can_mark_unavailable && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
              {result.unavailable ? (
                <p>{t('npause.marked_unavailable', 'Marked unavailable for new requests')}</p>
              ) : (
                <>
                  <p className="text-muted-foreground">{t('npause.stay_available', 'You stay available: new requests still reach you and count in your responsiveness statistics as usual.')}</p>
                  <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => call('unavailable')}>
                    {t('npause.unavailable', 'Also mark me unavailable for new requests during this period (recommended)')}
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {state === 'paused' && (
              <Button onClick={() => call('resume')} disabled={busy}>
                {busy && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden />}{t('npause.resume', 'Resume now')}
              </Button>
            )}
            {state === 'error' && result.error !== 'invalid_link' && result.error !== 'expired_link' && result.error !== 'disabled' && (
              <Button variant="outline" onClick={() => call('apply')} disabled={busy}>{t('common.retry', 'Try again')}</Button>
            )}
            <Button variant="ghost" asChild><Link to="/auth">{t('npause.page_settings', 'Sign in to change your settings')}</Link></Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
