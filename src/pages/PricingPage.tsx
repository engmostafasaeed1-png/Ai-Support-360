import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Zap, Shield, Users, HeadphonesIcon, ArrowRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const plans = [
  {
    key: 'on_demand',
    price: { monthly: 99, annual: 89 },
    unit: 'session',
    features: [
      { text: 'Single session booking', included: true },
      { text: 'AI consultant matching', included: true },
      { text: 'Chat & video support', included: true },
      { text: 'Session recording', included: true },
      { text: 'Invoice generation', included: true },
      { text: 'Dedicated consultant pool', included: false },
      { text: 'SLA guarantees', included: false },
      { text: 'Monthly analytics report', included: false },
      { text: 'Account manager', included: false },
      { text: 'Custom integrations', included: false },
    ],
    icon: Zap,
    popular: false,
    cta: 'Get Started',
  },
  {
    key: 'professional',
    price: { monthly: 1499, annual: 1299 },
    unit: 'month',
    features: [
      { text: '20 support hours/month', included: true },
      { text: 'AI consultant matching', included: true },
      { text: 'Chat & video support', included: true },
      { text: 'Session recording', included: true },
      { text: 'Invoice generation', included: true },
      { text: 'Dedicated consultant pool', included: true },
      { text: 'SLA guarantees', included: true },
      { text: 'Monthly analytics report', included: true },
      { text: 'Account manager', included: false },
      { text: 'Custom integrations', included: false },
    ],
    icon: Shield,
    popular: true,
    cta: 'Get Started',
  },
  {
    key: 'enterprise',
    price: null,
    unit: 'custom',
    features: [
      { text: 'Unlimited support hours', included: true },
      { text: 'AI consultant matching', included: true },
      { text: 'Chat & video support', included: true },
      { text: 'Session recording', included: true },
      { text: 'Invoice generation', included: true },
      { text: 'Dedicated support team', included: true },
      { text: 'Custom SLA', included: true },
      { text: 'Full analytics suite', included: true },
      { text: 'Account manager', included: true },
      { text: 'Custom integrations', included: true },
    ],
    icon: Users,
    popular: false,
    cta: 'Contact Sales',
  },
];

const addOns = [
  { name: 'Additional Support Hours', price: '$85/hr', desc: 'Extra hours beyond your plan allocation' },
  { name: 'On-Site Support', price: '$2,500/day', desc: 'In-person consultant visits to your office' },
  { name: 'Emergency Support (24/7)', price: '$199/incident', desc: 'Critical issue resolution outside business hours' },
  { name: 'Knowledge Base Access', price: '$49/month', desc: 'Full access to SAP knowledge articles & guides' },
  { name: 'AI Transcript & Summary', price: '$29/month', desc: 'AI-powered session transcription and summaries' },
  { name: 'Custom Training Sessions', price: '$599/session', desc: 'Personalized SAP training for your team' },
];

const faqs = [
  { q: 'Can I switch plans at any time?', a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.' },
  { q: 'What happens if I exceed my hours?', a: 'Additional hours are billed at $85/hr for Professional plans. Enterprise clients have custom arrangements.' },
  { q: 'Is there a minimum commitment?', a: 'On-Demand has no commitment. Professional plans have a 3-month minimum. Enterprise plans are custom.' },
  { q: 'Do you offer a free trial?', a: 'We offer a complimentary discovery session so you can experience the platform before committing.' },
  { q: 'How does billing work?', a: 'Monthly plans are billed at the start of each period. Annual plans are billed upfront with a discount. All prices exclude VAT.' },
];

export default function PricingPage() {
  const { t } = useTranslation();

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'AI SAP Support Now — SAP Support Plans',
    description:
      'AI-powered enterprise SAP support: pay-per-session, monthly retainer, and enterprise managed support plans with verified SAP experts.',
    brand: { '@type': 'Brand', name: 'AI SAP Support Now' },
    offers: [
      {
        '@type': 'Offer',
        name: 'On-Demand',
        price: '99',
        priceCurrency: 'USD',
        description: 'Pay per session for ad-hoc SAP support.',
        availability: 'https://schema.org/InStock',
        url: 'https://www.aisapsupportnow.com/pricing',
      },
      {
        '@type': 'Offer',
        name: 'Professional',
        price: '1499',
        priceCurrency: 'USD',
        description: 'Monthly retainer with 20 support hours, SLA guarantees, and a dedicated consultant pool.',
        availability: 'https://schema.org/InStock',
        url: 'https://www.aisapsupportnow.com/pricing',
      },
    ],
  };

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
        <script type="application/ld+json">{JSON.stringify(productJsonLd)}</script>
      </Helmet>
      <Navbar />

      {/* Hero */}
      <section className="pt-28 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5">
            <HeadphonesIcon className="w-3.5 h-3.5 me-1.5" />
            Transparent Pricing
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Choose Your Support Plan
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Flexible pricing designed for every enterprise need — from ad-hoc sessions to full managed support.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <Tabs defaultValue="monthly" className="w-full">
            <div className="flex justify-center mb-10">
              <TabsList className="bg-muted/50">
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="annual">
                  Annual
                  <Badge variant="default" className="ms-2 text-[10px] px-1.5 py-0">Save 13%</Badge>
                </TabsTrigger>
              </TabsList>
            </div>

            {(['monthly', 'annual'] as const).map((billing) => (
              <TabsContent key={billing} value={billing}>
                <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                  {plans.map((plan) => (
                    <div
                      key={plan.key}
                      className={`rounded-2xl p-8 flex flex-col relative transition-shadow hover:shadow-lg ${
                        plan.popular
                          ? 'bg-card border-2 border-accent shadow-premium'
                          : 'bg-card border border-border/50'
                      }`}
                    >
                      {plan.popular && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-semibold rounded-full gradient-primary text-primary-foreground">
                          Most Popular
                        </span>
                      )}

                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${plan.popular ? 'gradient-primary' : 'bg-muted'}`}>
                          <plan.icon className={`w-5 h-5 ${plan.popular ? 'text-primary-foreground' : 'text-muted-foreground'}`} />
                        </div>
                        <h3 className="text-xl font-bold text-foreground">{t(`pricing.${plan.key}`)}</h3>
                      </div>

                      <p className="text-sm text-muted-foreground mb-6">{t(`pricing.${plan.key}_desc`)}</p>

                      <div className="mb-8">
                        {plan.price ? (
                          <>
                            <span className="text-4xl font-extrabold text-foreground">
                              ${plan.price[billing].toLocaleString()}
                            </span>
                            <span className="text-muted-foreground text-sm">/{plan.unit}</span>
                            {billing === 'annual' && (
                              <p className="text-xs text-accent mt-1">
                                Save ${((plan.price.monthly - plan.price.annual) * 12).toLocaleString()}/year
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-4xl font-extrabold text-foreground">Custom</span>
                        )}
                      </div>

                      <ul className="space-y-3 mb-8 flex-1">
                        {plan.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-sm">
                            {f.included ? (
                              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                            ) : (
                              <X className="w-4 h-4 text-muted-foreground/40 mt-0.5 shrink-0" />
                            )}
                            <span className={f.included ? 'text-foreground' : 'text-muted-foreground/50'}>
                              {f.text}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <Button
                        className={plan.popular ? 'gradient-primary border-0 w-full' : 'w-full'}
                        variant={plan.popular ? 'default' : 'outline'}
                        size="lg"
                      >
                        {plan.cta}
                        <ArrowRight className="w-4 h-4 ms-1" />
                      </Button>
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </section>

      {/* Add-Ons */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">Add-On Services</h2>
            <p className="text-muted-foreground mt-2">Enhance your plan with additional capabilities</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {addOns.map((addon) => (
              <div key={addon.name} className="bg-card rounded-xl border border-border/50 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-foreground text-sm">{addon.name}</h4>
                  <span className="text-accent font-bold text-sm whitespace-nowrap ms-2">{addon.price}</span>
                </div>
                <p className="text-xs text-muted-foreground">{addon.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">Detailed Comparison</h2>
            <p className="text-muted-foreground mt-2">See exactly what's included in each plan</p>
          </div>
          <div className="max-w-4xl mx-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start py-3 px-4 text-muted-foreground font-medium">Feature</th>
                  <th className="text-center py-3 px-4 font-semibold text-foreground">On-Demand</th>
                  <th className="text-center py-3 px-4 font-semibold text-accent">Professional</th>
                  <th className="text-center py-3 px-4 font-semibold text-foreground">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[
                  ['Support Hours', 'Per session', '20 hrs/mo', 'Unlimited'],
                  ['AI Matching', '✓', '✓', '✓'],
                  ['Chat Support', '✓', '✓', '✓'],
                  ['Video Calls', '✓', '✓', '✓'],
                  ['Screen Sharing', '✓', '✓', '✓'],
                  ['Session Recording', '✓', '✓', '✓'],
                  ['Dedicated Pool', '—', '✓', '✓'],
                  ['SLA Guarantees', '—', '4hr response', 'Custom SLA'],
                  ['Analytics', 'Basic', 'Monthly report', 'Full suite'],
                  ['Account Manager', '—', '—', '✓'],
                  ['On-Site Support', 'Add-on', 'Add-on', 'Included'],
                  ['Custom Integrations', '—', '—', '✓'],
                  ['24/7 Emergency', 'Add-on', 'Add-on', 'Included'],
                ].map(([feature, ...values]) => (
                  <tr key={feature} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 text-foreground">{feature}</td>
                    {values.map((v, i) => (
                      <td key={i} className="text-center py-3 px-4">
                        <span className={v === '✓' ? 'text-accent font-medium' : v === '—' ? 'text-muted-foreground/40' : 'text-muted-foreground'}>
                          {v}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="text-3xl font-bold text-foreground text-center mb-10">Pricing FAQ</h2>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <div key={faq.q} className="bg-card rounded-xl border border-border/50 p-5">
                <h4 className="font-semibold text-foreground mb-2">{faq.q}</h4>
                <p className="text-sm text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Ready to Get Started?</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Book a free discovery call to find the right plan for your organization.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" className="gradient-primary border-0">
              Book Discovery Call
              <ArrowRight className="w-4 h-4 ms-1" />
            </Button>
            <Button size="lg" variant="outline">
              Contact Sales
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
