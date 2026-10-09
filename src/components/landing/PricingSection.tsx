import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PricingFormula, PricingSteps, usePick } from '@/components/pricing/PayPerHourPricing';
import { usePricingTerms } from '@/hooks/usePricingTerms';
import SectionHeader from './SectionHeader';
import { useDemoWizard } from './DemoRequestWizard';

/** The pricing block of the home page: the same model as the pricing page, without the calculator. */
export default function PricingSection() {
  const pick = usePick();
  const demoWizard = useDemoWizard();
  const { data: terms } = usePricingTerms();

  return (
    <section id="pricing" className="relative overflow-hidden bg-muted/30 py-24 md:py-32">
      {/* Background mesh */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-primary/10 blur-[160px] motion-safe:animate-mesh-shift" />
      </div>

      <div className="container relative mx-auto px-4">
        <SectionHeader
          eyebrow={pick('Pricing', 'الأسعار')}
          title={
            <>
              {pick('Pay only for the ', 'ادفع فقط مقابل ')}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">{pick('hours you approve', 'الساعات التي توافق عليها')}</span>
            </>
          }
          subtitle={pick(
            'No subscription and no minimum. The consultant proposes an hourly rate, you approve it, and you approve the timesheet before you pay.',
            'بلا اشتراك وبلا حد أدنى. يقترح المستشار سعر الساعة وأنت توافق عليه، ثم توافق على سجل الساعات قبل أن تدفع.',
          )}
        />

        <div className="mx-auto max-w-5xl space-y-8">
          <PricingSteps />
          <PricingFormula terms={terms} />
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 rounded-2xl border-0 bg-gradient-to-r from-primary to-accent font-semibold shadow-lg hover:opacity-95">
              <Link to="/pricing">{pick('Open the price calculator', 'افتح حاسبة السعر')}</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 rounded-2xl font-semibold" onClick={() => demoWizard.open('live', { source: 'pricing-demo' })}>
              {pick('Book a demo', 'احجز عرضاً تجريبياً')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
