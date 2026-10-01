import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import GuestExploreModal from '@/components/guest/GuestExploreModal';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Eye, MailCheck, Inbox, ShieldAlert } from 'lucide-react';
import VerificationTimeline from '@/components/auth/VerificationTimeline';
import PasswordInput from '@/components/auth/PasswordInput';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';
import { logAudit } from '@/lib/auditLog';
import { runSignInPreflight } from '@/lib/authPreflight';
import {
  getVerificationSentAt,
  setVerificationSentAt,
  setResendCooldown as persistResendCooldown,
  getResendCooldownRemaining,
  clearResendCooldown,
} from '@/lib/verificationStorage';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const nextParam = new URLSearchParams(location.search).get('next');
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : null;
  const from = safeNext || (location.state as any)?.from || null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [failedAttempts, setFailedAttempts] = useState(() => parseInt(sessionStorage.getItem('login_attempts') || '0'));
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    const v = parseInt(sessionStorage.getItem('login_lockout') || '0');
    return v > 0 ? v : null;
  });
  const [lockRemaining, setLockRemaining] = useState('');
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccessAt, setResendSuccessAt] = useState<Date | null>(null);
  const [resendSuccessEmail, setResendSuccessEmail] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  // Rehydrate the verification timeline if we previously sent an email to this address.
  useEffect(() => {
    if (!email) return;
    const stored = getVerificationSentAt(email);
    if (stored) {
      setResendSuccessAt(stored);
      setResendSuccessEmail(email);
    }
    const cooldown = getResendCooldownRemaining(email);
    if (cooldown > 0) setResendCooldown(cooldown);
  }, [email]);

  const handleResendConfirmation = async () => {
    if (resending || resendCooldown > 0) return;
    if (!email) {
      toast.error('Please enter your email above first.');
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setResending(false);
    if (error) {
      toast.error(error.message || 'Could not resend confirmation email.');
      return;
    }
    const now = new Date();
    setResendSuccessAt(now);
    setResendSuccessEmail(email);
    setVerificationSentAt(email, now);
    setResendCooldown(60);
    persistResendCooldown(email, 60);
    toast.success('Verification email sent.');
    logAudit('resend_confirmation_email', { email });
  };

  const getRoleAndRepairAccount = async (user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, any>;
  }) => {
    const { data: roles, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .limit(1);

    if (roleError) throw roleError;

    const role = roles?.[0]?.role as 'client' | 'consultant' | 'admin' | undefined;
    const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';

    const { data: existingProfile, error: profileLookupError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileLookupError) throw profileLookupError;

    if (!existingProfile) {
      const { error: profileInsertError } = await supabase.from('profiles').insert({
        user_id: user.id,
        display_name: displayName,
        onboarding_completed: false,
      });

      if (profileInsertError) throw profileInsertError;
    }

    if (role === 'consultant') {
      const { data: existingConsultant, error: consultantLookupError } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (consultantLookupError) throw consultantLookupError;

      if (!existingConsultant) {
        const { error: consultantInsertError } = await supabase.from('consultants').insert({
          user_id: user.id,
        });

        if (consultantInsertError) throw consultantInsertError;
      }
    }

    if (role === 'client') {
      const { data: existingClientProfile, error: clientProfileLookupError } = await supabase
        .from('client_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (clientProfileLookupError) throw clientProfileLookupError;

      if (!existingClientProfile) {
        const { error: clientProfileInsertError } = await supabase.from('client_profiles').insert({
          user_id: user.id,
          onboarding_completed: false,
        });

        if (clientProfileInsertError) throw clientProfileInsertError;
      }
    }

    return role;
  };

  const navigateByRole = (role?: 'client' | 'consultant' | 'admin') => {
    if (role === 'consultant') {
      navigate('/consultant', { replace: true });
      return;
    }

    if (role === 'admin') {
      navigate('/admin', { replace: true });
      return;
    }

    navigate('/client', { replace: true });
  };

  // If user is already logged in, redirect them away from login page
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setChecking(false);
        return;
      }

      try {
        const role = await getRoleAndRepairAccount(session.user);

        if (from) {
          navigate(from, { replace: true });
          return;
        }

        navigateByRole(role);
      } catch (error) {
        console.error(error);
        toast.error('Unable to restore your account. Please try again.');
        setChecking(false);
      }
    };
    checkSession();
  }, [navigate, from]);

  // Lockout countdown
  useEffect(() => {
    if (!lockoutUntil || Date.now() >= lockoutUntil) { setLockRemaining(''); return; }
    const tick = () => {
      const diff = (lockoutUntil ?? 0) - Date.now();
      if (diff <= 0) { setLockRemaining(''); setLockoutUntil(null); sessionStorage.removeItem('login_lockout'); sessionStorage.removeItem('login_attempts'); setFailedAttempts(0); return; }
      const m = Math.floor(diff / 60000); const s = Math.floor((diff % 60000) / 1000);
      setLockRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleLogin = async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    try {
      // Remember the intended destination across the OAuth redirect
      if (from) sessionStorage.setItem('oauth_next', from);
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message || 'Google sign-in failed. Please try again.');
        return;
      }
      if (result.redirected) return; // browser is navigating to Google
      // Tokens returned and session already set — route by role
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const role = await getRoleAndRepairAccount(user);
        const next = sessionStorage.getItem('oauth_next');
        sessionStorage.removeItem('oauth_next');
        logAudit('login_google');
        if (next) navigate(next, { replace: true });
        else navigateByRole(role);
      }
    } catch (err) {
      console.error('Google sign-in failed:', err);
      toast.error('Google sign-in failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check lockout
    const now = Date.now();
    if (lockoutUntil && now < lockoutUntil) {
      const remaining = Math.ceil((lockoutUntil - now) / 60000);
      toast.error(`Account temporarily locked. Try again in ${remaining} minute${remaining > 1 ? 's' : ''}.`);
      return;
    }

    setLoading(true);

    // Preflight: validate auth config, endpoint reachability, and existing session
    const preflight = await runSignInPreflight();
    if (!preflight.ok) {
      setLoading(false);
      toast.error(preflight.message);
      logAudit('login_preflight_failed', { reason: preflight.reason });
      return;
    }

    // If a valid session already exists, skip password sign-in and route by role
    if (preflight.hasValidSession) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const role = await getRoleAndRepairAccount(user);
          if (from) navigate(from, { replace: true });
          else navigateByRole(role);
          return;
        }
      } catch (err) {
        console.error('Existing session route failed:', err);
        // Fall through to password sign-in
      } finally {
        setLoading(false);
      }
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setLoading(false);

      // Special-case: email not yet confirmed — surface resend flow instead of "invalid credentials"
      const msg = (error.message || '').toLowerCase();
      const code = (error as any).code as string | undefined;
      if (code === 'email_not_confirmed' || msg.includes('not confirmed') || msg.includes('email not confirmed')) {
        toast.error('Your email is not verified yet. Please check your inbox.');
        // Auto-trigger resend if not in cooldown so the user has a fresh link
        if (!resendCooldown && !resending) {
          await handleResendConfirmation();
        }
        return;
      }

      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);
      sessionStorage.setItem('login_attempts', String(newAttempts));
      logAudit('login_failed', { email });
      if (newAttempts >= MAX_ATTEMPTS) {
        const lockUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
        setLockoutUntil(lockUntil);
        sessionStorage.setItem('login_lockout', String(lockUntil));
        toast.error(`Too many failed attempts. Login locked for ${LOCKOUT_MINUTES} minutes.`);
        return;
      }
      toast.error(`Invalid credentials. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts > 1 ? 's' : ''} remaining.`);
      return;
    }

    if (!data.session) {
      setLoading(false);
      toast.error('Unable to start your session. Please try again.');
      return;
    }

    // Clear lockout on success
    sessionStorage.removeItem('login_attempts');
    sessionStorage.removeItem('login_lockout');
    setFailedAttempts(0);
    setLockoutUntil(null);
    logAudit('login');

    try {
      const role = await getRoleAndRepairAccount(data.session.user);

      if (from) {
        navigate(from, { replace: true });
        return;
      }

      navigateByRole(role);
    } catch (repairError) {
      console.error(repairError);
      toast.error('Login succeeded, but your account setup could not be restored.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4 group">
            <img src="/assets/logo.png" alt="AI SAP Support Now" className="w-9 h-9 rounded-xl object-contain shadow-sm group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xl text-foreground">AI SAP Support Now</span>
          </Link>
          <h1 className="font-semibold leading-none tracking-tight text-2xl">{t('auth.login_title')}</h1>
          <CardDescription>{t('auth.login_desc')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <PasswordInput id="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading || googleLoading || !!(lockoutUntil && Date.now() < lockoutUntil)}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {lockRemaining ? `Locked (${lockRemaining})` : t('auth.login_btn')}
            </Button>
            <div className="flex items-center gap-3 w-full" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t('auth.or_continue_with')}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full h-11 rounded-xl text-base"
              onClick={handleGoogleLogin}
              disabled={loading || googleLoading}
            >
              {googleLoading ? (
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
              ) : (
                <svg className="w-4 h-4 me-2" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
                  <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
                </svg>
              )}
              {t('auth.continue_with_google')}
            </Button>
            <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('auth.forgot_link')}
            </Link>
            {resendSuccessAt ? (
              <div
                role="status"
                aria-live="polite"
                className="w-full rounded-xl border border-green-500/30 bg-green-500/5 p-3 space-y-2 animate-fade-in"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                  <MailCheck className="w-4 h-4" />
                  Verification email sent to {resendSuccessEmail}
                </div>
                <ul className="text-xs text-muted-foreground space-y-1 ps-1">
                  <li className="flex items-start gap-2">
                    <Inbox className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                    <span>Open the link in your inbox to verify your account.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 text-orange-500 shrink-0" />
                    <span>Not there? Check <strong>Spam</strong> or <strong>Promotions</strong>.</span>
                  </li>
                </ul>
                <VerificationTimeline
                  sentAt={resendSuccessAt}
                  onResend={handleResendConfirmation}
                  resending={resending}
                  resendCooldown={resendCooldown}
                />
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resending || resendCooldown > 0}
                  className="text-xs text-primary hover:underline disabled:opacity-60 disabled:no-underline inline-flex items-center gap-1.5"
                >
                  {resending && <Loader2 className="w-3 h-3 animate-spin" />}
                  {resendCooldown > 0 ? `Resend again in ${resendCooldown}s` : 'Resend again'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resending || resendCooldown > 0}
                aria-busy={resending}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {resending
                  ? 'Sending...'
                  : resendCooldown > 0
                    ? `Resend available in ${resendCooldown}s`
                    : "Didn't get the confirmation email? Resend"}
              </button>
            )}
            <p className="text-sm text-muted-foreground">
              {t('auth.no_account')}{' '}
              <Link to="/signup" className="text-primary font-medium hover:underline">{t('auth.signup_link')}</Link>
            </p>
            <button
              type="button"
              onClick={() => setExploreOpen(true)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Eye className="w-4 h-4" />
              {t('guest.explore_btn')}
            </button>
          </CardFooter>
        </form>
        <GuestExploreModal open={exploreOpen} onOpenChange={setExploreOpen} />
      </Card>
    </div>
  );
}
