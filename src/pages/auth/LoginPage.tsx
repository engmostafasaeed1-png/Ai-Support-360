import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Redirect to original page or role-based default
    if (from) {
      navigate(from);
      return;
    }
    const { data: roles } = await supabase.from('user_roles').select('role').limit(1);
    const role = roles?.[0]?.role;
    if (role === 'consultant') navigate('/consultant');
    else if (role === 'admin') navigate('/admin');
    else navigate('/client');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground">Q</span>
            </div>
            <span className="font-bold text-lg text-foreground">Qurtuba</span>
          </Link>
          <CardTitle>{t('auth.login_title')}</CardTitle>
          <CardDescription>{t('auth.login_desc')}</CardDescription>
        </CardHeader>
        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full gradient-primary border-0" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('auth.login_btn')}
            </Button>
            <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">
              {t('auth.forgot_link')}
            </Link>
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
