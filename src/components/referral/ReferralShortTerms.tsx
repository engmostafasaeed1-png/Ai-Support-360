import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/** Short version of the referral programme terms (draft for the lawyer); the full text is on /referral-terms. */
export default function ReferralShortTerms({ holdDays = 14, minInvoice = 20 }: { holdDays?: number; minInvoice?: number }) {
  const { t } = useTranslation();
  const items = [
    t('refz.st_1', 'Rewards come only from client payments that have cleared and payouts that were released, on invoice lines of at least {{min}}.', { min: minInvoice }),
    t('refz.st_2', 'Each reward stays pending for a {{days}}-day review period to cover refunds and chargebacks.', { days: holdDays }),
    t('refz.st_3', 'Refunds and chargebacks reverse the reward; disputes and rewards above the monthly limits are held for review.'),
    t('refz.st_4', 'Self-referrals, related or fake accounts and work for a related client are not allowed. In case of fraud AI Support 360 may hold, reverse, cancel or forfeit rewards and remove the referral.'),
    t('refz.st_5', 'Rewards are a referral incentive paid by AI Support 360, not wages or salary, and may be taxable.'),
  ];
  return (
    <section aria-labelledby="refz-short-terms" className="rounded-xl border border-border/60 p-4 space-y-2 text-sm">
      <h3 id="refz-short-terms" className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('refz.st_title', 'The rules in short')}
        <Badge variant="outline" className="text-[10px]">{t('refz.draft', 'Draft')}</Badge>
      </h3>
      <ul className="list-disc ps-5 space-y-1 text-muted-foreground">{items.map((x) => <li key={x}>{x}</li>)}</ul>
      <Link to="/referral-terms" className="text-primary underline text-xs">{t('refz.st_full', 'Read the full referral programme terms')}</Link>
    </section>
  );
}
