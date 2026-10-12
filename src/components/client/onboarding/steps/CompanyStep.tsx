import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TaxonomySelect from '@/components/profile/TaxonomySelect';
import { CUSTOMER_SEGMENTS, LOCALIZATION_COUNTRIES } from '@/lib/profileTaxonomy';
import type { ClientOnboardingData } from '../ClientOnboarding';

const companySizes = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const industries = [
  'oil_gas', 'petrochemical', 'banking', 'telecom', 'healthcare',
  'retail', 'manufacturing', 'government', 'education', 'construction',
  'logistics', 'utilities', 'technology', 'other',
];

interface Props {
  data: ClientOnboardingData;
  onChange: (partial: Partial<ClientOnboardingData>) => void;
}

export default function CompanyStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="companyName">{t('client_onboarding.company_name')} *</Label>
        <Input
          id="companyName"
          value={data.companyName}
          onChange={e => onChange({ companyName: e.target.value })}
          placeholder={t('client_onboarding.company_name_placeholder')}
          maxLength={200}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t('client_onboarding.company_size')}</Label>
          <Select value={data.companySize} onValueChange={v => onChange({ companySize: v })}>
            <SelectTrigger><SelectValue placeholder={t('client_onboarding.select_size')} /></SelectTrigger>
            <SelectContent>
              {companySizes.map(s => (
                <SelectItem key={s} value={s}>{s} {t('client_onboarding.employees')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('client_onboarding.industry')}</Label>
          <Select value={data.industry} onValueChange={v => onChange({ industry: v })}>
            <SelectTrigger><SelectValue placeholder={t('client_onboarding.select_industry')} /></SelectTrigger>
            <SelectContent>
              {industries.map(ind => (
                <SelectItem key={ind} value={ind}>{t(`client_onboarding.industry_${ind}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="customerSegment">Customer segment</Label>
          <TaxonomySelect id="customerSegment" groups={CUSTOMER_SEGMENTS} value={data.customerSegment} onChange={v => onChange({ customerSegment: v })} noneLabel="Not specified" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="companyCountry">Country</Label>
          <TaxonomySelect id="companyCountry" groups={LOCALIZATION_COUNTRIES} value={data.country} onChange={v => onChange({ country: v })} noneLabel="Not specified" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sapLandscape">{t('client_onboarding.sap_landscape')}</Label>
        <Textarea
          id="sapLandscape"
          value={data.sapLandscape}
          onChange={e => onChange({ sapLandscape: e.target.value })}
          placeholder={t('client_onboarding.sap_landscape_placeholder')}
          rows={3}
          maxLength={500}
        />
      </div>
    </div>
  );
}
