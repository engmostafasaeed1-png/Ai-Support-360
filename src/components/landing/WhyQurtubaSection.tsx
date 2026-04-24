import { useTranslation } from 'react-i18next';
import { Sparkles, BadgeCheck, Languages, ShieldHalf, Radio, Gauge, ArrowUpRight } from 'lucide-react';
import aiMatching from '@/assets/why/ai-matching.jpg';
import verifiedExperts from '@/assets/why/verified-experts.jpg';
import bilingual from '@/assets/why/bilingual.jpg';
import security from '@/assets/why/security.jpg';
import collaboration from '@/assets/why/collaboration.jpg';
import sla from '@/assets/why/sla.jpg';

type Feature = {
  Icon: typeof Sparkles;
  image: string;
  accent: string; // tailwind gradient classes
  size: string;   // grid span classes
  tag: string;
};

const features: Feature[] = [
  { Icon: Sparkles,    image: aiMatching,       accent: 'from-cyan-500/80 to-blue-600/80',     size: 'lg:col-span-2 lg:row-span-2', tag: '01' },
  { Icon: BadgeCheck,  image: verifiedExperts,  accent: 'from-emerald-500/80 to-teal-600/80',  size: 'lg:col-span-1 lg:row-span-1', tag: '02' },
  { Icon: Languages,   image: bilingual,        accent: 'from-amber-500/80 to-orange-600/80',  size: 'lg:col-span-1 lg:row-span-1', tag: '03' },
  { Icon: ShieldHalf,  image: security,         accent: 'from-indigo-500/80 to-purple-600/80', size: 'lg:col-span-1 lg:row-span-2', tag: '04' },
  { Icon: Radio,       image: collaboration,    accent: 'from-rose-500/80 to-pink-600/80',     size: 'lg:col-span-1 lg:row-span-1', tag: '05' },
  { Icon: Gauge,       image: sla,              accent: 'from-sky-500/80 to-cyan-600/80',      size: 'lg:col-span-1 lg:row-span-1', tag: '06' },
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
      {/* Decorative mesh background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] animate-mesh-shift" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[140px] animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-14 md:mb-20 max-w-3xl mx-auto animate-fade-in-up">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-foreground/5 border border-border/60 text-foreground/80 text-xs font-bold tracking-[0.2em] uppercase mb-5 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-soft" />
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

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[260px] gap-4 md:gap-5 max-w-7xl mx-auto">
          {items.map((f, i) => (
            <article
              key={i}
              style={{ animationDelay: `${i * 80}ms` }}
              className={`group relative overflow-hidden rounded-3xl border border-border/40 bg-card shadow-sm hover:shadow-2xl transition-all duration-700 hover:-translate-y-1 animate-fade-in-up ${f.size}`}
            >
              {/* Background image */}
              <img
                src={f.image}
                alt=""
                width={1024}
                height={768}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-110"
              />

              {/* Gradient color overlay */}
              <div className={`absolute inset-0 bg-gradient-to-br ${f.accent} mix-blend-multiply opacity-90 transition-opacity duration-500 group-hover:opacity-80`} />

              {/* Bottom dark gradient for text legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

              {/* Top index tag */}
              <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/70">{f.tag}</span>
                <div className="w-8 h-8 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center group-hover:bg-white/25 transition-colors">
                  <ArrowUpRight className="w-4 h-4 text-white group-hover:rotate-45 transition-transform duration-500" />
                </div>
              </div>

              {/* Icon */}
              <div className="absolute top-5 left-5 z-10">
                <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-xl border border-white/25 flex items-center justify-center shadow-xl group-hover:scale-110 group-hover:bg-white/25 transition-all duration-500">
                  <f.Icon className="w-6 h-6 text-white" strokeWidth={2.2} />
                </div>
              </div>

              {/* Content */}
              <div className="absolute bottom-0 left-0 right-0 p-6 md:p-7 z-10">
                <h3 className="text-xl md:text-2xl font-bold text-white mb-2 leading-tight tracking-tight">
                  {f.title}
                </h3>
                <p className="text-sm text-white/85 leading-relaxed line-clamp-3 group-hover:text-white transition-colors">
                  {f.desc}
                </p>
              </div>

              {/* Hover ring */}
              <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/0 group-hover:ring-white/30 transition-all duration-500 pointer-events-none" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
