import { useTranslation } from 'react-i18next';
import { Brain, ShieldCheck, Globe, Lock, Video, Timer } from 'lucide-react';

const featureIcons = [Brain, ShieldCheck, Globe, Lock, Video, Timer];

export default function WhyQurtubaSection() {
  const { t } = useTranslation();

  const features = [1, 2, 3, 4, 5, 6].map((n) => ({
    title: t(`whyQurtuba.feature${n}_title`),
    desc: t(`whyQurtuba.feature${n}_desc`),
    Icon: featureIcons[n - 1],
  }));

  return (
    <section className="py-28 bg-muted/30 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.03),transparent_50%)]" />

      <div className="container mx-auto px-4 relative">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-bold tracking-widest uppercase mb-4">
            Advantages
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('whyQurtuba.title')}</h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-base md:text-lg">{t('whyQurtuba.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <div key={i} className="p-7 rounded-3xl bg-card border border-border/40 hover:border-primary/20 hover:shadow-xl transition-all duration-500 group">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <f.Icon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
