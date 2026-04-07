import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Check, Sparkles } from 'lucide-react';

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
    <section id="pricing" className="py-28 bg-muted/30 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.03),transparent_50%)]" />
      <div className="container mx-auto px-4 relative">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/5 text-primary text-xs font-bold tracking-widest uppercase mb-4">
            Pricing
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('pricing.title')}</h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-base md:text-lg">{t('pricing.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto items-start">
          {plans.map((plan) => (
            <div
              key={plan.key}
              className={`rounded-3xl p-8 flex flex-col relative transition-all duration-300 ${
                plan.popular
                  ? 'bg-card border-2 border-primary shadow-2xl scale-[1.03] md:scale-105'
                  : 'bg-card border border-border/40 hover:shadow-lg hover:border-primary/15'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-5 py-1.5 text-xs font-bold rounded-full gradient-primary text-primary-foreground flex items-center gap-1.5 shadow-lg">
                  <Sparkles className="w-3 h-3" />
                  {t('pricing.popular')}
                </span>
              )}

              <h3 className="text-xl font-black text-foreground">{t(`pricing.${plan.key}`)}</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-8">{t(`pricing.${plan.key}_desc`)}</p>

              <div className="mb-8">
                {plan.price ? (
                  <>
                    <span className="text-5xl font-black text-foreground tracking-tight">{plan.price}</span>
                    <span className="text-muted-foreground text-sm font-medium">{t(`pricing.${plan.priceKey}`)}</span>
                  </>
                ) : (
                  <span className="text-5xl font-black text-foreground tracking-tight">{t(`pricing.${plan.priceKey}`)}</span>
                )}
              </div>

              <ul className="space-y-3.5 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-primary" />
                    </div>
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                className={`rounded-2xl h-12 font-semibold ${plan.popular ? 'gradient-primary border-0 shadow-lg' : ''}`}
                variant={plan.popular ? 'default' : 'outline'}
                size="lg"
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
