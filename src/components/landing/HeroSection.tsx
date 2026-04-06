import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Users, CheckCircle, Clock, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import GuestExploreModal from '@/components/guest/GuestExploreModal';
import VideoBackground from '@/components/VideoBackground';
import heroBgAsset from '@/assets/videos/hero-bg.mp4.asset.json';

export default function HeroSection() {
  const { t } = useTranslation();
  const [exploreOpen, setExploreOpen] = useState(false);

  const stats = [
    { value: '500+', label: t('hero.stat_consultants'), icon: Users },
    { value: '12,000+', label: t('hero.stat_tickets'), icon: CheckCircle },
    { value: '98%', label: t('hero.stat_satisfaction'), icon: Sparkles },
    { value: '<15 min', label: t('hero.stat_response'), icon: Clock },
  ];

  return (
    <section className="relative overflow-hidden min-h-[90vh] flex items-center">
      <VideoBackground
        src={heroBgAsset.url}
        overlay="gradient"
        overlayOpacity={0.85}
      />

      <div className="container mx-auto px-4 py-20 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-foreground/10 backdrop-blur-sm border border-primary-foreground/20 text-primary-foreground text-sm font-medium animate-fade-in">
            <Sparkles className="w-4 h-4" />
            {t('hero.badge')}
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <span className="text-primary-foreground">{t('hero.title1')}</span>
            <br />
            <span className="text-accent-foreground/90 drop-shadow-lg">{t('hero.title2')}</span>
          </h1>

          <p className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
            {t('hero.subtitle')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <Link to="/signup">
              <Button size="lg" className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 text-base px-8 h-12 shadow-xl hover:shadow-2xl transition-all hover:scale-105 duration-300">
                {t('hero.cta_support')}
                <ArrowRight className="w-4 h-4 ms-2" />
              </Button>
            </Link>
            <Link to="/signup?role=consultant">
              <Button size="lg" variant="outline" className="text-base px-8 h-12 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 backdrop-blur-sm">
                {t('hero.cta_consultant')}
              </Button>
            </Link>
            <Button
              size="lg"
              variant="ghost"
              className="text-base text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10"
              onClick={() => setExploreOpen(true)}
            >
              <Eye className="w-4 h-4 me-2" />
              {t('guest.explore_btn')}
            </Button>
          </div>
          <GuestExploreModal open={exploreOpen} onOpenChange={setExploreOpen} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mt-20 max-w-4xl mx-auto">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="text-center p-5 md:p-6 rounded-2xl bg-primary-foreground/10 backdrop-blur-md border border-primary-foreground/15 animate-fade-in hover:bg-primary-foreground/15 transition-all duration-300 hover:scale-105 group"
              style={{ animationDelay: `${0.4 + i * 0.1}s` }}
            >
              <stat.icon className="w-5 h-5 text-accent-foreground mx-auto mb-2 group-hover:scale-110 transition-transform" />
              <div className="text-2xl md:text-3xl font-bold text-primary-foreground">{stat.value}</div>
              <div className="text-xs text-primary-foreground/70 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent z-10" />
    </section>
  );
}
