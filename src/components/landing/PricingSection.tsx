import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Check, Sparkles } from 'lucide-react';
import SectionHeader from './SectionHeader';
import { useDemoWizard } from './DemoRequestWizard';

const plans = [
  {
    key: 'on_demand',
    price: '$99',
    priceKey: 'per_session',
    accent: 'from-cyan-500 to-blue-600',
    features: ['Single session booking', 'AI consultant matching', 'Chat & video support', 'Session recording', 'Invoice generation'],
    popular: false,
    ctaKey: 'get_started',
  },
  {
    key: 'professional',
    price: '$1,499',
    priceKey: 'per_month',
    accent: 'from-violet-500 to-purple-600',
    features: ['20 support hours/month', 'Dedicated consultant pool', 'Priority matching', 'SLA guarantees', 'Monthly analytics report', 'Knowledge base access'],
    popular: true,
    ctaKey: 'get_started',
  },
  {
    key: 'enterprise',
    price: null,
    priceKey: 'custom',
    accent: 'from-emerald-500 to-teal-600',
    features: ['Unlimited support hours', 'Dedicated support team', 'Custom SLA', 'Account manager', 'Full analytics suite', 'On-site support option', 'Custom integrations'],
    popular: false,
    ctaKey: 'contact_sales',
  },
];

export default function PricingSection() {
  const { t } = useTranslation();
  const demoWizard = useDemoWizard();

  return (
    <section id="pricing" className="relative py-24 md:py-32 bg-muted/30 overflow-hidden">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-primary/10 rounded-full blur-[160px] motion-safe:animate-mesh-shift" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow="Pricing"
          title={
            <>
              {t('pricing.title').split(' ').slice(0, -1).join(' ')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('pricing.title').split(' ').slice(-1)}
              </span>
            </>
          }
          subtitle={t('pricing.subtitle')}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 max-w-5xl mx-auto items-start">
          {plans.map((plan, i) => (
            <article
              key={plan.key}
              style={{ animationDelay: `${i * 100}ms` }}
              className={`group relative rounded-3xl p-7 md:p-8 flex flex-col motion-safe:transition-all motion-safe:duration-500 motion-safe:animate-fade-in-up ${
                plan.popular
                  ? 'bg-card border-2 border-primary shadow-2xl md:scale-105 ring-1 ring-primary/20'
                  : 'bg-card/80 backdrop-blur-sm border border-border/60 hover:border-primary/40 hover:-translate-y-1 hover:shadow-2xl'
              }`}
            >
              {plan.popular && (
                <>
                  {/* Glow */}
                  <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-primary/20 via-transparent to-accent/20 -z-10 blur-xl opacity-60" />
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 text-[11px] font-bold tracking-widest uppercase rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground flex items-center gap-1.5 shadow-lg">
                    <Sparkles size={12} strokeWidth={2.25} />
                    {t('pricing.popular')}
                  </span>
                </>
              )}

              {/* Accent dot */}
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${plan.accent} flex items-center justify-center shadow-lg mb-5 motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110`}>
                <Sparkles size={22} strokeWidth={1.75} absoluteStrokeWidth className="text-white" aria-hidden="true" />
              </div>

              <h3 className="text-xl font-black text-foreground tracking-tight">{t(`pricing.${plan.key}`)}</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-6 leading-relaxed">{t(`pricing.${plan.key}_desc`)}</p>

              <div className="mb-7 pb-7 border-b border-border/50">
                {plan.price ? (
                  <>
                    <span className="text-5xl font-black text-foreground tracking-tight">{plan.price}</span>
                    <span className="text-muted-foreground text-sm font-medium ms-1">{t(`pricing.${plan.priceKey}`)}</span>
                  </>
                ) : (
                  <span className="text-4xl font-black text-foreground tracking-tight">{t(`pricing.${plan.priceKey}`)}</span>
                )}
              </div>

              <ul className="space-y-3.5 mb-8 flex-1">
                {plan.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-3 text-sm text-foreground/85">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 ring-1 ring-primary/20">
                      <Check size={12} strokeWidth={3} className="text-primary" aria-hidden="true" />
                    </div>
                    <span className="leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                className={`rounded-2xl h-12 font-semibold ${plan.popular ? 'bg-gradient-to-r from-primary to-accent hover:opacity-95 border-0 shadow-lg' : ''}`}
                variant={plan.popular ? 'default' : 'outline'}
                size="lg"
                onClick={() => demoWizard.open(plan.ctaKey === 'contact_sales' ? 'pricing-roi' : 'live', { source: `pricing-${plan.ctaKey ?? 'plan'}` })}
              >
                {t(`pricing.${plan.ctaKey}`)}
              </Button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
