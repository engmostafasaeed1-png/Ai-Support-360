import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Users, Briefcase, Eye } from 'lucide-react';
import PasswordInput from '@/components/auth/PasswordInput';
import PasswordStrength from '@/components/auth/PasswordStrength';
import { cn } from '@/lib/utils';
import GuestExploreModal from '@/components/guest/GuestExploreModal';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';

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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(t('auth.password_min'));
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name, role, ...(referralCode ? { referral_code: referralCode } : {}) } },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.user && !data.session) {
      toast.success(t('auth.check_email'));
      navigate('/login');
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
        const { data: tenantData } = await supabase
          .from('tenants')
          .insert({ name: name + "'s Organization", slug })
          .select('id')
          .single();
        if (tenantData) {
          await supabase.from('tenant_members').insert({
            tenant_id: tenantData.id,
            user_id: data.user.id,
            org_role: 'owner' as any,
          });
        }
        await supabase.from('client_profiles').insert({ user_id: data.user.id });
        navigate('/client');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative py-8">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4 group">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-premium group-hover:scale-110 transition-transform">
              <span className="text-sm font-bold text-primary-foreground">Q</span>
            </div>
            <span className="font-bold text-xl text-foreground">Qurtuba</span>
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
