import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import SectionHeader from './SectionHeader';

export default function FAQSection() {
  const { t } = useTranslation();

  const faqs = [1, 2, 3, 4, 5].map((n) => ({
    q: t(`faq.q${n}`),
    a: t(`faq.a${n}`),
  }));

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };

  return (
    <section id="faq" className="relative py-24 md:py-32 overflow-hidden bg-background">
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(faqJsonLd)}</script>
      </Helmet>
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-0 w-[480px] h-[480px] bg-accent/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 right-0 w-[480px] h-[480px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow="FAQ"
          title={
            <>
              {t('faq.title').split(' ').slice(0, -1).join(' ')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('faq.title').split(' ').slice(-1)}
              </span>
            </>
          }
          subtitle={t('faq.subtitle')}
        />

        <div className="max-w-3xl mx-auto motion-safe:animate-fade-in-up" style={{ animationDelay: '120ms' }}>
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="group rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm px-6 motion-safe:transition-all motion-safe:duration-300 data-[state=open]:bg-card data-[state=open]:border-primary/40 data-[state=open]:shadow-2xl"
              >
                <AccordionTrigger className="text-left font-bold text-foreground hover:no-underline py-5 [&[data-state=open]]:text-primary motion-safe:transition-colors">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
