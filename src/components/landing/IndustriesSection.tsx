import { useTranslation } from 'react-i18next';
import { Fuel, Landmark, ShoppingBag, HeartPulse, Factory, Building2, RadioTower, Truck } from 'lucide-react';
import SectionHeader from './SectionHeader';

type IndustryDef = {
  key: string;
  Icon: typeof Fuel;
  /** Tailwind gradient stops for the icon tile */
  accent: string;
};

const industries: IndustryDef[] = [
  { key: 'oil',           Icon: Fuel,         accent: 'from-amber-500 to-orange-600' },
  { key: 'banking',       Icon: Landmark,     accent: 'from-emerald-500 to-teal-600' },
  { key: 'retail',        Icon: ShoppingBag,  accent: 'from-rose-500 to-pink-600' },
  { key: 'healthcare',    Icon: HeartPulse,   accent: 'from-cyan-500 to-blue-600' },
  { key: 'manufacturing', Icon: Factory,      accent: 'from-orange-500 to-red-600' },
  { key: 'government',    Icon: Building2,    accent: 'from-indigo-500 to-purple-600' },
  { key: 'telecom',       Icon: RadioTower,   accent: 'from-violet-500 to-fuchsia-600' },
  { key: 'logistics',     Icon: Truck,        accent: 'from-lime-500 to-emerald-600' },
];

export default function IndustriesSection() {
  const { t } = useTranslation();

  return (
    <section className="relative py-24 md:py-32 overflow-hidden bg-background">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow="Industries"
          title={
            <>
              {t('industries.title').split(' ').slice(0, -1).join(' ')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('industries.title').split(' ').slice(-1)}
              </span>
            </>
          }
          subtitle={t('industries.subtitle')}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 max-w-5xl mx-auto">
          {industries.map(({ key, Icon, accent }, i) => (
            <article
              key={key}
              style={{ animationDelay: `${i * 60}ms` }}
              className="group relative rounded-3xl border border-border/60 bg-card/70 backdrop-blur-sm p-6 motion-safe:transition-all motion-safe:duration-500 hover:border-primary/40 hover:bg-card hover:-translate-y-1 hover:shadow-2xl motion-safe:animate-fade-in-up"
            >
              {/* Hover gradient sheen */}
              <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-500 pointer-events-none bg-gradient-to-br from-primary/[0.05] via-transparent to-accent/[0.05]" />

              <div className="relative flex flex-col items-center text-center">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${accent} flex items-center justify-center shadow-lg mb-4 motion-safe:transition-all motion-safe:duration-500 motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110`}>
                  <Icon size={26} strokeWidth={1.75} absoluteStrokeWidth className="text-white" aria-hidden="true" />
                </div>
                <span className="text-sm md:text-base font-semibold text-foreground tracking-tight">
                  {t(`industries.${key}`)}
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
