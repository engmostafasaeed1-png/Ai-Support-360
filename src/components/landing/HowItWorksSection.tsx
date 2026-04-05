import { useTranslation } from 'react-i18next';
import { FileText, Brain, MessageSquare, Star } from 'lucide-react';

const stepIcons = [FileText, Brain, MessageSquare, Star];

export default function HowItWorksSection() {
  const { t } = useTranslation();

  const steps = [1, 2, 3, 4].map((n) => ({
    title: t(`howItWorks.step${n}_title`),
    desc: t(`howItWorks.step${n}_desc`),
    Icon: stepIcons[n - 1],
  }));

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('howItWorks.title')}</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">{t('howItWorks.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-4 gap-8 max-w-5xl mx-auto">
          {steps.map((step, i) => (
            <div key={i} className="relative text-center">
              {i < 3 && (
                <div className="hidden md:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-accent/40 to-accent/10" />
              )}
              <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-5 relative z-10">
                <step.Icon className="w-7 h-7 text-primary-foreground" />
              </div>
              <span className="inline-block text-xs font-bold text-accent mb-2">0{i + 1}</span>
              <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
