import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Users, CheckCircle, Clock, Eye, Zap } from 'lucide-react';
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
    <section className="relative overflow-hidden min-h-[85vh] sm:min-h-[92vh] flex items-center">
      <VideoBackground
        src={heroBgAsset.url}
        overlay="gradient"
        overlayOpacity={0.88}
      />

      <div className="container mx-auto px-4 py-16 sm:py-24 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-6 sm:space-y-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-primary-foreground text-sm font-medium animate-fade-in shadow-lg">
            <Zap className="w-4 h-4 text-yellow-400" />
            {t('hero.badge')}
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <span className="text-primary-foreground">{t('hero.title1')}</span>
            <br />
            <span className="bg-gradient-to-r from-accent via-accent-foreground/80 to-primary-foreground bg-clip-text text-transparent drop-shadow-lg">{t('hero.title2')}</span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg md:text-xl text-primary-foreground/75 max-w-2xl mx-auto leading-relaxed animate-fade-in" style={{ animationDelay: '0.2s' }}>
            {t('hero.subtitle')}
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <Link to="/signup">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 text-sm sm:text-base px-6 sm:px-10 h-12 sm:h-14 shadow-2xl hover:shadow-[0_20px_40px_rgba(255,255,255,0.2)] transition-all hover:scale-105 duration-300 rounded-2xl font-semibold w-full sm:w-auto">
                {t('hero.cta_support')}
                <ArrowRight className="w-5 h-5 ms-2" />
              </Button>
            </Link>
            <Link to="/signup?role=consultant">
              <Button size="lg" variant="outline" className="text-sm sm:text-base px-6 sm:px-10 h-12 sm:h-14 border-2 border-white/25 text-primary-foreground hover:bg-white/10 backdrop-blur-sm rounded-2xl font-semibold w-full sm:w-auto">
                {t('hero.cta_consultant')}
              </Button>
            </Link>
            <Button
              size="lg"
              variant="ghost"
              className="text-base text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/10 rounded-2xl"
              onClick={() => setExploreOpen(true)}
            >
              <Eye className="w-4 h-4 me-2" />
              {t('guest.explore_btn')}
            </Button>
          </div>
          <GuestExploreModal open={exploreOpen} onOpenChange={setExploreOpen} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mt-12 sm:mt-24 max-w-4xl mx-auto">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="text-center p-4 sm:p-6 md:p-7 rounded-2xl sm:rounded-3xl bg-white/8 backdrop-blur-xl border border-white/10 animate-fade-in hover:bg-white/12 transition-all duration-500 hover:scale-[1.03] group hover:border-white/20"
              style={{ animationDelay: `${0.4 + i * 0.1}s` }}
            >
              <stat.icon className="w-5 h-5 text-accent mx-auto mb-3 group-hover:scale-110 transition-transform" />
              <div className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-foreground tracking-tight">{stat.value}</div>
              <div className="text-xs text-primary-foreground/60 mt-1.5 font-medium uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-background via-background/50 to-transparent z-10" />
    </section>
  );
}
