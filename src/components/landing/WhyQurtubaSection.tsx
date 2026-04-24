import { useTranslation } from 'react-i18next';
import { Wand2, ShieldCheck, Languages, Lock, Users, Activity, ArrowUpRight } from 'lucide-react';
import BlurImage from './BlurImage';
import aiMatching from '@/assets/why/ai-matching.jpg';
import aiMatchingBlur from '@/assets/why/blur/ai-matching-blur.jpg';
import verifiedExperts from '@/assets/why/verified-experts.jpg';
import verifiedExpertsBlur from '@/assets/why/blur/verified-experts-blur.jpg';
import bilingual from '@/assets/why/bilingual.jpg';
import bilingualBlur from '@/assets/why/blur/bilingual-blur.jpg';
import security from '@/assets/why/security.jpg';
import securityBlur from '@/assets/why/blur/security-blur.jpg';
import collaboration from '@/assets/why/collaboration.jpg';
import collaborationBlur from '@/assets/why/blur/collaboration-blur.jpg';
import sla from '@/assets/why/sla.jpg';
import slaBlur from '@/assets/why/blur/sla-blur.jpg';

type Feature = {
  Icon: typeof Wand2;
  image: string;
  blur: string;
  accent: string; // tailwind gradient classes
  /**
   * Responsive grid spans. Each tile defines spans per breakpoint so
   * the layout stays balanced (and never crops images) at every width.
   * - mobile (default): 1 col, auto height
   * - md (2 cols): hero tile spans both columns
   * - lg (4 cols): bento layout
   */
  size: string;
  /** Min-height per breakpoint to prevent overlap when images load. */
  height: string;
  tag: string;
};

// Unified Lucide outline set — same family, same stroke weight, same size
// (set on the icon below) so every tile reads as one coherent system.
const features: Feature[] = [
  { Icon: Wand2,       image: aiMatching,      blur: aiMatchingBlur,      accent: 'from-cyan-500/80 to-blue-600/80',     size: 'md:col-span-2 lg:col-span-2 lg:row-span-2', height: 'min-h-[320px] md:min-h-[360px] lg:min-h-0',          tag: '01' },
  { Icon: ShieldCheck, image: verifiedExperts, blur: verifiedExpertsBlur, accent: 'from-emerald-500/80 to-teal-600/80',  size: 'md:col-span-1 lg:col-span-1 lg:row-span-1', height: 'min-h-[260px] lg:min-h-0',                            tag: '02' },
  { Icon: Languages,   image: bilingual,       blur: bilingualBlur,       accent: 'from-amber-500/80 to-orange-600/80',  size: 'md:col-span-1 lg:col-span-1 lg:row-span-1', height: 'min-h-[260px] lg:min-h-0',                            tag: '03' },
  { Icon: Lock,        image: security,        blur: securityBlur,        accent: 'from-indigo-500/80 to-purple-600/80', size: 'md:col-span-2 lg:col-span-1 lg:row-span-2', height: 'min-h-[280px] md:min-h-[320px] lg:min-h-0',          tag: '04' },
  { Icon: Users,       image: collaboration,   blur: collaborationBlur,   accent: 'from-rose-500/80 to-pink-600/80',     size: 'md:col-span-1 lg:col-span-1 lg:row-span-1', height: 'min-h-[260px] lg:min-h-0',                            tag: '05' },
  { Icon: Activity,    image: sla,             blur: slaBlur,             accent: 'from-sky-500/80 to-cyan-600/80',      size: 'md:col-span-1 lg:col-span-1 lg:row-span-1', height: 'min-h-[260px] lg:min-h-0',                            tag: '06' },
];

export default function WhyQurtubaSection() {
  const { t } = useTranslation();

  const items = features.map((f, i) => ({
    ...f,
    title: t(`whyQurtuba.feature${i + 1}_title`),
    desc: t(`whyQurtuba.feature${i + 1}_desc`),
  }));

  return (
    <section className="py-20 md:py-32 bg-background relative overflow-hidden">
      {/* Decorative mesh background — animation only when motion is allowed */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-14 md:mb-20 max-w-3xl mx-auto motion-safe:animate-fade-in-up">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-foreground/5 border border-border/60 text-foreground/80 text-xs font-bold tracking-[0.2em] uppercase mb-5 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse-soft" />
            Why Choose Us
          </span>
          <h2 className="text-4xl md:text-6xl font-black text-foreground tracking-tight leading-[1.05]">
            Built for the way{' '}
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              modern SAP teams
            </span>{' '}
            actually work
          </h2>
          <p className="text-muted-foreground mt-6 text-base md:text-lg leading-relaxed">
            {t('whyQurtuba.subtitle')}
          </p>
        </div>

        {/*
          Bento grid
          - 1 col on mobile (auto-flowing, each card uses its own min-height)
          - 2 cols on md (hero + security span 2 cols, others 1)
          - 4 cols × fixed 260px rows on lg+ for the true bento look
        */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[260px] gap-4 md:gap-5 max-w-7xl mx-auto">
          {items.map((f, i) => (
            <article
              key={i}
              // Stagger only applies when motion is allowed; reduced-motion users
              // get an instant, fully-visible card with no transform/opacity dance.
              style={{ animationDelay: `${i * 80}ms` }}
              className={`group relative isolate overflow-hidden rounded-3xl border border-border/40 bg-card shadow-sm hover:shadow-2xl motion-safe:transition-all motion-safe:duration-700 motion-safe:hover:-translate-y-1 motion-safe:animate-fade-in-up ${f.size} ${f.height}`}
            >
              {/* Background image with blur-up placeholder */}
              <BlurImage
                src={f.image}
                blurSrc={f.blur}
                alt=""
                width={1024}
                height={768}
                className="absolute inset-0 w-full h-full object-cover motion-safe:transition-transform motion-safe:duration-[1200ms] motion-safe:ease-out motion-safe:group-hover:scale-110"
              />

              {/* Gradient color overlay */}
              <div className={`absolute inset-0 bg-gradient-to-br ${f.accent} mix-blend-multiply opacity-90 motion-safe:transition-opacity motion-safe:duration-500 motion-safe:group-hover:opacity-80 pointer-events-none`} />

              {/* Bottom dark gradient for text legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10 pointer-events-none" />

              {/*
                Content layer — flex column instead of absolute positioning so
                the icon (top) and title/desc (bottom) can never overlap, even
                when the description wraps to many lines on narrow tiles.
              */}
              <div className="relative z-10 h-full flex flex-col p-5 sm:p-6 md:p-7">
                {/* Top row: icon + tag/arrow */}
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 rounded-2xl bg-white/15 backdrop-blur-xl border border-white/25 flex items-center justify-center shadow-xl motion-safe:transition-all motion-safe:duration-500 motion-safe:group-hover:scale-110 group-hover:bg-white/25">
                    <f.Icon size={22} strokeWidth={1.75} absoluteStrokeWidth className="text-white sm:[&]:w-6 sm:[&]:h-6" aria-hidden="true" />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/70">{f.tag}</span>
                    <div className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center group-hover:bg-white/25 motion-safe:transition-colors">
                      <ArrowUpRight className="w-4 h-4 text-white motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:rotate-45" />
                    </div>
                  </div>
                </div>

                {/* Spacer pushes copy to bottom */}
                <div className="flex-1" />

                {/* Bottom: title + description */}
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-white mb-2 leading-tight tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-sm text-white/85 leading-relaxed line-clamp-3 group-hover:text-white motion-safe:transition-colors">
                    {f.desc}
                  </p>
                </div>
              </div>

              {/* Hover ring */}
              <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/0 group-hover:ring-white/30 motion-safe:transition-all motion-safe:duration-500 pointer-events-none" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
