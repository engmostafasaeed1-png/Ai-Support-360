import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

type Step = 'loading' | 'ok' | 'enroll' | 'verify';

/**
 * Enforces the admin switch require_2fa: when on, every signed-in user must use an
 * authenticator app code before the portal opens. When off, children render directly.
 */
export default function TwoFactorGate({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<Step>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const { data: setting } = await supabase
      .from('platform_settings').select('value').eq('key', 'require_2fa').maybeSingle();
    const required = setting?.value === true || setting?.value === 'true';
    if (!required) return setStep('ok');

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') return setStep('ok');

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find((f) => f.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      return setStep('verify');
    }
    // remove half-finished enrolments so a new one can start
    for (const f of factors?.all ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `AI Support 360 ${Date.now()}` });
    if (error || !data) {
      toast.error(error?.message ?? 'Could not start two-step sign-in');
      return setStep('enroll');
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStep('enroll');
  }, []);

  useEffect(() => { void check(); }, [check]);

  const submit = async () => {
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) return toast.error('That code is not right. Try the newest code.');
    setStep('ok');
  };

  if (step === 'ok') return <>{children}</>;
  if (step === 'loading') {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Two-step sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'enroll' ? (
            <>
              <p className="text-sm text-muted-foreground">Your administrator requires two-step sign-in. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator…), then type the 6-digit code.</p>
              {qr && <img src={qr} alt="Authenticator QR code" className="mx-auto w-44 h-44 bg-card rounded-lg" />}
              {secret && <p className="text-xs text-center font-mono break-all text-muted-foreground">{secret}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Type the 6-digit code from your authenticator app.</p>
          )}
          <Input inputMode="numeric" maxLength={6} value={code} placeholder="123456"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && void submit()} aria-label="6-digit code" />
          <Button className="w-full" disabled={busy || code.length !== 6} onClick={() => void submit()}>
            {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />} Continue
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => void supabase.auth.signOut()}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
