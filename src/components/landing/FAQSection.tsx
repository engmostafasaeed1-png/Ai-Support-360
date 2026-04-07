import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

export default function FAQSection() {
  const { t } = useTranslation();

  const faqs = [1, 2, 3, 4, 5].map((n) => ({
    q: t(`faq.q${n}`),
    a: t(`faq.a${n}`),
  }));

  return (
    <section id="faq" className="py-28">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-bold tracking-widest uppercase mb-4">
            FAQ
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('faq.title')}</h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-base md:text-lg">{t('faq.subtitle')}</p>
        </div>

        <div className="max-w-3xl mx-auto">
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="rounded-2xl border border-border/40 bg-card px-6 data-[state=open]:shadow-lg data-[state=open]:border-primary/15 transition-all">
                <AccordionTrigger className="text-left font-bold text-foreground hover:no-underline py-5">
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
