import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Users, Briefcase, MailCheck, Inbox, ShieldAlert, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import PasswordInput from '@/components/auth/PasswordInput';
import PasswordStrength from '@/components/auth/PasswordStrength';
import { cn } from '@/lib/utils';
import { storeOAuthRole, canonicalOAuthUrl, oauthRedirectUri, friendlyOAuthMessage } from '@/lib/oauthReturn';
import { lovable } from '@/integrations/lovable/index';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';
import logo from '@/assets/brand/domain.png.asset.json';
import VerificationTimeline from '@/components/auth/VerificationTimeline';
import LocationPicker, { type PickedLocation } from '@/components/consultant/LocationPicker';
import { locationError } from '@/lib/consultantLocation';
import { storeSignupLocation } from '@/lib/signupLocation';
import {
  getVerificationSentAt,
  setVerificationSentAt,
  clearVerificationSentAt,
  setResendCooldown as persistResendCooldown,
  getResendCooldownRemaining,
  clearResendCooldown,
} from '@/lib/verificationStorage';

const PENDING_EMAIL_KEY = 'verification_pending_email';

type Role = 'client' | 'consultant';

export default function SignupPage() {
  const { t } = useTranslation();
  // registration_is_open() is answered for visitors who are not signed in; an unreadable answer counts as open (the database blocks sign-up when it is closed)
  const { data: open } = useQuery({
    queryKey: ['registration-is-open'],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('registration_is_open');
      if (error) throw error;
      return data !== false;
    },
    staleTime: 30_000,
    retry: 1,
  });
  // someone who already signed up and still has to confirm the e-mail keeps seeing the confirmation screen
  let hasPendingEmail = false;
  try { hasPendingEmail = !!localStorage.getItem(PENDING_EMAIL_KEY); } catch { /* ignore */ }

  if (open === false && !hasPendingEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
        <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
        <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
              <Lock className="w-7 h-7 text-primary" />
            </div>
            <h1 className="font-semibold leading-none tracking-tight text-2xl">{t('auth.signup_closed_title', 'Registration is closed')}</h1>
            <CardDescription>{t('auth.signup_closed_desc', 'New accounts cannot be created at the moment. If you already have an account you can sign in.')}</CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-3">
            <Button asChild className="w-full gradient-primary border-0 h-11 text-base">
              <Link to="/login">{t('auth.login_link', 'Sign in')}</Link>
            </Button>
            <Button asChild variant="outline" className="w-full h-11 rounded-xl">
              <Link to="/">{t('auth.back_home', 'Back to home')}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return <SignupForm />;
}

function SignupForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get('role') === 'consultant' ? 'consultant' : 'client';
  const referralCode = searchParams.get('ref') || '';

  const [role, setRole] = useState<Role>(initialRole);
  const [agreed, setAgreed] = useState(false);
  const [place, setPlace] = useState<PickedLocation>({ country: '', city: '' });
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const handleGoogleSignup = async () => {
    if (!agreed || googleLoading) return;
    const canonical = canonicalOAuthUrl(window.location.href);
    if (canonical) { window.location.assign(canonical + window.location.search); return; }
    // Consultants choose country and city first; it is saved on their first sign-in.
    if (role === 'consultant') {
      const missing = locationError(place.country, place.city);
      if (missing) { setPlaceError(missing); return; }
      storeSignupLocation(place.country, place.city);
    }
    storeOAuthRole(role);
    setGoogleError(null);
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth('google', { redirect_uri: oauthRedirectUri(window.location.origin) });
      if (result.error) { setGoogleError(friendlyOAuthMessage(result.error.message || '')); return; }
      if (result.redirected) return;
      navigate('/login', { replace: true }); // popup flow: session set, /login applies the stored account type
    } catch {
      setGoogleError(friendlyOAuthMessage(''));
    } finally {
      setGoogleLoading(false);
    }
  };
  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => (searchParams.get('email') || '').slice(0, 254));
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(() => {
    try { return localStorage.getItem(PENDING_EMAIL_KEY); } catch { return null; }
  });
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(PENDING_EMAIL_KEY);
      return stored ? getResendCooldownRemaining(stored) : 0;
    } catch { return 0; }
  });
  const [lastResentAt, setLastResentAt] = useState<Date | null>(() => {
    try {
      const stored = localStorage.getItem(PENDING_EMAIL_KEY);
      return stored ? getVerificationSentAt(stored) : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (!pendingEmail || resendCooldown > 0) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: pendingEmail,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setResending(false);
    if (error) {
      toast.error(error.message || 'Could not resend verification email.');
      return;
    }
    const now = new Date();
    setLastResentAt(now);
    setVerificationSentAt(pendingEmail, now);
    setResendCooldown(60);
    persistResendCooldown(pendingEmail, 60);
    toast.success('Verification email sent. Check your inbox.');
  };

  const DISPOSABLE_DOMAINS = ['mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'throwaway.email', 'yopmail.com'];

  const PASSWORD_RULES = [
    { test: (p: string) => p.length >= 12, label: 'At least 12 characters' },
    { test: (p: string) => /[A-Z]/.test(p), label: 'One uppercase letter' },
    { test: (p: string) => /[a-z]/.test(p), label: 'One lowercase letter' },
    { test: (p: string) => /[0-9]/.test(p), label: 'One number' },
    { test: (p: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p), label: 'One special character' },
    { test: (p: string) => !/(.)\1{2,}/.test(p), label: 'No repeated characters (e.g. aaa)' },
  ];

  const getPasswordStrength = (p: string): 'weak' | 'fair' | 'strong' | 'very-strong' => {
    const passed = PASSWORD_RULES.filter(r => r.test(p)).length;
    if (passed <= 2) return 'weak';
    if (passed <= 3) return 'fair';
    if (passed <= 5) return 'strong';
    return 'very-strong';
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    // Disposable email check
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && DISPOSABLE_DOMAINS.includes(domain)) {
      toast.error('Please use a professional or company email address.');
      return;
    }

    // Password strength check
    const strength = getPasswordStrength(password);
    if (strength === 'weak' || strength === 'fair') {
      toast.error('Password does not meet security requirements.');
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(t('auth.password_min'));
      return;
    }
    if (role === 'consultant') {
      const missing = locationError(place.country, place.city);
      if (missing) { setPlaceError(missing); toast.error(missing); return; }
      storeSignupLocation(place.country, place.city);
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { display_name: name, role, ...(role === 'consultant' ? { country: place.country.trim(), city: place.city.trim() } : {}), ...(referralCode ? { referral_code: referralCode } : {}) },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.user && !data.session) {
      const now = new Date();
      setPendingEmail(email);
      try { localStorage.setItem(PENDING_EMAIL_KEY, email); } catch { /* ignore */ }
      setLastResentAt(now);
      setVerificationSentAt(email, now);
      setResendCooldown(60);
      persistResendCooldown(email, 60);
      toast.success('Check your inbox to verify your email before signing in.');
      return;
    }
    if (data.user) {
      // Role, profile and consultant / client_profile rows are provisioned by the handle_new_user database trigger.
      if (role === 'consultant') {
        navigate('/consultant/onboarding');
      } else {
        // Create tenant for client signup
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
        const tenantId = crypto.randomUUID();
        await supabase.from('tenants').insert({ id: tenantId, name: name + "'s Organization", slug });
        await supabase.from('tenant_members').insert({
          tenant_id: tenantId,
          user_id: data.user.id,
          org_role: 'owner' as any,
        });
        navigate('/client/companies');
      }
    }
  };

  if (pendingEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
        <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
        <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
          <CardHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
              <MailCheck className="w-7 h-7 text-primary" />
            </div>
            <h1 className="font-semibold leading-none tracking-tight text-2xl">Verify your email</h1>
            <CardDescription>
              We sent a verification link to <span className="font-medium text-foreground">{pendingEmail}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted/40 border border-border/50 p-4 space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <Inbox className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <span>Open your inbox and click the verification link.</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 mt-0.5 text-orange-500 shrink-0" />
                <span>Didn't see it? Check your <strong>Spam</strong> or <strong>Promotions</strong> folder.</span>
              </div>
            </div>
            {lastResentAt && (
              <VerificationTimeline
                sentAt={lastResentAt}
                onResend={handleResend}
                resending={resending}
                resendCooldown={resendCooldown}
              />
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              onClick={handleResend}
              disabled={resending || resendCooldown > 0}
              className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all"
            >
              {resending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : 'Resend verification email'}
            </Button>
            <Button variant="outline" onClick={() => navigate('/login')} className="w-full h-11 rounded-xl">
              Go to login
            </Button>
            <button
              type="button"
              onClick={() => {
                if (pendingEmail) {
                  clearVerificationSentAt(pendingEmail);
                  clearResendCooldown(pendingEmail);
                }
                try { localStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* ignore */ }
                setPendingEmail(null);
                setLastResentAt(null);
                setResendCooldown(0);
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Use a different email
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4 group">
            <img src={logo.url} alt="AI Support 360" width={288} height={64} className="w-72 max-w-full h-16 object-contain transition-transform group-hover:scale-105" />
          </Link>
          <h1 className="font-semibold leading-none tracking-tight text-2xl">{t('auth.signup_title')}</h1>
          <CardDescription>{t('auth.signup_desc')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSignup}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('auth.role')}</Label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'client' as Role, icon: Users, label: t('auth.role_client'), desc: t('auth.role_client_desc') },
                  { value: 'consultant' as Role, icon: Briefcase, label: t('auth.role_consultant'), desc: t('auth.role_consultant_desc') },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all text-center hover:scale-[1.02]',
                      role === opt.value
                        ? 'border-primary bg-primary/5 shadow-premium'
                        : 'border-border hover:border-muted-foreground/30'
                    )}
                  >
                    <opt.icon className={cn('w-5 h-5', role === opt.value ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="text-sm font-medium">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('auth.name')}</Label>
              <Input id="name" required value={name} onChange={e => setName(e.target.value)} placeholder={t('auth.name_placeholder')} className="h-11 rounded-xl" />
            </div>
            {role === 'consultant' && (
              <LocationPicker idPrefix="signup-location" value={place} onChange={v => { setPlace(v); setPlaceError(null); }} error={placeError} />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-11 rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <PasswordInput id="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              <PasswordStrength password={password} />
              {password.length > 0 && (
                <div className="space-y-1 mt-2">
                  {PASSWORD_RULES.map((rule, i) => (
                    <div key={i} className={cn('text-[10px] flex items-center gap-1', rule.test(password) ? 'text-green-600' : 'text-destructive')}>
                      <span>{rule.test(password) ? '✓' : '✗'}</span>
                      <span>{rule.label}</span>
                    </div>
                  ))}
                  <div className="flex gap-1 mt-1">
                    {['weak', 'fair', 'strong', 'very-strong'].map((level, i) => {
                      const strength = getPasswordStrength(password);
                      const levels = ['weak', 'fair', 'strong', 'very-strong'];
                      const active = levels.indexOf(strength) >= i;
                      const colors = ['bg-destructive', 'bg-orange-500', 'bg-accent', 'bg-green-500'];
                      return <div key={level} className={cn('h-1 flex-1 rounded-full', active ? colors[i] : 'bg-muted')} />;
                    })}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{t('auth.password_hint')}</p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-xs text-muted-foreground w-full">
              <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-[hsl(var(--primary))]" aria-label="I agree to the Terms & Conditions and Privacy Policy" />
              <span>
                I agree to the{' '}
                <a href="/terms-and-conditions" target="_blank" rel="noopener" className="text-primary underline">Terms &amp; Conditions</a>
                {' '}and{' '}
                <a href="/privacy-policy" target="_blank" rel="noopener" className="text-primary underline">Privacy Policy</a>.
              </span>
            </label>
            <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.signup_btn')}
            </Button>
            <Button type="button" variant="outline" className="w-full h-11 rounded-xl" onClick={handleGoogleSignup} disabled={loading || googleLoading || !agreed} aria-describedby={!agreed ? 'google-terms-hint' : undefined}>
              {googleLoading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.signup_google', 'Sign up with Google')}
            </Button>
            {!agreed && <p id="google-terms-hint" className="text-[11px] text-muted-foreground">{t('auth.signup_google_terms', 'Tick the Terms box first to sign up with Google.')}</p>}
            {googleError && <p role="alert" className="text-xs text-destructive">{googleError}</p>}
            <p className="text-sm text-muted-foreground">
              {t('auth.have_account')}{' '}
              <Link to={role === 'consultant' ? '/login?role=consultant' : '/login'} onClick={() => storeOAuthRole(role)} className="text-primary font-medium hover:underline">{t('auth.login_link')}</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
