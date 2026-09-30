import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import PasswordInput from '@/components/auth/PasswordInput';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map Supabase auth error codes / messages to user-friendly i18n strings
  const mapResetError = (opts: {
    code?: string | null;
    errorName?: string | null;
    description?: string | null;
    status?: number | null;
  }): string => {
    const code = (opts.code || '').toLowerCase();
    const name = (opts.errorName || '').toLowerCase();
    const desc = (opts.description || '').toLowerCase();
    const status = opts.status ?? null;

    // Expired link (Supabase: otp_expired / "Email link is invalid or has expired")
    if (
      code === 'otp_expired' ||
      code === 'token_expired' ||
      desc.includes('expired') ||
      desc.includes('has expired')
    ) {
      return t(
        'auth.reset_link_expired',
        'This password reset link has expired. Please request a new one.'
      );
    }

    // Already used / consumed
    if (code === 'otp_used' || desc.includes('already been used') || desc.includes('already used')) {
      return t(
        'auth.reset_link_used',
        'This reset link has already been used. Please request a new one.'
      );
    }

    // Invalid / malformed token (Supabase often returns 401/403 + access_denied)
    if (
      code === 'invalid_token' ||
      code === 'bad_jwt' ||
      code === 'invalid_request' ||
      name === 'access_denied' ||
      desc.includes('invalid') ||
      desc.includes('not found') ||
      status === 401 ||
      status === 403
    ) {
      return t(
        'auth.reset_link_invalid',
        'This password reset link is invalid. Please request a new one.'
      );
    }

    // Rate limited
    if (code === 'over_email_send_rate_limit' || status === 429 || desc.includes('rate limit')) {
      return t(
        'auth.reset_rate_limited',
        'Too many attempts. Please wait a moment and try again.'
      );
    }

    // Server error
    if (status && status >= 500) {
      return t(
        'auth.reset_server_error',
        'We could not verify your reset link due to a server error. Please try again.'
      );
    }

    return (
      opts.description ||
      t('auth.reset_link_invalid', 'This password reset link is invalid or has expired. Please request a new one.')
    );
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });

    (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = window.location.hash || '';
        const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

        // 0) Detect Supabase error in URL early (hash or query)
        const urlErrorCode =
          hashParams.get('error_code') || url.searchParams.get('error_code');
        const urlErrorName =
          hashParams.get('error') || url.searchParams.get('error');
        const urlErrorDesc =
          hashParams.get('error_description') || url.searchParams.get('error_description');

        if (urlErrorCode || urlErrorName || urlErrorDesc) {
          if (mounted) {
            setError(
              mapResetError({
                code: urlErrorCode,
                errorName: urlErrorName,
                description: urlErrorDesc ? decodeURIComponent(urlErrorDesc.replace(/\+/g, ' ')) : null,
              })
            );
          }
          return;
        }

        // 1) New PKCE flow: ?code=...
        const code = url.searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (mounted) setReady(true);
          window.history.replaceState({}, '', url.pathname);
          return;
        }

        // 2) Legacy implicit flow: #access_token=...&type=recovery
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        if (accessToken && refreshToken && type === 'recovery') {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
          if (mounted) setReady(true);
          window.history.replaceState({}, '', url.pathname);
          return;
        }

        // 3) Already in a recovery session?
        const { data: { session } } = await supabase.auth.getSession();
        if (session && mounted) {
          setReady(true);
          return;
        }

        // 4) No valid token at all
        if (mounted) {
          setError(
            t('auth.reset_link_missing', 'No reset link detected. Please request a new password reset email.')
          );
        }
      } catch (e: any) {
        if (mounted) {
          setError(
            mapResetError({
              code: e?.code ?? e?.error_code ?? null,
              errorName: e?.name ?? null,
              description: e?.message ?? null,
              status: e?.status ?? null,
            })
          );
        }
      }
    })();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [t]);


  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error(t('auth.password_min')); return; }
    if (password !== confirm) { toast.error(t('auth.password_mismatch')); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('auth.password_updated'));
    navigate('/login');
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative">
        <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
        <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95">
          <CardContent className="py-12 text-center space-y-3">
            {error ? (
              <>
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  asChild
                  className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02] mt-2"
                >
                  <Link to="/forgot-password">
                    {t('auth.request_new_link', 'Request a new reset link')}
                  </Link>
                </Button>
                <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground inline-block mt-2">
                  {t('auth.back_to_login', 'Back to sign in')}
                </Link>
              </>
            ) : (
              <>
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t('auth.verifying_link')}</p>
              </>
            )}
          </CardContent>
        </Card>
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
          <h1 className="font-semibold leading-none tracking-tight text-2xl">{t('auth.reset_title')}</h1>
          <CardDescription>{t('auth.reset_desc')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleReset}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.new_password')}</Label>
              <PasswordInput id="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">{t('auth.confirm_password')}</Label>
              <PasswordInput id="confirm" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.reset_btn')}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
