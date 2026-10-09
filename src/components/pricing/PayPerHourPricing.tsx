import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ClipboardCheck, CreditCard, FileSignature, Receipt, Timer } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PriceBreakdown from '@/components/pricing/PriceBreakdown';
import { usePricingTerms } from '@/hooks/usePricingTerms';
import { formatPercent, priceBreakdown, type PricingTerms } from '@/lib/pricing';

/** English or Arabic text, by the language of the page. */
export function usePick() {
  const { i18n } = useTranslation();
  const arabic = (i18n.language || '').startsWith('ar');
  return (en: string, ar: string) => (arabic ? ar : en);
}

const pct = (value: number | undefined) => (value === undefined ? '...' : formatPercent(value));

/** The formula of the price, with the percentages that the administrator has set. */
export function PricingFormula({ terms }: { terms: PricingTerms | null | undefined }) {
  const pick = usePick();
  const part = 'rounded-xl border border-border/60 bg-card px-4 py-3 text-center';
  return (
    <div className="flex flex-col items-stretch justify-center gap-2 text-sm md:flex-row md:items-center" data-testid="pricing-formula">
      <div className={part}>
        <p className="font-semibold text-foreground">{pick('Hourly rate x approved hours', 'سعر الساعة × الساعات المعتمدة')}</p>
        <p className="text-xs text-muted-foreground">{pick('the fee of the consultant', 'أتعاب المستشار')}</p>
      </div>
      <span className="text-center text-lg font-bold text-muted-foreground">+</span>
      <div className={part}>
        <p className="font-semibold text-foreground">{pct(terms?.serviceFeePercent)}</p>
        <p className="text-xs text-muted-foreground">{pick('platform service fee', 'رسوم خدمة المنصة')}</p>
      </div>
      <span className="text-center text-lg font-bold text-muted-foreground">+</span>
      <div className={part}>
        <p className="font-semibold text-foreground">{pct(terms?.processingFeePercent)}</p>
        <p className="text-xs text-muted-foreground">{pick('payment processing fee', 'رسوم معالجة الدفع')}</p>
      </div>
      <span className="text-center text-lg font-bold text-muted-foreground">+</span>
      <div className={part}>
        <p className="font-semibold text-foreground">{pct(terms?.vatPercent)}</p>
        <p className="text-xs text-muted-foreground">{pick('VAT on the total', 'ضريبة القيمة المضافة على الإجمالي')}</p>
      </div>
    </div>
  );
}

/** The four steps from the request to the invoice. */
export function PricingSteps() {
  const pick = usePick();
  const steps = [
    {
      icon: ClipboardCheck,
      title: pick('Describe your request', 'اشرح طلبك'),
      text: pick('Post a ticket. AI matches you with verified SAP consultants.', 'أنشئ تذكرة وسيقترح الذكاء الاصطناعي مستشاري SAP المعتمدين المناسبين لك.'),
    },
    {
      icon: CheckCircle2,
      title: pick('Approve the hourly rate', 'وافق على سعر الساعة'),
      text: pick('The consultant proposes an hourly rate for your ticket. Nothing is billed until you approve it.', 'يقترح المستشار سعر الساعة لتذكرتك. لا تتم أي فوترة قبل موافقتك.'),
    },
    {
      icon: Timer,
      title: pick('Follow the timesheet', 'تابع سجل الساعات'),
      text: pick('The consultant logs every activity with its duration. You see the hours before you pay and can ask for changes.', 'يسجّل المستشار كل نشاط ومدته. تراجع الساعات قبل الدفع ويمكنك طلب تعديلات.'),
    },
    {
      icon: Receipt,
      title: pick('Approve and pay', 'وافق وادفع'),
      text: pick('When you approve a timesheet you get one invoice: hours x rate, plus the fees and VAT.', 'عند موافقتك على سجل الساعات تصلك فاتورة واحدة: الساعات × السعر، مضافاً إليها الرسوم وضريبة القيمة المضافة.'),
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="pricing-steps">
      {steps.map((s, i) => (
        <div key={s.title} className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <s.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
          </div>
          <h3 className="mb-1 text-base font-bold text-foreground">{s.title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

/** A calculator: hourly rate x hours -> the total, with the live percentages. */
export function PricingCalculator() {
  const pick = usePick();
  const { data: terms, isLoading } = usePricingTerms();
  const [rate, setRate] = useState('100');
  const [hours, setHours] = useState('10');
  const rateN = Number(rate.replace(',', '.'));
  const hoursN = Number(hours.replace(',', '.'));
  const ok = Number.isFinite(rateN) && Number.isFinite(hoursN) && rateN > 0 && hoursN > 0 && rateN <= 100000 && hoursN <= 10000;
  const breakdown = terms && ok ? priceBreakdown(rateN * hoursN, terms) : null;
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 md:p-6" data-testid="pricing-calculator">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-foreground">
        <FileSignature className="h-5 w-5 text-primary" aria-hidden="true" /> {pick('Price calculator', 'حاسبة السعر')}
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">
        {pick('Enter the hourly rate and the hours of a timesheet. This is what the invoice looks like after you approve it.', 'أدخل سعر الساعة وعدد ساعات سجل الساعات. هكذا تبدو الفاتورة بعد موافقتك.')}
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="calc-rate" className="text-xs">{pick('Hourly rate (USD)', 'سعر الساعة (دولار)')}</Label>
          <Input id="calc-rate" type="number" inputMode="decimal" min="1" step="1" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc-hours" className="text-xs">{pick('Approved hours', 'الساعات المعتمدة')}</Label>
          <Input id="calc-hours" type="number" inputMode="decimal" min="0.25" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
      </div>
      {breakdown ? (
        <PriceBreakdown breakdown={breakdown} currency="USD" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? pick('Loading the prices...', 'جارٍ تحميل الأسعار...')
            : !terms
              ? pick('The prices are being set up. Please check again soon.', 'يجري إعداد الأسعار. يرجى المحاولة لاحقاً.')
              : pick('Enter a rate and hours above zero.', 'أدخل سعراً وساعات أكبر من صفر.')}
        </p>
      )}
    </div>
  );
}

/** How the client can pay. Card payment is shown only when it is switched on. */
export function PaymentMethodsNote({ terms }: { terms: PricingTerms | null | undefined }) {
  const pick = usePick();
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5 text-sm" data-testid="payment-methods">
      <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <p className="leading-relaxed text-muted-foreground">
        {terms?.cardsEnabled
          ? pick(
              'Pay online by card (Visa, Mastercard, credit and debit) or by bank transfer. Digital wallets are offered where our payment provider supports them.',
              'ادفع عبر الإنترنت بالبطاقة (فيزا، ماستركارد، ائتمانية ومدين) أو بالتحويل البنكي. تتوفر المحافظ الرقمية حيث يدعمها مزوّد الدفع لدينا.',
            )
          : pick(
              'Pay by bank transfer. Online card payment is being activated and will be shown here when it is available.',
              'الدفع بالتحويل البنكي. يجري تفعيل الدفع بالبطاقة عبر الإنترنت وسيظهر هنا عند توفره.',
            )}{' '}
        {pick('Prices are in US dollars unless your ticket uses another currency.', 'الأسعار بالدولار الأمريكي ما لم تستخدم تذكرتك عملة أخرى.')}
      </p>
    </div>
  );
}

/** The questions about the price, in English or Arabic. */
export function pricingFaqs(pick: (en: string, ar: string) => string, terms: PricingTerms | null | undefined) {
  const service = pct(terms?.serviceFeePercent);
  const processing = pct(terms?.processingFeePercent);
  const vat = pct(terms?.vatPercent);
  return [
    {
      q: pick('How is the price calculated?', 'كيف يُحسب السعر؟'),
      a: pick(
        `Hourly rate x approved hours is the fee of the consultant. The platform adds a service fee of ${service} and a payment processing fee of ${processing} of that fee, and VAT of ${vat} on the total of the three.`,
        `أتعاب المستشار = سعر الساعة × الساعات المعتمدة. تضيف المنصة رسوم خدمة بنسبة ${service} ورسوم معالجة الدفع بنسبة ${processing} من هذه الأتعاب، ثم ضريبة القيمة المضافة بنسبة ${vat} على مجموع الثلاثة.`,
      ),
    },
    {
      q: pick('Who sets the hourly rate?', 'من يحدد سعر الساعة؟'),
      a: pick(
        'The consultant proposes an hourly rate for your ticket and you approve it. The consultant can not log billable time before a rate is approved, and can not type another rate later.',
        'يقترح المستشار سعر الساعة لتذكرتك وأنت توافق عليه. لا يستطيع المستشار تسجيل وقت قابل للفوترة قبل الموافقة على السعر ولا يمكنه كتابة سعر آخر لاحقاً.',
      ),
    },
    {
      q: pick('When do I pay?', 'متى أدفع؟'),
      a: pick(
        'Only after you approve a timesheet. You see every activity, its duration and the total before you approve, and you can send the timesheet back with a comment.',
        'فقط بعد موافقتك على سجل الساعات. ترى كل نشاط ومدته والإجمالي قبل الموافقة، ويمكنك إعادة السجل مع تعليق.',
      ),
    },
    {
      q: pick('Is there a subscription or a minimum?', 'هل يوجد اشتراك أو حد أدنى؟'),
      a: pick('No. You pay only for the hours that you approve.', 'لا. تدفع فقط مقابل الساعات التي توافق عليها.'),
    },
    {
      q: pick('What do the two fees pay for?', 'ما الذي تغطيه الرسوم؟'),
      a: pick(
        'The service fee pays for the platform: matching, verification of consultants, the timesheet and the invoicing. The payment processing fee pays for the payment provider. The consultant receives the whole fee.',
        'رسوم الخدمة تغطي المنصة: المطابقة والتحقق من المستشارين وسجل الساعات والفوترة. ورسوم معالجة الدفع تغطي مزوّد الدفع. ويحصل المستشار على كامل أتعابه.',
      ),
    },
    {
      q: pick('Is VAT included?', 'هل الضريبة مشمولة؟'),
      a: pick('No. VAT is added to the invoice and shown on its own line.', 'لا. تُضاف ضريبة القيمة المضافة إلى الفاتورة وتظهر في سطر مستقل.'),
    },
  ];
}

export function PricingFaq({ terms }: { terms: PricingTerms | null | undefined }) {
  const pick = usePick();
  const faqs = pricingFaqs(pick, terms);
  return (
    <Accordion type="single" collapsible className="space-y-3" data-testid="pricing-faq">
      {faqs.map((faq, i) => (
        <AccordionItem key={faq.q} value={`faq-${i}`} className="rounded-2xl border border-border/60 bg-card px-5">
          <AccordionTrigger className="py-4 text-start font-semibold text-foreground hover:no-underline">{faq.q}</AccordionTrigger>
          <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">{faq.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
