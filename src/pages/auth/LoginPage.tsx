import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import GuestExploreModal from '@/components/guest/GuestExploreModal';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Eye } from 'lucide-react';
import PasswordInput from '@/components/auth/PasswordInput';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  // If user is already logged in, redirect them away from login page
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (from) {
          navigate(from, { replace: true });
          return;
        }
        const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).limit(1);
        const role = roles?.[0]?.role;
        if (role === 'consultant') navigate('/consultant', { replace: true });
        else if (role === 'admin') navigate('/admin', { replace: true });
        else navigate('/client', { replace: true });
      } else {
        setChecking(false);
      }
    };
    checkSession();
  }, [navigate, from]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (from) {
      navigate(from);
      return;
    }
    const { data: roles } = await supabase.from('user_roles').select('role').limit(1);
    const role = roles?.[0]?.role;
    if (role === 'consultant') navigate('/consultant');
    else if (role === 'admin') navigate('/admin');
    else navigate('/client/companies');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4 group">
            <img src="/assets/logo.png" alt="AI SAP Support Hub" className="w-9 h-9 rounded-xl object-contain shadow-sm group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xl text-foreground">AI SAP Support Hub</span>
          </Link>
          <CardTitle className="text-2xl">{t('auth.login_title')}</CardTitle>
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
            <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.login_btn')}
            </Button>
            <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('auth.forgot_link')}
            </Link>
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
