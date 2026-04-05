import { useTranslation } from 'react-i18next';
import { Fuel, Landmark, ShoppingBag, Heart, Factory, Building2, Radio, Truck } from 'lucide-react';

const industryIcons = [Fuel, Landmark, ShoppingBag, Heart, Factory, Building2, Radio, Truck];
const industryKeys = ['oil', 'banking', 'retail', 'healthcare', 'manufacturing', 'government', 'telecom', 'logistics'];

export default function IndustriesSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('industries.title')}</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">{t('industries.subtitle')}</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
          {industryKeys.map((key, i) => {
            const Icon = industryIcons[i];
            return (
              <div key={key} className="text-center p-6 rounded-2xl bg-card border border-border/50 hover:shadow-premium transition-all group">
                <div className="w-14 h-14 rounded-2xl bg-primary/5 group-hover:bg-accent/10 flex items-center justify-center mx-auto mb-3 transition-colors">
                  <Icon className="w-7 h-7 text-primary group-hover:text-accent transition-colors" />
                </div>
                <span className="text-sm font-medium text-foreground">{t(`industries.${key}`)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
