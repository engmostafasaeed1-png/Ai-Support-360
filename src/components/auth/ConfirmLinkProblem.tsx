import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestNewConfirmation, confirmWithCode, isCodeShape, RESEND_COOLDOWN_SECONDS, CONFIRM_SENDER } from '@/lib/confirmEmail';
import { getResendCooldownRemaining, setResendCooldown, setVerificationSentAt } from '@/lib/verificationStorage';

interface Props {
  initialEmail?: string;
  /** "I already confirmed - sign in". Defaults to a link to /login. */
  onSignIn?: () => void;
  /** Shown as a stand-alone section (confirm page) or inside the sign-in card. */
  compact?: boolean;
  /** 'code': opened on purpose to type the code (not because a link failed). */
  mode?: 'expired' | 'code';
}

/**
 * Shown when an e-mail confirmation link expired or was already used (often by a mail scanner).
 * Offers a new e-mail (60 s cooldown, neutral answer), the 6-digit code and "already confirmed - sign in".
 */
export default function ConfirmLinkProblem({ initialEmail = '', onSignIn, compact, mode = 'expired' }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(() => (initialEmail ? getResendCooldownRemaining(initialEmail) : 0));
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [showCode, setShowCode] = useState(mode === 'code');
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const resend = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    setNotice(null);
    try {
      const r = await requestNewConfirmation(email);
      if (r === 'invalid_email') {
        setNotice({ kind: 'error', text: t('auth.link.invalid_email', 'Please enter the e-mail address you signed up with.') });
        return;
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setResendCooldown(email, RESEND_COOLDOWN_SECONDS);
      if (r === 'rate_limited') {
        setNotice({ kind: 'error', text: t('auth.link.rate_limited', 'Too many requests for this address. Please wait a minute and try again.') });
        return;
      }
      setVerificationSentAt(email);
      setNotice({ kind: 'ok', text: t('auth.link.sent', 'If this address is waiting for confirmation, a new e-mail from {{sender}} is on its way. Check Inbox and Spam. If you already confirmed it, just sign in.', { sender: CONFIRM_SENDER }) });
    } finally {
      setSending(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCodeShape(code)) { setCodeError(t('auth.link.code_shape', 'Enter the 6-digit code from the e-mail.')); return; }
    setChecking(true);
    setCodeError(null);
    const r = await confirmWithCode(email, code);
    setChecking(false);
    if (r === 'ok') { navigate('/login', { replace: true, state: { confirmed: true } }); return; }
    setCodeError(t('auth.link.code_wrong', 'That code did not work. It may have expired: ask for a new e-mail above.'));
  };

  const signIn = onSignIn ?? (() => navigate('/login', { state: { confirmed: true } }));

  return (
    <section role={mode === 'code' ? undefined : 'alert'} aria-labelledby="link-problem-title"
      className={compact ? 'rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-3' : 'space-y-4'}>
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <h2 id="link-problem-title" className="text-sm font-semibold text-foreground">
            {mode === 'code'
              ? t('auth.link.code_title', 'Enter your confirmation code')
              : t('auth.link.title', 'Your confirmation link has expired or was already used')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {mode === 'code'
              ? t('auth.link.code_why', 'Type the e-mail address you signed up with and the 6-digit code from our confirmation e-mail. No code? Ask for a new e-mail.')
              : t('auth.link.why', 'Each link works once and only for a limited time. Some e-mail security filters open links automatically, which can use them up. Ask for a new e-mail below, or sign in if you already confirmed.')}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="link-problem-email">{t('auth.email', 'E-mail')}</Label>
        <Input id="link-problem-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="h-11 rounded-xl" dir="ltr" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={resend} disabled={sending || cooldown > 0} aria-busy={sending} className="h-11 flex-1">
          {sending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {cooldown > 0
            ? t('auth.link.resend_wait', 'Send again in {{s}} s', { s: cooldown })
            : t('auth.link.resend', 'Send me a new confirmation e-mail')}
        </Button>
        <Button type="button" variant="outline" onClick={signIn} className="h-11 flex-1">
          {t('auth.link.already', 'I already confirmed - sign in')}
        </Button>
      </div>
      {notice && (
        <p role="status" aria-live="polite" className={notice.kind === 'ok' ? 'flex items-start gap-2 text-xs text-foreground' : 'text-xs text-destructive'}>
          {notice.kind === 'ok' && <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
          <span>{notice.text}</span>
        </p>
      )}
      {!showCode ? (
        <button type="button" onClick={() => setShowCode(true)} className="text-xs font-medium text-primary underline">
          {t('auth.link.have_code', 'Have the 6-digit code from the e-mail? Enter it instead')}
        </button>
      ) : (
        <form onSubmit={submitCode} className="space-y-2" aria-label={t('auth.link.code_form', 'Confirm with a code')}>
          <Label htmlFor="link-problem-code">{t('auth.link.code_label', 'Code from the e-mail')}</Label>
          <div className="flex gap-2">
            <Input id="link-problem-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="h-11 max-w-40 rounded-xl tracking-widest" dir="ltr"
              aria-invalid={!!codeError} aria-describedby={codeError ? 'link-problem-code-error' : undefined} />
            <Button type="submit" variant="secondary" className="h-11" disabled={checking}>
              {checking && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('auth.link.code_btn', 'Confirm')}
            </Button>
          </div>
          {codeError && <p id="link-problem-code-error" className="text-xs text-destructive">{codeError}</p>}
        </form>
      )}
      {!compact && (
        <p className="text-xs text-muted-foreground">
          <Link to="/signup" className="text-primary underline">{t('auth.link.signup_again', 'Used a different address? Sign up again')}</Link>
        </p>
      )}
    </section>
  );
}
