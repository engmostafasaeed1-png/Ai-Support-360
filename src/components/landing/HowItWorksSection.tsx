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
    <section className="py-28">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/5 text-primary text-xs font-bold tracking-widest uppercase mb-4">
            Process
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('howItWorks.title')}</h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-base md:text-lg">{t('howItWorks.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-4 gap-8 max-w-5xl mx-auto">
          {steps.map((step, i) => (
            <div key={i} className="relative text-center group">
              {i < 3 && (
                <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-px bg-gradient-to-r from-primary/30 to-transparent" />
              )}
              <div className="w-20 h-20 rounded-3xl gradient-primary flex items-center justify-center mx-auto mb-6 relative z-10 shadow-xl group-hover:scale-110 transition-transform duration-300">
                <step.Icon className="w-8 h-8 text-primary-foreground" />
              </div>
              <span className="inline-block text-[11px] font-black text-primary mb-2 tracking-widest">STEP 0{i + 1}</span>
              <h3 className="text-lg font-bold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
