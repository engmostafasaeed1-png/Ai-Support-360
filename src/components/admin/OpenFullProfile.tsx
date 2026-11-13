import { UserRoundSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { openAdminProfile, type AdminProfileTarget } from '@/lib/adminProfile';

export default function OpenFullProfile({ userId, consultantId, name, compact = false }: AdminProfileTarget & { name?: string; compact?: boolean }) {
  const { t } = useTranslation();
  if (!userId && !consultantId) return null;
  return <Button type="button" size={compact ? 'icon' : 'sm'} variant="ghost" className={compact ? 'h-8 w-8 shrink-0' : 'h-auto min-h-8 whitespace-normal text-start'} title={t('userFullProfile.open', 'Open full profile')} aria-label={name ? t('userFullProfile.openPerson', 'Open full profile: {{name}}', { name }) : t('userFullProfile.open', 'Open full profile')} onClick={e => { e.stopPropagation(); openAdminProfile({ userId, consultantId }); }}><UserRoundSearch className="h-4 w-4 shrink-0" />{!compact && <span className="ms-2">{name ?? t('userFullProfile.open', 'Open full profile')}</span>}</Button>;
}