import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Users, CheckCircle, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function HeroSection() {
  const { t } = useTranslation();

  const stats = [
    { value: '500+', label: t('hero.stat_consultants'), icon: Users },
    { value: '12,000+', label: t('hero.stat_tickets'), icon: CheckCircle },
    { value: '98%', label: t('hero.stat_satisfaction'), icon: Sparkles },
    { value: '<15 min', label: t('hero.stat_response'), icon: Clock },
  ];

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 gradient-primary opacity-[0.03]" />
      <div className="absolute top-20 -right-32 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 -left-32 w-80 h-80 bg-primary/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />

      <div className="container mx-auto px-4 pt-20 pb-16 relative">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent text-sm font-medium animate-fade-in">
            <Sparkles className="w-4 h-4" />
            {t('hero.badge')}
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <span className="text-foreground">{t('hero.title1')}</span>
            <br />
            <span className="gradient-text">{t('hero.title2')}</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
            {t('hero.subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <Link to="/signup">
              <Button size="lg" className="gradient-primary border-0 text-base px-8 h-12 shadow-premium">
                {t('hero.cta_support')}
                <ArrowRight className="w-4 h-4 ms-2" />
              </Button>
            </Link>
            <Link to="/signup?role=consultant">
              <Button size="lg" variant="outline" className="text-base px-8 h-12">
                {t('hero.cta_consultant')}
              </Button>
            </Link>
            <Button
              size="lg"
              variant="ghost"
              className="text-base"
              onClick={() => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('hero.cta_explore')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 max-w-4xl mx-auto">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="text-center p-6 rounded-2xl glass-card animate-fade-in"
              style={{ animationDelay: `${0.4 + i * 0.1}s` }}
            >
              <stat.icon className="w-5 h-5 text-accent mx-auto mb-2" />
              <div className="text-2xl md:text-3xl font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
