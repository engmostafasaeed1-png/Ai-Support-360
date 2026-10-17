import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Landmark } from 'lucide-react';
import { useMyPayoutDetails } from '@/hooks/useBilling';
import { payoutReady } from '@/lib/payoutDisclaimer';
import { useTranslation } from 'react-i18next';

/** Next step on the dashboard while the bank details are missing or the disclaimer is not accepted. */
export default function PayoutDetailsNudge() {
  const { t } = useTranslation();
  const { data, isLoading } = useMyPayoutDetails();
  if (isLoading || !data || payoutReady(data.details)) return null;
  return (
    <Card className="rounded-2xl border-border/50" role="status">
      <CardContent className="p-4 flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Landmark className="w-5 h-5" />
        </div>
        <p className="flex-1 min-w-0 text-sm font-medium text-foreground">{t('payout_readiness.reminder', 'Add your payout details to receive your fees - takes 1 minute')}</p>
        <Button asChild size="sm">
          <Link to="/consultant/profile#payout-details">{t('payout_readiness.details', 'Payout details')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
