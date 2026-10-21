import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { referralRpc } from '@/hooks/useReferralProgram';
import { normalizeReferralCode } from '@/lib/referrals';

type Check = { state: 'idle' | 'checking' | 'valid' | 'invalid' | 'limited' | 'unavailable'; name?: string };

/**
 * Optional "Referral code" on the consultant sign-up, prefilled from the link. The live check returns only valid/invalid
 * and the owner's masked public name (rate limited in the database).
 */
export default function ReferralCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const code = normalizeReferralCode(value);

  useEffect(() => {
    if (code.length < 4) { setCheck({ state: 'idle' }); return; }
    let live = true;
    setCheck({ state: 'checking' });
    const timer = setTimeout(async () => {
      const { data, error } = await referralRpc('referral_validate_code', { _code: code });
      if (!live) return;
      if (error) {
        setCheck({ state: /too many/i.test(error.message) ? 'limited' : 'unavailable' });
        return;
      }
      const o = (data ?? {}) as { valid?: boolean; name?: string };
      setCheck(o.valid ? { state: 'valid', name: o.name } : { state: 'invalid' });
    }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [code]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="signup-referral">{t('refz.signup_label', 'Referral code (optional)')}</Label>
      <Input
        id="signup-referral"
        dir="ltr"
        value={value}
        maxLength={24}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="SAP-NAME-7K2"
        className="font-mono"
        aria-describedby="signup-referral-status"
      />
      <p id="signup-referral-status" aria-live="polite" className="min-h-[1rem] text-xs">
        {check.state === 'checking' && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />{t('refz.checking', 'Checking...')}</span>}
        {check.state === 'valid' && (
          <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="w-3 h-3" />
            {t('refz.code_belongs', 'Code belongs to {{name}}', { name: check.name ?? '' })}
          </span>
        )}
        {check.state === 'invalid' && <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="w-3 h-3" />{t('refz.code_unknown', 'This code was not found. Check it or leave the field empty.')}</span>}
        {check.state === 'limited' && <span className="text-muted-foreground">{t('refz.code_limited', 'Too many checks. You can still sign up; the code is checked when your account is created.')}</span>}
      </p>
    </div>
  );
}
