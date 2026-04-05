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
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('whyQurtuba.title')}</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">{t('whyQurtuba.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <div key={i} className="p-6 rounded-2xl bg-card border border-border/50 hover:shadow-premium transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4">
                <f.Icon className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
