import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { acceptReferralTerms, rpcMessage, useReferralTerms } from '@/hooks/useReferralProgram';

interface Props {
  version: number;
  /** Rate or tier range, e.g. "0.5-1". */
  rateText: string;
  months: number;
  passMark: number;
  source: 'page' | 'share' | 'popup';
  onDone: () => void;
}

/**
 * The referral acknowledgement (both sides). Plain-language summary + the stored versioned text; saving is append-only
 * in the database with time, language, browser and a hashed network address. No acknowledgement = no activation.
 */
export default function ReferralAckPanel({ version, rateText, months, passMark, source, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'ar' = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const terms = useReferralTerms(version);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    const { error } = await acceptReferralTerms(version, source, lang);
    setBusy(false);
    if (error) { toast.error(rpcMessage(error, t('refz.terms_failed', 'Your acceptance could not be saved. Please try again.'))); return; }
    toast.success(t('refz.terms_saved', 'Thank you. Your acceptance is saved.'));
    onDone();
  };
  const text = terms.data ? (lang === 'ar' ? terms.data.body_ar : terms.data.body_en) : null;
  return (
    <div className="space-y-3 text-sm">
      <ul className="list-disc ps-5 space-y-1 text-muted-foreground">
        <li>{t('refz.ack_1', 'The referral becomes active only when BOTH of you have passed the AI interview (score at least {{pass}}) and both accepted these terms.', { pass: passMark })}</li>
        <li>{t('refz.ack_2', 'The AI interview must be taken honestly, by you alone, without outside help.')}</li>
        <li>{t('refz.ack_3', 'The referrer earns {{rate}} % of the referred consultant\'s fee (by tier: the rate rises with the number of verified consultants the referrer brought, and each reward keeps the rate of the moment it is created) for {{months}} months from their first paid ticket, only on work invoiced after activation. It is paid by AI Support 360, never deducted from anyone.', { rate: rateText, months })}</li>
        <li>{t('refz.ack_4', 'AI Support 360 may review, hold, reverse or forfeit rewards in case of fraud, self-referral, shared accounts or a dishonest interview.')}</li>
        <li>{t('refz.ack_5', 'Rewards are a referral incentive, not wages or salary, and may be taxable.')}</li>
      </ul>
      {text && (
        <details className="rounded-xl border border-border/60 p-3">
          <summary className="cursor-pointer text-xs font-medium">{t('refz.ack_full', 'Full text (version {{v}})', { v: version })}</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>{text}</p>
        </details>
      )}
      <div className="flex items-start gap-2">
        <Checkbox id={`refz-ack-${source}`} checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
        <Label htmlFor={`refz-ack-${source}`} className="leading-snug font-normal">
          {t('refz.terms_accept', 'I have read and accept the')}{' '}
          <Link to="/referral-terms" target="_blank" rel="noopener" className="text-primary underline">{t('refz.terms_link', 'referral programme terms')}</Link>.
        </Label>
      </div>
      <Button onClick={accept} disabled={!agreed || busy} className="rounded-xl">
        {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}{t('refz.terms_continue', 'Accept and continue')}
      </Button>
    </div>
  );
}
