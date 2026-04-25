import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Users, CheckCircle, Clock, Eye, Zap, ShieldCheck, Bot, Activity, LogIn, Rocket, CalendarPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import GuestExploreModal from '@/components/guest/GuestExploreModal';
import { useDemoWizard } from './DemoRequestWizard';
import VideoBackground from '@/components/VideoBackground';
import heroBgAsset from '@/assets/videos/hero-bg.mp4.asset.json';
import introCollab from '@/assets/intro-collab.jpg';
import introAiPortal from '@/assets/intro-ai-portal.jpg';
import introConsultant from '@/assets/intro-consultant.jpg';

export default function HeroSection() {
  const { t } = useTranslation();
  const [exploreOpen, setExploreOpen] = useState(false);
  const demoWizard = useDemoWizard();

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

          {/* CTA Tiles */}
          <div className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-2xl mx-auto">
              {/* Get Started tile (primary) */}
              <Link to="/signup" className="group relative block">
                <div className="absolute -inset-0.5 bg-gradient-to-br from-accent via-primary to-accent rounded-2xl blur opacity-70 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative h-full rounded-2xl bg-gradient-to-br from-white to-white/95 p-5 sm:p-6 text-left shadow-2xl overflow-hidden transition-transform duration-300 group-hover:-translate-y-1">
                  {/* Decorative glow */}
                  <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-accent/20 blur-3xl group-hover:bg-accent/40 transition-colors duration-500" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-wider mb-2">
                        <Sparkles className="w-3 h-3" />
                        Free
                      </div>
                      <h3 className="text-primary text-lg sm:text-xl font-bold leading-tight">
                        {t('hero.cta_support')}
                      </h3>
                      <p className="text-primary/60 text-xs sm:text-sm mt-1 leading-snug">
                        Launch in under 2 minutes
                      </p>
                    </div>
                    <div className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                      <Rocket className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
                    </div>
                  </div>
                  <div className="relative mt-4 flex items-center gap-1.5 text-primary text-xs sm:text-sm font-semibold">
                    Get started
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>

              {/* Login tile (glass) */}
              <Link to="/login" className="group relative block">
                <div className="absolute -inset-0.5 bg-gradient-to-br from-white/30 via-white/10 to-white/30 rounded-2xl blur opacity-40 group-hover:opacity-80 transition-opacity duration-500" />
                <div className="relative h-full rounded-2xl bg-white/8 backdrop-blur-xl border border-white/20 p-5 sm:p-6 text-left overflow-hidden transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-white/12 group-hover:border-white/30">
                  <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-white/10 blur-3xl group-hover:bg-white/20 transition-colors duration-500" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-primary-foreground/80 text-[10px] font-bold uppercase tracking-wider mb-2">
                        <ShieldCheck className="w-3 h-3" />
                        Secure
                      </div>
                      <h3 className="text-primary-foreground text-lg sm:text-xl font-bold leading-tight">
                        Sign in
                      </h3>
                      <p className="text-primary-foreground/60 text-xs sm:text-sm mt-1 leading-snug">
                        Welcome back to your portal
                      </p>
                    </div>
                    <div className="shrink-0 w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-300">
                      <LogIn className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
                    </div>
                  </div>
                  <div className="relative mt-4 flex items-center gap-1.5 text-primary-foreground text-xs sm:text-sm font-semibold">
                    Continue
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            </div>

            {/* Secondary actions */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm">
              <Link to="/signup?role=consultant" className="text-primary-foreground/70 hover:text-primary-foreground underline-offset-4 hover:underline transition-colors">
                {t('hero.cta_consultant')}
              </Link>
              <span className="text-primary-foreground/30">•</span>
              <button
                onClick={() => demoWizard.open('live')}
                className="inline-flex items-center gap-1.5 text-primary-foreground/90 hover:text-primary-foreground transition-colors font-semibold"
              >
                <CalendarPlus className="w-4 h-4" />
                Request a demo
              </button>
              <span className="text-primary-foreground/30">•</span>
              <button
                onClick={() => setExploreOpen(true)}
                className="inline-flex items-center gap-1.5 text-primary-foreground/70 hover:text-primary-foreground transition-colors"
              >
                <Eye className="w-4 h-4" />
                {t('guest.explore_btn')}
              </button>
            </div>
          </div>
          <GuestExploreModal open={exploreOpen} onOpenChange={setExploreOpen} />
        </div>

        {/* Modern image showcase */}
        <div className="relative mt-10 sm:mt-16 md:mt-20 max-w-6xl mx-auto animate-fade-in" style={{ animationDelay: '0.5s' }}>
          {/* Animated mesh backdrop — softer on mobile */}
          <div aria-hidden className="pointer-events-none absolute -inset-4 sm:-inset-10 md:-inset-16 -z-10 overflow-hidden">
            <div className="absolute top-0 left-1/4 w-[60%] sm:w-[55%] h-[60%] sm:h-[70%] rounded-full bg-[radial-gradient(circle_at_center,hsl(var(--accent)/0.45),transparent_60%)] blur-2xl sm:blur-3xl animate-mesh-shift" />
            <div className="absolute bottom-0 right-1/4 w-[60%] sm:w-[55%] h-[60%] sm:h-[70%] rounded-full bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.45),transparent_60%)] blur-2xl sm:blur-3xl animate-mesh-shift-alt" style={{ animationDelay: '-4s' }} />
            <div className="hidden sm:block absolute top-1/3 right-0 w-[40%] h-[55%] rounded-full bg-[radial-gradient(circle_at_center,hsl(200_90%_60%/0.35),transparent_60%)] blur-3xl animate-mesh-shift" style={{ animationDelay: '-8s' }} />
          </div>

          <div className="grid grid-cols-12 gap-2.5 sm:gap-3 md:gap-4">
            {/* Main collab image */}
            <div className="col-span-12 md:col-span-7 relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-accent/40 via-primary/30 to-accent/40 rounded-2xl sm:rounded-3xl blur-lg sm:blur-xl opacity-50 sm:opacity-60 group-hover:opacity-90 transition-opacity duration-500" />
              <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden border border-white/15 shadow-xl sm:shadow-2xl aspect-[3/2] sm:aspect-[16/10]">
                <img
                  src={introCollab}
                  alt="SAP consulting team collaborating with AI dashboards"
                  loading="lazy"
                  decoding="async"
                  width={1280}
                  height={896}
                  sizes="(max-width: 768px) 100vw, 60vw"
                  className="absolute inset-0 w-full h-full object-cover object-[center_35%] sm:object-center transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 sm:via-transparent to-transparent" />
                {/* Light sweep */}
                <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="absolute -inset-y-8 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent blur-xl animate-light-sweep" />
                </div>
                {/* Floating live badge */}
                <div className="absolute top-2.5 left-2.5 sm:top-4 sm:left-4 inline-flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/20 text-white text-[10px] sm:text-xs font-medium">
                  <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-emerald-400" />
                  </span>
                  <span className="hidden xs:inline">Live expert collaboration</span>
                  <span className="xs:hidden">Live</span>
                </div>
                {/* Bottom caption */}
                <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:bottom-4 sm:left-4 sm:right-4 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white/70 text-[9px] sm:text-[11px] uppercase tracking-widest font-semibold">SAP S/4HANA</p>
                    <p className="text-white text-sm sm:text-base md:text-lg font-semibold leading-tight truncate">Real consultants. Real outcomes.</p>
                  </div>
                  <div className="hidden sm:flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 backdrop-blur-md border border-white/15">
                    <Activity className="w-3.5 h-3.5 text-accent" />
                    <span className="text-white text-[11px] font-medium">98% SLA</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right column — side-by-side on mobile, stacked on desktop */}
            <div className="col-span-12 md:col-span-5 grid grid-cols-2 md:grid-cols-1 gap-2.5 sm:gap-3 md:gap-4">
              {/* AI portal */}
              <div className="relative group rounded-2xl sm:rounded-3xl overflow-hidden border border-white/15 shadow-lg sm:shadow-xl aspect-square sm:aspect-[4/3] md:aspect-auto md:flex-1 md:min-h-[180px]">
                <img
                  src={introAiPortal}
                  alt="AI-powered SAP support portal"
                  loading="lazy"
                  decoding="async"
                  width={1024}
                  height={1024}
                  sizes="(max-width: 768px) 50vw, 35vw"
                  className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/80 via-primary/30 to-transparent" />
                <div className="absolute top-2 right-2 sm:top-3 sm:right-3 inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-white text-[9px] sm:text-[10px] font-semibold">
                  <Bot className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-accent" />
                  AI Triage
                </div>
                <div className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">Smart ticket routing</p>
                  <p className="hidden sm:block text-white/70 text-[11px]">Resolved 3× faster with AI</p>
                </div>
              </div>

              {/* Consultant portrait */}
              <div className="relative group rounded-2xl sm:rounded-3xl overflow-hidden border border-white/15 shadow-lg sm:shadow-xl aspect-square sm:aspect-[4/3] md:aspect-auto md:flex-1 md:min-h-[180px]">
                <img
                  src={introConsultant}
                  alt="Certified SAP consultant on call"
                  loading="lazy"
                  decoding="async"
                  width={1024}
                  height={1280}
                  sizes="(max-width: 768px) 50vw, 35vw"
                  className="absolute inset-0 w-full h-full object-cover object-[center_25%] sm:object-[center_30%] transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute top-2 left-2 sm:top-3 sm:left-3 inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-emerald-500/25 backdrop-blur-md border border-emerald-400/40 text-emerald-100 text-[9px] sm:text-[10px] font-semibold">
                  <ShieldCheck className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                  Vetted
                </div>
                <div className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
                  <p className="text-white text-xs sm:text-sm font-semibold leading-tight">On-demand SAP talent</p>
                  <p className="hidden sm:block text-white/70 text-[11px]">500+ certified consultants</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mt-12 sm:mt-16 max-w-4xl mx-auto">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="text-center p-4 sm:p-6 md:p-7 rounded-2xl sm:rounded-3xl bg-white/8 backdrop-blur-xl border border-white/10 animate-fade-in hover:bg-white/12 transition-all duration-500 hover:scale-[1.03] group hover:border-white/20"
              style={{ animationDelay: `${0.6 + i * 0.1}s` }}
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
