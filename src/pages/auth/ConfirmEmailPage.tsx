import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';
import logo from '@/assets/brand/domain.png.asset.json';
import ConfirmLinkProblem from '@/components/auth/ConfirmLinkProblem';
import { confirmWithTokenHash, readConfirmParams } from '@/lib/confirmEmail';
import { isEmailLinkError, readOAuthError } from '@/lib/oauthReturn';
import { getPendingEmail, PENDING_EMAIL_KEY } from '@/lib/verificationStorage';

/**
 * /auth/confirm — the confirmation e-mail opens this page. The link is only used when the person
 * presses the button, so e-mail security scanners that open links cannot use it up.
 */
export default function ConfirmEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  // Read once: the address bar is cleaned right after the first render.
  const [params] = useState(() => readConfirmParams(search));
  const [linkError] = useState(() => readOAuthError(search, hash));
  const [state, setState] = useState<'ready' | 'busy' | 'problem' | 'failed'>(
    linkError && isEmailLinkError(linkError) ? 'problem' : params.tokenHash ? 'ready' : 'problem',
  );
  const email = params.email || getPendingEmail();

  useEffect(() => {
    // Do not keep the one-time token in the address bar or the browser history.
    if (params.tokenHash || linkError) window.history.replaceState(null, '', '/auth/confirm');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    if (!params.tokenHash || state === 'busy') return;
    setState('busy');
    const r = await confirmWithTokenHash(params.tokenHash, params.type);
    if (r === 'ok') {
      try { localStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* ignore */ }
      navigate('/login', { replace: true, state: { confirmed: true } });
      return;
    }
    setState(r === 'expired' ? 'problem' : 'failed');
  };

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 pt-4 sm:pt-0 relative py-8">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4">
            <img src={logo.url} alt="AI Support 360" width={288} height={64} className="w-72 max-w-full h-16 object-contain" />
          </Link>
          {state === 'ready' || state === 'busy' ? (
            <>
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <MailCheck className="h-7 w-7 text-primary" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-semibold leading-none tracking-tight">{t('auth.confirm.title', 'Confirm your e-mail')}</h1>
              <CardDescription>{t('auth.confirm.desc', 'One click and your account is ready. You will be signed in and can continue where you stopped.')}</CardDescription>
            </>
          ) : (
            <h1 className="text-2xl font-semibold leading-none tracking-tight">{t('auth.confirm.problem_title', 'Confirm your e-mail')}</h1>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {(state === 'ready' || state === 'busy') && (
            <>
              <Button onClick={confirm} disabled={state === 'busy'} aria-busy={state === 'busy'} className="h-12 w-full gradient-primary border-0 text-base">
                {state === 'busy' && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('auth.confirm.button', 'Confirm my e-mail')}
              </Button>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {t('auth.confirm.why_button', 'We ask for this click so that e-mail security filters, which open links automatically, cannot use up your link.')}
              </p>
            </>
          )}
          {state === 'failed' && (
            <p role="alert" className="text-sm text-destructive">{t('auth.confirm.failed', 'We could not reach the server. Check your connection and try again.')}
              {' '}<button type="button" className="underline" onClick={() => setState('ready')}>{t('auth.confirm.retry', 'Try again')}</button></p>
          )}
          {state === 'problem' && <ConfirmLinkProblem initialEmail={email} />}
        </CardContent>
      </Card>
    </div>
  );
}
