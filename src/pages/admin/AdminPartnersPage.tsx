import { useTranslation } from 'react-i18next';
import PartnerCompaniesCard from '@/components/admin/users/PartnerCompaniesCard';

/** Admin menu entry for partner companies (same card as the Users → Partner companies tab). */
export default function AdminPartnersPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-foreground">{t('partner.admin_tab', 'Partner companies')}</h1>
        <p className="text-sm text-muted-foreground">{t('partner.admin_hint', 'Turn on only after you have checked the company. Partners can invite consultants and manage their availability.')}</p>
      </header>
      <PartnerCompaniesCard />
    </div>
  );
}
