import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { ClientOnboardingData } from '../ClientOnboarding';

interface Props {
  data: ClientOnboardingData;
}

export default function ReviewStep({ data }: Props) {
  const { t } = useTranslation();

  const field = (label: string, value: string | undefined) => (
    <div className="p-3 rounded-lg bg-muted/30">
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium">{value || '—'}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">{t('client_onboarding.review_title')}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field(t('client_onboarding.company_name'), data.companyName)}
        {field(t('client_onboarding.company_size'), data.companySize ? `${data.companySize} ${t('client_onboarding.employees')}` : undefined)}
        {field(t('client_onboarding.industry'), data.industry ? t(`client_onboarding.industry_${data.industry}`) : undefined)}
        {field(t('client_onboarding.phone'), data.phone)}
        {field(t('onboarding.timezone'), data.timezone)}
        {field(t('client_onboarding.communication_preference'), data.communicationPreference ? t(`client_onboarding.comm_${data.communicationPreference}`) : undefined)}
      </div>

      {data.sapLandscape && (
        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-[10px] text-muted-foreground mb-0.5">{t('client_onboarding.sap_landscape')}</p>
          <p className="text-sm">{data.sapLandscape}</p>
        </div>
      )}

      <div className="p-3 rounded-lg bg-muted/30">
        <p className="text-[10px] text-muted-foreground mb-1.5">{t('client_onboarding.sap_modules_title')}</p>
        <div className="flex flex-wrap gap-1.5">
          {data.sapModules.length > 0 ? data.sapModules.map(m => (
            <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
          )) : <span className="text-sm text-muted-foreground">—</span>}
        </div>
      </div>
    </div>
  );
}
