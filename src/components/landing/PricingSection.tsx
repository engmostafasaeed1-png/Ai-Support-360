import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

const plans = [
  {
    key: 'on_demand',
    price: '$99',
    priceKey: 'per_session',
    features: ['Single session booking', 'AI consultant matching', 'Chat & video support', 'Session recording', 'Invoice generation'],
    popular: false,
    ctaKey: 'get_started',
  },
  {
    key: 'professional',
    price: '$1,499',
    priceKey: 'per_month',
    features: ['20 support hours/month', 'Dedicated consultant pool', 'Priority matching', 'SLA guarantees', 'Monthly analytics report', 'Knowledge base access'],
    popular: true,
    ctaKey: 'get_started',
  },
  {
    key: 'enterprise',
    price: null,
    priceKey: 'custom',
    features: ['Unlimited support hours', 'Dedicated support team', 'Custom SLA', 'Account manager', 'Full analytics suite', 'On-site support option', 'Custom integrations'],
    popular: false,
    ctaKey: 'contact_sales',
  },
];

export default function PricingSection() {
  const { t } = useTranslation();

  return (
    <section id="pricing" className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('pricing.title')}</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">{t('pricing.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.key}
              className={`rounded-2xl p-8 flex flex-col relative ${
                plan.popular
                  ? 'bg-card border-2 border-accent shadow-premium'
                  : 'bg-card border border-border/50'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-semibold rounded-full gradient-primary text-primary-foreground">
                  {t('pricing.popular')}
                </span>
              )}

              <h3 className="text-xl font-bold text-foreground">{t(`pricing.${plan.key}`)}</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6">{t(`pricing.${plan.key}_desc`)}</p>

              <div className="mb-6">
                {plan.price ? (
                  <>
                    <span className="text-4xl font-extrabold text-foreground">{plan.price}</span>
                    <span className="text-muted-foreground text-sm">{t(`pricing.${plan.priceKey}`)}</span>
                  </>
                ) : (
                  <span className="text-4xl font-extrabold text-foreground">{t(`pricing.${plan.priceKey}`)}</span>
                )}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                className={plan.popular ? 'gradient-primary border-0 w-full' : 'w-full'}
                variant={plan.popular ? 'default' : 'outline'}
              >
                {t(`pricing.${plan.ctaKey}`)}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
