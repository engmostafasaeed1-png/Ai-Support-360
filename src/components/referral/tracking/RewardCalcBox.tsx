import { useTranslation } from 'react-i18next';
import { Calculator } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatRate, MAN_DAY_HOURS, rewardForFee, round2, tierFor, type Tier } from '@/lib/referrals';

interface Props {
  tiers: Tier[];
  tierCount: number;
  /** The consultant's own approved hourly rate, else the platform average; null = a plain $50 example. */
  ownRate: number | null;
  platformRate: number | null;
  money: (v: number) => string;
  onSimulator: () => void;
}

/** "How your reward is calculated": the formula and one worked example at the consultant's current tier rate. */
export default function RewardCalcBox({ tiers, tierCount, ownRate, platformRate, money, onSimulator }: Props) {
  const { t } = useTranslation();
  const tier = tierFor(tierCount, tiers);
  const hourly = ownRate ?? platformRate ?? 50;
  const basis = ownRate != null ? 'own' : platformRate != null ? 'platform' : 'example';
  const fee = round2(hourly * MAN_DAY_HOURS);
  const reward = rewardForFee(fee, tier.rate);
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4 text-primary" aria-hidden="true" />{t('reft.calc_title', 'How your reward is calculated')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="rounded-xl bg-primary/5 p-3 font-medium" dir="auto">
          {t('reft.calc_formula', 'Reward = approved hours x approved hourly rate (= the fee) x your tier rate ({{rate}} %).', { rate: formatRate(tier.rate) })}
        </p>
        <ol className="space-y-1 text-muted-foreground">
          <li>{t('reft.calc_step1', '1. One man-day = {{h}} approved hours at {{hourly}} per hour', { h: MAN_DAY_HOURS, hourly: money(hourly) })}</li>
          <li>{t('reft.calc_step2', '2. Fee = {{h}} x {{hourly}} = {{fee}}', { h: MAN_DAY_HOURS, hourly: money(hourly), fee: money(fee) })}</li>
          <li className="font-semibold text-foreground">{t('reft.calc_step3', '3. Your reward = {{fee}} x {{rate}} % = {{reward}}', { fee: money(fee), rate: formatRate(tier.rate), reward: money(reward) })}</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          {basis === 'own' ? t('reft.calc_basis_own', 'Example uses your own approved hourly rate; your colleague\'s real rate decides the real fee.')
            : basis === 'platform' ? t('reft.calc_basis_platform', 'Example uses the platform average hourly rate.')
            : t('reft.calc_basis_example', 'Example rate only.')}{' '}
          {t('reft.calc_paid_by', 'Paid by AI Support 360, never taken from your colleague.')}
        </p>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={onSimulator}>{t('reft.calc_try', 'Try your own numbers in the simulator')}</Button>
      </CardContent>
    </Card>
  );
}
