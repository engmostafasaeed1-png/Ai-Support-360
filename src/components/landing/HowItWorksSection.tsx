import { useTranslation } from 'react-i18next';
import { FileText, Brain, MessageSquare, Star, ArrowRight } from 'lucide-react';

type Step = {
  Icon: typeof FileText;
  /** Tailwind gradient stops for the icon tile (matches the Why Choose Us palette). */
  accent: string;
  /** Soft glow color (uses HSL with alpha) shown behind the icon on hover. */
  glow: string;
};

const steps: Step[] = [
  { Icon: FileText,      accent: 'from-cyan-500 to-blue-600',      glow: 'shadow-[0_0_60px_-15px_rgba(59,130,246,0.55)]' },
  { Icon: Brain,         accent: 'from-violet-500 to-purple-600',  glow: 'shadow-[0_0_60px_-15px_rgba(139,92,246,0.55)]' },
  { Icon: MessageSquare, accent: 'from-amber-500 to-orange-600',   glow: 'shadow-[0_0_60px_-15px_rgba(245,158,11,0.55)]' },
  { Icon: Star,          accent: 'from-emerald-500 to-teal-600',   glow: 'shadow-[0_0_60px_-15px_rgba(16,185,129,0.55)]' },
];

export default function HowItWorksSection() {
  const { t } = useTranslation();

  const items = steps.map((s, i) => ({
    ...s,
    title: t(`howItWorks.step${i + 1}_title`),
    desc: t(`howItWorks.step${i + 1}_desc`),
  }));

  return (
    <section className="relative py-24 md:py-32 overflow-hidden bg-background">
      {/* Decorative background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 -left-32 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 -right-32 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[160px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-16 md:mb-20 max-w-3xl mx-auto motion-safe:animate-fade-in-up">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-foreground/5 border border-border/60 text-foreground/80 text-xs font-bold tracking-[0.2em] uppercase mb-5 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse-soft" />
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
                className="relative motion-safe:animate-fade-in-up"
              >
                <article className="group relative h-full rounded-3xl border border-border/60 bg-card/70 backdrop-blur-sm p-6 md:p-7 motion-safe:transition-all motion-safe:duration-500 hover:border-primary/40 hover:bg-card hover:-translate-y-1 hover:shadow-2xl">
                  {/* Subtle gradient sheen on hover */}
                  <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-500 pointer-events-none bg-gradient-to-br from-primary/[0.04] via-transparent to-accent/[0.04]" />

                  {/* Floating step number badge */}
                  <div className="absolute -top-3 right-6 z-10">
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-background border border-border text-[11px] font-mono font-bold tracking-widest text-foreground/70 shadow-sm">
                      0{i + 1}
                    </span>
                  </div>

                  {/* Icon tile */}
                  <div className="relative inline-flex">
                    <div
                      className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${s.accent} flex items-center justify-center shadow-lg motion-safe:transition-all motion-safe:duration-500 motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-105 group-hover:${s.glow}`}
                    >
                      <s.Icon size={28} strokeWidth={1.75} absoluteStrokeWidth className="text-white" aria-hidden="true" />
                    </div>
                    {/* Tiny dot accent */}
                    <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-background border-2 border-primary motion-safe:animate-pulse-soft" />
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
      </div>
    </section>
  );
}
