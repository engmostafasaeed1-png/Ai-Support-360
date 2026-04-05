import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ClientOnboardingData } from '../ClientOnboarding';

const sapModules = [
  'SAP S/4HANA', 'SAP FI/CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP QM',
  'SAP PM/EAM', 'SAP PS', 'SAP EWM', 'SAP TM', 'SAP Ariba',
  'SuccessFactors', 'SAP BTP/CPI', 'SAP Fiori/UX', 'SAP Analytics Cloud',
  'SAP Basis', 'SAP Security/GRC', 'ABAP Development', 'Integrations/APIs',
  'Data Migration',
];

interface Props {
  data: ClientOnboardingData;
  onChange: (partial: Partial<ClientOnboardingData>) => void;
}

export default function SapModulesStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  const toggle = (mod: string) => {
    const mods = data.sapModules.includes(mod)
      ? data.sapModules.filter(m => m !== mod)
      : [...data.sapModules, mod];
    onChange({ sapModules: mods });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('client_onboarding.sap_modules_title')}</h3>
        <p className="text-xs text-muted-foreground">{t('client_onboarding.sap_modules_desc')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {sapModules.map(mod => (
          <button
            key={mod}
            onClick={() => toggle(mod)}
            className={cn(
              'px-3 py-2 rounded-lg text-xs font-medium border transition-all',
              data.sapModules.includes(mod)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:border-primary/50'
            )}
          >
            {mod}
          </button>
        ))}
      </div>

      {data.sapModules.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('client_onboarding.selected_count', { count: data.sapModules.length })}
        </p>
      )}
    </div>
  );
}
