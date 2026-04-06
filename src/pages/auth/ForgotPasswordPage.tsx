import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import VideoBackground from '@/components/VideoBackground';
import authBgAsset from '@/assets/videos/auth-bg.mp4.asset.json';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      <VideoBackground src={authBgAsset.url} overlay="light" overlayOpacity={0.88} />
      <Card className="w-full max-w-md relative z-10 shadow-2xl border-border/30 backdrop-blur-sm bg-card/95 animate-fade-in">
        <CardHeader className="text-center">
          <Link to="/" className="inline-flex items-center gap-2 justify-center mb-4 group">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-premium group-hover:scale-110 transition-transform">
              <span className="text-sm font-bold text-primary-foreground">Q</span>
            </div>
            <span className="font-bold text-xl text-foreground">Qurtuba</span>
          </Link>
          <CardTitle className="text-2xl">{t('auth.forgot_title')}</CardTitle>
          <CardDescription>{t('auth.forgot_desc')}</CardDescription>
        </CardHeader>
        {sent ? (
          <CardContent className="text-center space-y-4 pb-8">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto">
              <MailCheck className="w-7 h-7 text-accent" />
            </div>
            <p className="text-sm text-muted-foreground">{t('auth.forgot_sent')}</p>
            <Link to="/login">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 me-2" />
                {t('auth.back_to_login')}
              </Button>
            </Link>
          </CardContent>
        ) : (
          <form onSubmit={handleReset}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className="h-11 rounded-xl" />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full gradient-primary border-0 h-11 text-base shadow-premium hover:shadow-xl transition-all hover:scale-[1.02]" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                {t('auth.forgot_btn')}
              </Button>
              <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <ArrowLeft className="w-3 h-3" />
                {t('auth.back_to_login')}
              </Link>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
