import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { startSocialSignIn, shouldRefuseNewSocialUser, clearSocialSignupIntent, NO_SOCIAL_ACCOUNT_MESSAGE, type SocialProvider } from '@/lib/socialSignin';
import { useSocialSignin } from '@/hooks/useSocialSignin';
import SocialSignInButtons from '@/components/auth/SocialSignInButtons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, MailCheck, Inbox, ShieldAlert } from 'lucide-react';
import VerificationTimeline from '@/components/auth/VerificationTimeline';
import PasswordInput from '@/components/auth/PasswordInput';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';
import logo from '@/assets/brand/domain.png.asset.json';
import { logAudit } from '@/lib/auditLog';
import { runSignInPreflight } from '@/lib/authPreflight';
import {
  getVerificationSentAt,
  setVerificationSentAt,
  setResendCooldown as persistResendCooldown,
  getResendCooldownRemaining,
  clearResendCooldown,
} from '@/lib/verificationStorage';
import {
  readOAuthError,
  isFirstTimeOAuthUser,
  newUserDestination,
  readStoredOAuthRole,
  storeOAuthRole,
  canonicalOAuthUrl,
  oauthRedirectUri,
  friendlyOAuthMessage,
  providerProfile,
  type FirstRole,
} from '@/lib/oauthReturn';
import { reportError } from '@/lib/errorReporter';

let oauthErrorReported = false;
function reportOAuthErrorOnce(provider: string, detail: string) {
  if (oauthErrorReported) return;
  oauthErrorReported = true;
  reportError({
    level: 'warn',
    source: 'oauth',
    message: `Social sign-in failed (${provider}): ${detail.slice(0, 160)}`,
    context: { provider, origin: window.location.origin },
  });
}

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
  const [oauthError, setOauthError] = useState<{ error: string; description: string } | null>(() => {
    const e = readOAuthError(location.search, location.hash);
    if (!e) return null;
    reportOAuthErrorOnce('google', `${e.error} ${e.description}`);
    return { ...e, description: friendlyOAuthMessage(e) };
  });
  const [roleChoice, setRoleChoice] = useState(false);
  const [choosingRole, setChoosingRole] = useState<FirstRole | null>(null);

  // A "Join as consultant" link carries ?role=consultant; remember it across the Google redirect.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('role') === 'consultant') storeOAuthRole('consultant');
  }, [location.search]);

  const finishRoleChoice = async (choice: FirstRole) => {
    setChoosingRole(choice);
    try {
      let finalRole: FirstRole = 'client';
      if (choice === 'consultant') {
        const { data, error } = await (supabase.rpc as any)('choose_first_oauth_role', { _role: 'consultant' });
        if (error) throw error;
        finalRole = data === 'consultant' ? 'consultant' : 'client';
      }
      storeOAuthRole(null);
      clearSocialSignupIntent();
      sessionStorage.removeItem('oauth_next');
      navigate(newUserDestination(finalRole), { replace: true });
    } catch (err) {
      console.error('Role choice failed:', err);
      toast.error(t('auth.role_choice_failed', 'Could not save your choice. Please try again.'));
      setChoosingRole(null);
    }
  };

  /**
   * Safety net: a brand-new social account that did not come from an allowed social sign-up is signed out
   * before anything is filled in or repaired, and the visitor is asked to sign up with e-mail.
   */
  const refuseNewSocialAccount = async (user: any) => {
    if (!shouldRefuseNewSocialUser(user)) return false;
    await supabase.auth.signOut();
    storeOAuthRole(null);
    sessionStorage.removeItem('oauth_next');
    const message = t('auth.no_social_account', NO_SOCIAL_ACCOUNT_MESSAGE);
    setOauthError({ error: 'no_account', description: message });
    setChecking(false);
    return true;
  };

  /** Returns true when a first-time social sign-in was handled (role step shown or applied). */
  const handleFirstTimeOAuth = async (user: any, role?: string) => {
    if (!isFirstTimeOAuthUser(user) || (role && role !== 'client')) return false;
    const preset = readStoredOAuthRole();
    if (preset) {
      await finishRoleChoice(preset);
      return true;
    }
    setRoleChoice(true);
    setChecking(false);
    return true;
  };

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

    // Social sign-in: fill an empty name/photo from the provider (never overwrite what the user set).
    if ((user as any).app_metadata?.provider && (user as any).app_metadata.provider !== 'email') {
      try {
        const { name, avatar } = providerProfile(user);
        const { data: prof } = await supabase.from('profiles').select('display_name, avatar_url').eq('user_id', user.id).maybeSingle();
        const patch: Record<string, string> = {};
        if (name && (!prof?.display_name || prof.display_name === user.email)) patch.display_name = name;
        if (avatar && !prof?.avatar_url) patch.avatar_url = avatar;
        if (Object.keys(patch).length) await supabase.from('profiles').update(patch).eq('user_id', user.id);
      } catch { /* prefill is optional */ }
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
        if (await refuseNewSocialAccount(session.user)) return;
        const role = await getRoleAndRepairAccount(session.user);
        if (await handleFirstTimeOAuth(session.user, role)) return;
        clearSocialSignupIntent();

        const oauthNext = sessionStorage.getItem('oauth_next');
        sessionStorage.removeItem('oauth_next');
        const dest = from || oauthNext;
        if (dest) {
          navigate(dest, { replace: true });
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

  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const socialProviders = useSocialSignin('login');

  const handleOAuthLogin = async (provider: SocialProvider) => {
    if (oauthLoading) return;
    // Social sign-in is switched off (or this provider is): never start the provider redirect.
    if (!socialProviders.includes(provider)) return;
    // The sign-in state is kept per address: start (and return) only on the canonical www address.
    const canonical = canonicalOAuthUrl(window.location.href);
    if (canonical) {
      window.location.assign(canonical);
      return;
    }
    setOauthLoading(provider);
    try {
      // Remember the intended destination across the OAuth redirect
      if (from) sessionStorage.setItem('oauth_next', from);
      setOauthError(null);
      const result = await startSocialSignIn(provider, {
        redirect_uri: oauthRedirectUri(window.location.origin),
      });
      if (result.error) {
        const msg = result.error.message || 'sign_in_failed';
        reportOAuthErrorOnce(provider, msg);
        setOauthError({ error: 'sign_in_failed', description: friendlyOAuthMessage(msg) });
        return;
      }
      if (result.redirected) return; // browser is navigating to the provider
      // Tokens returned and session already set — route by role
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (await refuseNewSocialAccount(user)) return;
        const role = await getRoleAndRepairAccount(user);
        if (await handleFirstTimeOAuth(user, role)) return;
        clearSocialSignupIntent();
        const next = sessionStorage.getItem('oauth_next');
        sessionStorage.removeItem('oauth_next');
        logAudit('login');
        if (next) navigate(next, { replace: true });
        else navigateByRole(role);
      }
    } catch (err) {
      console.error('OAuth sign-in failed:', err);
      toast.error('Sign-in failed. Please try again.');
    } finally {
      setOauthLoading(null);
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

  if (roleChoice) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative">
        <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
        <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
          <CardHeader className="text-center">
            <h1 className="font-semibold leading-none tracking-tight text-2xl">{t('auth.role_choice_title', 'How will you use AI Support 360?')}</h1>
            <CardDescription>{t('auth.role_choice_desc', 'Choose once to finish creating your account.')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button className="h-12" onClick={() => finishRoleChoice('client')} disabled={!!choosingRole}>
              {choosingRole === 'client' && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.role_choice_client', 'I need SAP support (Client)')}
            </Button>
            <Button variant="outline" className="h-12" onClick={() => finishRoleChoice('consultant')} disabled={!!choosingRole}>
              {choosingRole === 'consultant' && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.role_choice_consultant', 'I am an SAP consultant (Consultant)')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    // Phones: top-aligned so the card does not move when the web font arrives (centred cards shift with their height).
    <div className="min-h-screen flex items-start sm:items-center justify-center px-4 pt-4 sm:pt-0 relative">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4 group">
            <img src={logo.url} alt="AI Support 360" width={288} height={64} className="w-72 max-w-full h-16 object-contain transition-transform group-hover:scale-105" />
          </Link>
          <h1 className="font-semibold leading-none tracking-tight text-2xl">{t('auth.login_title')}</h1>
          <CardDescription>{t('auth.login_desc')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            {oauthError && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <p className="text-sm font-medium text-destructive">{t('auth.oauth_error_title', 'Sign-in did not complete')}</p>
                <p className="text-xs text-muted-foreground">{oauthError.description}</p>
                {oauthError.error !== 'no_account' && socialProviders.includes('google') && (
                  <Button type="button" size="sm" variant="outline" onClick={() => handleOAuthLogin('google')} disabled={!!oauthLoading}>
                    {t('auth.oauth_try_again', 'Try again')}
                  </Button>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-11 rounded-xl hover:-translate-y-0.5" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <PasswordInput id="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading || !!oauthLoading || !!(lockoutUntil && Date.now() < lockoutUntil)}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {lockRemaining ? `Locked (${lockRemaining})` : t('auth.login_btn')}
            </Button>
            <SocialSignInButtons providers={socialProviders} loadingProvider={oauthLoading} disabled={loading} onSelect={handleOAuthLogin} note={t('auth.social_returning_only', 'Returning users only. New accounts: please sign up with e-mail.')} />
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
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
