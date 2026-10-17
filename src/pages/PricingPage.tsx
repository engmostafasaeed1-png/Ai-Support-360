import { PRICING_SEO, useHeadTags } from '@/lib/useHeadTags';
import { Link } from 'react-router-dom';
import { ArrowRight, HeadphonesIcon } from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PaymentMethodsNote, PricingCalculator, PricingFaq, PricingFormula, PricingSteps, pricingFaqs, usePick } from '@/components/pricing/PayPerHourPricing';
import { usePricingTerms } from '@/hooks/usePricingTerms';

/** The public pricing page: one model for everybody, the hours of a timesheet that the client approved. The percentages come from the database. */
export default function PricingPage() {
  const pick = usePick();
  const { data: terms } = usePricingTerms();

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pricingFaqs(pick, terms).map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };

  useHeadTags({
    description: PRICING_SEO.description,
    canonical: 'https://www.aisupport360.com/pricing',
    ogTitle: PRICING_SEO.title,
    ogDescription: PRICING_SEO.description,
    ogUrl: 'https://www.aisupport360.com/pricing',
    jsonLd: faqJsonLd,
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <section className="bg-gradient-to-b from-primary/5 to-background pb-12 pt-28">
        <div className="container mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5">
            <HeadphonesIcon className="me-1.5 h-3.5 w-3.5" />
            {pick('Transparent pricing', 'تسعير شفاف')}
          </Badge>
          <h1 className="mb-4 text-4xl font-bold text-foreground md:text-5xl">{pick('Pay only for the hours you approve', 'ادفع فقط مقابل الساعات التي توافق عليها')}</h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            {pick(
              'No subscription and no minimum. The consultant proposes an hourly rate, you approve it, and you approve the timesheet before you pay.',
              'بلا اشتراك وبلا حد أدنى. يقترح المستشار سعر الساعة وأنت توافق عليه، ثم توافق على سجل الساعات قبل أن تدفع.',
            )}
          </p>
        </div>
      </section>

      <section className="pb-12">
        <div className="container mx-auto max-w-5xl space-y-10 px-4">
          <PricingSteps />

          <div className="space-y-4">
            <h2 className="text-center text-2xl font-bold text-foreground">{pick('How the price is made', 'كيف يتكوّن السعر')}</h2>
            <PricingFormula terms={terms} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <PricingCalculator />
            <div className="space-y-4">
              <PaymentMethodsNote terms={terms} />
              <div className="rounded-2xl border border-border/60 bg-card p-5 text-sm leading-relaxed text-muted-foreground">
                <p className="mb-1 font-semibold text-foreground">{pick('What you see before you pay', 'ما تراه قبل أن تدفع')}</p>
                {pick(
                  'Every activity of the timesheet with its date, duration and description, the approved hourly rate, and the total with the fees and the VAT. You can send the timesheet back with a comment as often as needed.',
                  'كل نشاط في سجل الساعات مع تاريخه ومدته ووصفه، وسعر الساعة المعتمد، والإجمالي مع الرسوم وضريبة القيمة المضافة. ويمكنك إعادة السجل مع تعليق كلما احتجت.',
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-muted/30 py-14">
        <div className="container mx-auto max-w-3xl px-4">
          <h2 className="mb-8 text-center text-3xl font-bold text-foreground">{pick('Pricing FAQ', 'أسئلة عن الأسعار')}</h2>
          <PricingFaq terms={terms} />
        </div>
      </section>

      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground">{pick('Ready to get started?', 'هل أنت مستعد للبدء؟')}</h2>
          <p className="mx-auto mb-8 max-w-lg text-muted-foreground">
            {pick('Create your account, describe your SAP request and get a verified consultant.', 'أنشئ حسابك واشرح طلبك في SAP واحصل على مستشار معتمد.')}
          </p>
          <Button asChild size="lg" className="gradient-primary border-0">
            <Link to="/signup">
              {pick('Create your account', 'أنشئ حسابك')}
              <ArrowRight className="ms-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
