import { useMemo, useState } from 'react';
import { CONSULTANT_SEO, useHeadTags } from '@/lib/useHeadTags';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BellRing,
  Calculator,
  ClipboardList,
  Globe2,
  LockKeyhole,
  MessagesSquare,
  Mic,
  ShieldCheck,
  Siren,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clampHours, clampRate, criticalRate, HOURS_MAX, HOURS_MIN, payoutExample, RATE_MAX, RATE_MIN } from '@/lib/payoutExample';

/** The apply link keeps the campaign parameters (utm_*, ref) of the landing URL. */
export function applyHref(search: string): string {
  const kept = new URLSearchParams();
  new URLSearchParams(search).forEach((value, key) => {
    if (key.startsWith('utm_') || key === 'ref') kept.set(key, value);
  });
  kept.set('role', 'consultant');
  return `/signup?${kept.toString()}`;
}

const money = (n: number) => n.toFixed(2);

/** The public landing page that invites verified SAP consultants to apply. Facts only, no statistics. */
export default function ForConsultantsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const href = applyHref(searchParams.toString());

  const [rateRaw, setRateRaw] = useState('50');
  const [hoursRaw, setHoursRaw] = useState('8');
  const rate = Number(rateRaw);
  const hours = Number(hoursRaw);
  const rateValid = Number.isFinite(rate) && rate >= RATE_MIN && rate <= RATE_MAX;
  const hoursValid = Number.isFinite(hours) && hours >= HOURS_MIN && hours <= HOURS_MAX;
  const example = useMemo(
    () => (rateValid && hoursValid ? payoutExample(rate, hours) : null),
    [rate, hours, rateValid, hoursValid],
  );

  const steps = [
    { icon: UserPlus, title: t('forConsultants.step1_title', 'Apply and build your profile'), text: t('forConsultants.step1_text', 'Create your account, complete the guided profile set-up and add your SAP modules, experience and certificates.') },
    { icon: Mic, title: t('forConsultants.step2_title', 'Take the 10-15 minute AI interview'), text: t('forConsultants.step2_text', 'A short AI voice interview (camera and microphone needed), then our team reviews and verifies your profile.') },
    { icon: MessagesSquare, title: t('forConsultants.step3_title', 'Get matched, ask questions and bid'), text: t('forConsultants.step3_text', 'Open requests matched to your SAP modules arrive in the portal. Ask the client questions, bid and make counter-offers.') },
    { icon: Banknote, title: t('forConsultants.step4_title', 'Deliver, log time, get paid'), text: t('forConsultants.step4_text', 'Work, chat, sessions, timesheets and invoices run inside the portal. Your fee arrives by bank transfer within 15 business days after the client pays.') },
  ];

  const tiers = [
    { name: t('forConsultants.tier_gold', 'Gold'), score: t('forConsultants.tier_gold_score', 'Interview score 85 or more'), credits: t('forConsultants.tier_gold_credits', '150 credibility credits') },
    { name: t('forConsultants.tier_silver', 'Silver'), score: t('forConsultants.tier_silver_score', 'Interview score 70 or more'), credits: t('forConsultants.tier_silver_credits', '100 credibility credits') },
    { name: t('forConsultants.tier_bronze', 'Bronze'), score: t('forConsultants.tier_bronze_score', 'Interview score 50 or more'), credits: t('forConsultants.tier_bronze_credits', '75 credibility credits') },
    { name: t('forConsultants.tier_verified', 'Verified'), score: t('forConsultants.tier_verified_score', 'Interview score below 50'), credits: t('forConsultants.tier_verified_credits', '50 credibility credits') },
  ];

  const benefits = [
    { icon: Sparkles, text: t('forConsultants.benefit1', 'Open requests matched to your SAP modules') },
    { icon: MessagesSquare, text: t('forConsultants.benefit2', 'Bidding with questions to the client and counter-offers') },
    { icon: BellRing, text: t('forConsultants.benefit3', 'Alerts in the portal, on the phone and on Telegram for critical requests') },
    { icon: LockKeyhole, text: t('forConsultants.benefit4', 'Private bank details, visible only to you and the platform administrators') },
    { icon: ShieldCheck, text: t('forConsultants.benefit5', 'All work, chat, sessions, timesheets and invoices protected inside the portal') },
    { icon: Globe2, text: t('forConsultants.benefit6', 'English and Arabic, with a guided profile set-up and a portal tour') },
  ];

  const faqs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    q: t(`forConsultants.faq_q${n}`, FAQ_DEFAULTS[n - 1].q),
    a: t(`forConsultants.faq_a${n}`, FAQ_DEFAULTS[n - 1].a),
  }));

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_DEFAULTS.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };

  useHeadTags({
    description: CONSULTANT_SEO.description,
    canonical: 'https://www.aisupport360.com/for-consultants',
    ogTitle: CONSULTANT_SEO.title,
    ogDescription: CONSULTANT_SEO.description,
    ogUrl: 'https://www.aisupport360.com/for-consultants',
    jsonLd: faqJsonLd,
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main id="main-content">
        {/* 1. Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-primary/10 via-primary/5 to-background pb-16 pt-28">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-4 text-4xl font-bold text-foreground md:text-5xl">
              {t('forConsultants.hero_title', 'Keep 100% of your rate')}
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
              {t('forConsultants.hero_subtitle', 'Join verified SAP consultants on AI Support 360. You set your rate. Clients pay the fees on top.')}
            </p>
            <Button asChild size="lg" className="gradient-primary border-0">
              <Link to={href}>
                {t('forConsultants.apply', 'Apply as a consultant')}
                <ArrowRight className="ms-1 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {[t('forConsultants.chip1', 'You set your own rate'), t('forConsultants.chip2', 'Paid within 15 business days'), t('forConsultants.chip3', 'Private bank details')].map((chip) => (
                <span key={chip} className="rounded-full border border-border/60 bg-card/80 px-3.5 py-1.5 text-xs font-semibold text-muted-foreground">
                  {chip}
                </span>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{t('forConsultants.hero_note', 'Free to apply. Takes about 10 minutes.')}</p>
          </div>
        </section>

        {/* 2. How it works */}
        <section className="py-16" aria-labelledby="fc-how">
          <div className="container mx-auto max-w-5xl px-4">
            <h2 id="fc-how" className="mb-10 text-center text-3xl font-bold text-foreground">
              {t('forConsultants.how_title', 'How it works')}
            </h2>
            <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <li key={i} className="rounded-2xl border border-border/60 bg-card p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">{i + 1}</span>
                    <step.icon className="h-5 w-5 text-accent" aria-hidden="true" />
                  </div>
                  <h3 className="mb-2 font-bold text-foreground">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 3. Payout calculator */}
        <section className="bg-muted/30 py-16" aria-labelledby="fc-calc">
          <div className="container mx-auto max-w-4xl px-4">
            <h2 id="fc-calc" className="mb-3 text-center text-3xl font-bold text-foreground">
              {t('forConsultants.calc_title', 'Keep 100% of your rate')}
            </h2>
            <p className="mx-auto mb-10 max-w-2xl text-center text-muted-foreground">
              {t('forConsultants.calc_subtitle', 'Your fee is your approved hourly rate times the approved timesheet hours. The client pays the portal fee, the payment processing fee and the VAT on top.')}
            </p>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-card p-6">
                <div className="mb-5 flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h3 className="font-bold text-foreground">{t('forConsultants.calc_inputs', 'Try your own numbers')}</h3>
                </div>
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="fc-rate">{t('forConsultants.calc_rate', 'Your hourly rate (USD)')}</Label>
                    <Input
                      id="fc-rate"
                      type="number"
                      min={RATE_MIN}
                      max={RATE_MAX}
                      step="0.5"
                      value={rateRaw}
                      onChange={(e) => setRateRaw(e.target.value)}
                      className="mt-1.5"
                      aria-invalid={!rateValid}
                    />
                    {!rateValid && (
                      <p className="mt-1.5 text-xs text-destructive" role="alert">
                        {t('forConsultants.calc_rate_invalid', 'Enter a rate between 1 and 1000.')}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="fc-hours">{t('forConsultants.calc_hours', 'Approved hours')}</Label>
                    <Input
                      id="fc-hours"
                      type="number"
                      min={HOURS_MIN}
                      max={HOURS_MAX}
                      step="0.25"
                      value={hoursRaw}
                      onChange={(e) => setHoursRaw(e.target.value)}
                      className="mt-1.5"
                      aria-invalid={!hoursValid}
                    />
                    {!hoursValid && (
                      <p className="mt-1.5 text-xs text-destructive" role="alert">
                        {t('forConsultants.calc_hours_invalid', 'Enter hours between 0.25 and 200.')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card p-6" aria-live="polite">
                <h3 className="mb-5 font-bold text-foreground">{t('forConsultants.calc_result', 'What the client pays, what you receive')}</h3>
                {example ? (
                  <dl className="space-y-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">{t('forConsultants.calc_fee', 'Your fee (rate x hours)')}</dt>
                      <dd className="font-semibold text-foreground" dir="ltr">{money(example.base)} USD</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">{t('forConsultants.calc_portal_fee', 'Portal fee (10 %)')}</dt>
                      <dd className="font-semibold text-foreground" dir="ltr">{money(example.serviceFee)} USD</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">{t('forConsultants.calc_payment_fee', 'Payment processing fee (5 %)')}</dt>
                      <dd className="font-semibold text-foreground" dir="ltr">{money(example.processingFee)} USD</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">{t('forConsultants.calc_vat', 'VAT (15 %)')}</dt>
                      <dd className="font-semibold text-foreground" dir="ltr">{money(example.vat)} USD</dd>
                    </div>
                    <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
                      <dt className="font-semibold text-foreground">{t('forConsultants.calc_client_pays', 'The client pays')}</dt>
                      <dd className="font-bold text-foreground" dir="ltr">{money(example.total)} USD</dd>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2.5">
                      <dt className="font-bold text-emerald-700 dark:text-emerald-400">{t('forConsultants.calc_you_receive', 'You receive')}</dt>
                      <dd className="text-lg font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">{money(example.base)} USD</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('forConsultants.calc_fix', 'Fix the inputs to see the result.')}</p>
                )}
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted-foreground">
              {t('forConsultants.calc_caption', 'Example with the current standard fees. The client pays the fees; you receive your whole fee. Taxes on your income are your own responsibility.')}
            </p>
          </div>
        </section>

        {/* 4. Critical requests */}
        <section className="py-16" aria-labelledby="fc-critical">
          <div className="container mx-auto max-w-4xl px-4">
            <div className="rounded-3xl border border-border/60 bg-card p-8 md:p-10">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10">
                  <Siren className="h-5 w-5 text-destructive" aria-hidden="true" />
                </span>
                <h2 id="fc-critical" className="text-2xl font-bold text-foreground md:text-3xl">
                  {t('forConsultants.critical_title', '+30% for fast critical replies')}
                </h2>
              </div>
              <p className="mb-4 leading-relaxed text-muted-foreground">
                {t('forConsultants.critical_text', 'A request marked Critical alarms all verified consultants in that SAP area. If you reply with a bid within 30 minutes and the client accepts your bid, your approved hourly rate for that request is raised by 30 %.')}
              </p>
              <p className="mb-4 rounded-2xl bg-muted/50 px-4 py-3 text-sm font-semibold text-foreground" dir="ltr">
                {t('forConsultants.critical_example', 'Example: 50 USD/h becomes 65 USD/h, so 8 h = 520.00 USD for you.')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('forConsultants.critical_note', 'Applies to the request where you reply within 30 minutes and the client accepts your bid.')}
              </p>
            </div>
          </div>
        </section>

        {/* 5. Badges */}
        <section className="bg-muted/30 py-16" aria-labelledby="fc-badges">
          <div className="container mx-auto max-w-5xl px-4">
            <div className="mb-10 text-center">
              <BadgeCheck className="mx-auto mb-3 h-8 w-8 text-accent" aria-hidden="true" />
              <h2 id="fc-badges" className="text-3xl font-bold text-foreground">
                {t('forConsultants.badges_title', 'Earn a badge that clients can see')}
              </h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {tiers.map((tier) => (
                <div key={tier.name} className="rounded-2xl border border-border/60 bg-card p-6 text-center">
                  <h3 className="mb-2 text-xl font-bold text-foreground">{tier.name}</h3>
                  <p className="text-sm text-muted-foreground">{tier.score}</p>
                  <p className="mt-1 text-sm font-semibold text-primary">{tier.credits}</p>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-muted-foreground">
              {t('forConsultants.badges_note', 'Badges come from your AI interview result. Certificates, experience and client reviews add to your trust score.')}
            </p>
          </div>
        </section>

        {/* 6. What you get */}
        <section className="py-16" aria-labelledby="fc-benefits">
          <div className="container mx-auto max-w-5xl px-4">
            <h2 id="fc-benefits" className="mb-10 text-center text-3xl font-bold text-foreground">
              {t('forConsultants.benefits_title', 'What you get')}
            </h2>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {benefits.map((benefit, i) => (
                <div key={i} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <benefit.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </span>
                  <p className="pt-1.5 text-sm font-medium leading-relaxed text-foreground">{benefit.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. FAQ */}
        <section className="bg-muted/30 py-16" aria-labelledby="fc-faq">
          <div className="container mx-auto max-w-3xl px-4">
            <h2 id="fc-faq" className="mb-8 text-center text-3xl font-bold text-foreground">
              {t('forConsultants.faq_title', 'Questions consultants ask')}
            </h2>
            <Accordion type="single" collapsible className="space-y-3">
              {faqs.map((faq, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
                  className="rounded-2xl border border-border/60 bg-card px-6 data-[state=open]:border-primary/40"
                >
                  <AccordionTrigger className="py-5 text-start font-semibold text-foreground hover:no-underline">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 leading-relaxed text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* 8. Final strip */}
        <section className="py-16" aria-labelledby="fc-final">
          <div className="container mx-auto px-4 text-center">
            <h2 id="fc-final" className="mb-6 text-3xl font-bold text-foreground">
              {t('forConsultants.final_title', 'Ready to start?')}
            </h2>
            <Button asChild size="lg" className="gradient-primary border-0">
              <Link to={href}>
                {t('forConsultants.apply', 'Apply as a consultant')}
                <ArrowRight className="ms-1 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <p className="mx-auto mt-6 max-w-xl text-xs text-muted-foreground">
              {t('forConsultants.final_note', 'AI Support 360 connects clients and consultants. It is not the employer or a party to your engagement.')}
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

/** The English FAQ, also the source of the JSON-LD markup. */
const FAQ_DEFAULTS = [
  {
    q: 'Who can apply?',
    a: 'SAP consultants who complete their profile, take the 10-15 minute AI voice interview (camera and microphone needed) and pass the review of the platform team. Verification is required before you can take requests.',
  },
  {
    q: 'Who sets my rate?',
    a: 'You do. You set your own hourly rate, and the client approves it before any work starts. Your fee is the approved hourly rate times the approved timesheet hours.',
  },
  {
    q: 'Do I really keep 100%?',
    a: 'Yes. You receive your whole fee. The client pays on top: a portal fee of 10 %, a payment processing fee of 5 %, and 15 % VAT on the fee plus both fees.',
  },
  {
    q: 'When and how do I get paid?',
    a: 'The client pays the platform, and the platform transfers your fee by bank transfer within 15 business days (Sunday to Thursday) after it receives the payment of the client.',
  },
  {
    q: 'How do critical requests work?',
    a: 'A request marked Critical alarms all verified consultants in that SAP area. If you reply with a bid within 30 minutes and the client accepts it, your approved hourly rate for that request is raised by 30 %.',
  },
  {
    q: 'How do the badges work?',
    a: 'Your AI interview score gives a badge and credibility credits: Gold (85 or more, 150 credits), Silver (70 or more, 100 credits), Bronze (50 or more, 75 credits) and Verified (below 50, 50 credits). Credits and the badge build your visible trust score, and certificates, experience and client reviews add to it.',
  },
  {
    q: 'Are my bank details safe?',
    a: 'Yes. Your bank details are private: only you and the platform administrators can see them.',
  },
  {
    q: 'Can clients contact me outside the portal?',
    a: 'Your contact details stay hidden until you are assigned to a request. All work, chat, sessions, timesheets and invoices run inside the portal.',
  },
  {
    q: 'What do I need to apply?',
    a: 'A completed profile and a camera and microphone for the 10-15 minute AI voice interview. Applying is free and takes about 10 minutes.',
  },
  {
    q: 'Which countries do you pay to?',
    a: 'Payouts are by bank transfer to the account you provide. Supported countries are confirmed during verification.',
  },
];
