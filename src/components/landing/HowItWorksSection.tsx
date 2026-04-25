import { useTranslation } from 'react-i18next';
import { FileText, Brain, MessageSquare, Star, ArrowRight } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  accents,
  border,
  iconPlate,
  motion,
  radius,
  sheen,
  shadow,
  surface,
  tile,
  type AccentName,
} from './tokens';

type Step = {
  Icon: typeof FileText;
  /** Accent name from the shared design tokens. */
  accent: AccentName;
};

// Each step uses an `AccentName` from `./tokens.ts` — the same palette
// powers the matching tile in WhyQurtubaSection so the two sections
// always look related.
const steps: Step[] = [
  { Icon: FileText,      accent: 'sky'     },
  { Icon: Brain,         accent: 'violet'  },
  { Icon: MessageSquare, accent: 'amber'   },
  { Icon: Star,          accent: 'emerald' },
];

export default function HowItWorksSection() {
  const { t } = useTranslation();

  const items = steps.map((s, i) => ({
    ...s,
    title: t(`howItWorks.step${i + 1}_title`),
    desc: t(`howItWorks.step${i + 1}_desc`),
  }));

  return (
    <section id="how-it-works" className={`relative py-24 md:py-32 overflow-hidden ${surface.section}`}>
      {/* Decorative background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 -left-32 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 -right-32 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[160px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-16 md:mb-20 max-w-3xl mx-auto motion-safe:animate-fade-in-up">
          <span className={`inline-flex items-center gap-2 px-4 py-1.5 ${radius.pill} bg-foreground/5 ${border.base} text-foreground/80 text-xs font-bold tracking-[0.2em] uppercase mb-5 backdrop-blur-sm`}>
            <span className={`w-1.5 h-1.5 ${radius.pill} bg-primary motion-safe:animate-pulse-soft`} />
            How It Works
          </span>
          <h2 className="text-4xl md:text-6xl font-black text-foreground tracking-tight leading-[1.05]">
            From request to{' '}
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              results
            </span>{' '}
            in four steps
          </h2>
          <p className="text-muted-foreground mt-6 text-base md:text-lg leading-relaxed">
            {t('howItWorks.subtitle')}
          </p>
        </div>

        {/* Steps grid */}
        <div className="relative max-w-6xl mx-auto">
          {/* Connecting dashed line (desktop only) — sits behind the cards */}
          <div
            aria-hidden="true"
            className="hidden lg:block absolute top-[88px] left-[12.5%] right-[12.5%] h-px"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to right, hsl(var(--border)) 0 8px, transparent 8px 16px)',
            }}
          />

          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
            {items.map((s, i) => (
              <li
                key={i}
                style={{ animationDelay: `${i * 100}ms` }}
                className={`relative ${motion.enter}`}
              >
                {/*
                  Tile uses the canonical `tile` token so it visually
                  matches every other tile in the marketing landing page.
                */}
                <article className={`${tile} h-full p-6 md:p-7`}>
                  {/* Subtle gradient sheen on hover (shared token) */}
                  <div className={sheen} />

                  {/* Floating step number badge */}
                  <div className="absolute -top-3 right-6 z-10">
                    <span className={`inline-flex items-center justify-center w-9 h-9 ${radius.pill} bg-background border border-border text-[11px] font-mono font-bold tracking-widest text-foreground/70 ${shadow.soft}`}>
                      0{i + 1}
                    </span>
                  </div>

                  {/* Icon plate (shared token) + colored glow on hover */}
                  <div className="relative inline-flex">
                    <div
                      style={{ ['--glow' as string]: accents[s.accent].glow }}
                      className={`${iconPlate(s.accent)} group-hover:shadow-[0_0_60px_-15px_rgba(var(--glow),0.55)]`}
                    >
                      <s.Icon size={28} strokeWidth={1.75} absoluteStrokeWidth className="text-white" aria-hidden="true" />
                    </div>
                    {/* Tiny dot accent */}
                    <span className={`absolute -bottom-1 -right-1 w-3 h-3 ${radius.pill} bg-background border-2 border-primary motion-safe:animate-pulse-soft`} />
                  </div>

                  {/* Copy */}
                  <h3 className="mt-6 text-lg md:text-xl font-bold text-foreground tracking-tight leading-snug">
                    {s.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {s.desc}
                  </p>

                  {/* Arrow to next step (mobile inline cue) */}
                  {i < items.length - 1 && (
                    <div className="lg:hidden mt-5 flex items-center gap-2 text-xs font-semibold text-primary/80">
                      <span>Next</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </div>

        {/*
          Step-by-step FAQ — one question per step in the journey above.
          Mirrors the same accent palette so each accordion item visually
          ties back to its matching step card.
        */}
        <div
          className={`mt-20 md:mt-24 max-w-3xl mx-auto ${motion.enter}`}
          style={{ animationDelay: '320ms' }}
        >
          <div className="text-center mb-8 md:mb-10">
            <h3 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
              {t('howItWorks.faq_title')}
            </h3>
            <p className="text-muted-foreground mt-3 text-sm md:text-base leading-relaxed">
              {t('howItWorks.faq_subtitle')}
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-3">
            {items.map((s, i) => (
              <AccordionItem
                key={i}
                value={`step-${i + 1}`}
                className={[
                  'group',
                  radius.tile,
                  border.base,
                  surface.card,
                  'px-5 md:px-6',
                  motion.transition,
                  border.hover,
                  // Open state — uses the same primary-tinted border + lifted shadow as hover on tiles
                  'data-[state=open]:bg-card',
                  'data-[state=open]:border-primary/40',
                  'data-[state=open]:shadow-2xl',
                ].join(' ')}
              >
                <AccordionTrigger className="text-left hover:no-underline py-5 [&>svg]:text-muted-foreground [&[data-state=open]>svg]:text-primary motion-safe:transition-colors">
                  <span className="flex items-center gap-4 min-w-0">
                    {/* Mini step badge — reuses the canonical iconPlate token
                        (same gradient, radius, shadow, and motion as the step
                        card above) so the FAQ row aligns visually with its
                        matching tile. */}
                    <span
                      style={{ ['--glow' as string]: accents[s.accent].glow }}
                      className={`shrink-0 ${iconPlate(s.accent, 'sm')} group-hover:shadow-[0_0_40px_-12px_rgba(var(--glow),0.55)] group-data-[state=open]:shadow-[0_0_40px_-12px_rgba(var(--glow),0.55)]`}
                      aria-hidden="true"
                    >
                      <s.Icon size={20} strokeWidth={1.75} absoluteStrokeWidth className="text-white" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-mono font-bold tracking-[0.2em] text-muted-foreground/80 mb-0.5">
                        STEP 0{i + 1}
                      </span>
                      <span className="block font-bold text-foreground text-sm md:text-base leading-snug">
                        {t(`howItWorks.faq_step${i + 1}_q`)}
                      </span>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-5 ps-[3.75rem] text-sm md:text-base">
                  {t(`howItWorks.faq_step${i + 1}_a`)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
