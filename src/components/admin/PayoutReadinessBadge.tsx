import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/** Readiness metadata only; this component never receives bank identifiers. */
export default function PayoutReadinessBadge({ ready }: { ready: boolean }) {
  const { t } = useTranslation();
  return <Badge variant="outline" className={ready ? 'text-success border-success/30 text-[10px]' : 'text-destructive border-destructive/30 text-[10px]'}>
    {ready ? t('payout_readiness.ready', 'Payout details ready') : t('payout_readiness.missing', 'Payout details missing')}
  </Badge>;
}