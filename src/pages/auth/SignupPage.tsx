import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Users, Briefcase, Eye, MailCheck, Inbox, ShieldAlert } from 'lucide-react';
import PasswordInput from '@/components/auth/PasswordInput';
import PasswordStrength from '@/components/auth/PasswordStrength';
import { cn } from '@/lib/utils';
import GuestExploreModal from '@/components/guest/GuestExploreModal';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';
import VerificationTimeline from '@/components/auth/VerificationTimeline';
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get('role') === 'consultant' ? 'consultant' : 'client';
  const referralCode = searchParams.get('ref') || '';

  const [role, setRole] = useState<Role>(initialRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(() => {
    try { return localStorage.getItem(PENDING_EMAIL_KEY); } catch { return null; }
  });
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
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

    if (password.length < 6) {
      toast.error(t('auth.password_min'));
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { display_name: name, role, ...(referralCode ? { referral_code: referralCode } : {}) },
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
      toast.success('Check your inbox to verify your email before signing in.');
      return;
    }
    if (data.user) {
      await supabase.from('user_roles').insert({ user_id: data.user.id, role });
      if (role === 'consultant') {
        await supabase.from('consultants').insert({ user_id: data.user.id });
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
        await supabase.from('client_profiles').insert({ user_id: data.user.id });
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
            <CardTitle className="text-2xl">Verify your email</CardTitle>
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
                if (pendingEmail) clearVerificationSentAt(pendingEmail);
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
            <img src="/assets/logo.png" alt="AI SAP Support Now" className="w-9 h-9 rounded-xl object-contain shadow-sm group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xl text-foreground">AI SAP Support Now</span>
          </Link>
          <CardTitle className="text-2xl">{t('auth.signup_title')}</CardTitle>
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
            <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.signup_btn')}
            </Button>
            <p className="text-sm text-muted-foreground">
              {t('auth.have_account')}{' '}
              <Link to="/login" className="text-primary font-medium hover:underline">{t('auth.login_link')}</Link>
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
