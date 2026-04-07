import { useTranslation } from 'react-i18next';
import { Star, BadgeCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

const mockConsultants = [
  { name: 'Ahmed Al-Rashid', role: 'SAP S/4HANA Finance Expert', rating: 4.9, reviews: 127, rate: 150, avatar: 'AR', badges: ['verified', 'top_rated'], available: true },
  { name: 'Sarah Johnson', role: 'SAP BTP & Integration Architect', rating: 4.8, reviews: 98, rate: 175, avatar: 'SJ', badges: ['verified', 'fast_responder'], available: true },
  { name: 'Mohammed Al-Farsi', role: 'SAP MM/SD Functional Lead', rating: 4.9, reviews: 215, rate: 130, avatar: 'MF', badges: ['verified', 'top_rated'], available: false },
  { name: 'Dr. Fatima Hassan', role: 'SAP SuccessFactors & HCM', rating: 5.0, reviews: 87, rate: 200, avatar: 'FH', badges: ['verified', 'top_rated', 'fast_responder'], available: true },
];

const badgeConfig: Record<string, { icon: typeof Star; color: string }> = {
  verified: { icon: BadgeCheck, color: 'text-accent' },
  top_rated: { icon: Star, color: 'text-yellow-500' },
  fast_responder: { icon: Zap, color: 'text-green-500' },
};

export default function ConsultantsSection() {
  const { t } = useTranslation();

  return (
    <section id="consultants" className="py-28 bg-muted/30 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,hsl(var(--accent)/0.05),transparent_60%)]" />
      <div className="container mx-auto px-4 relative">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/5 text-primary text-xs font-bold tracking-widest uppercase mb-4">
            Experts
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('consultants.title')}</h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-base md:text-lg">{t('consultants.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {mockConsultants.map((c, i) => (
            <div key={i} className="rounded-3xl bg-card border border-border/40 p-6 hover:shadow-xl hover:border-primary/15 transition-all duration-500 flex flex-col group">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-base shadow-lg group-hover:scale-105 transition-transform">
                  {c.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-foreground text-sm truncate">{c.name}</h4>
                  <p className="text-xs text-muted-foreground truncate">{c.role}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 mb-4">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-bold text-foreground">{c.rating}</span>
                <span className="text-xs text-muted-foreground">({c.reviews})</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-5">
                {c.badges.map((badge) => {
                  const config = badgeConfig[badge];
                  if (!config) return null;
                  const BadgeIcon = config.icon;
                  return (
                    <span key={badge} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-muted/70 font-medium">
                      <BadgeIcon className={`w-3 h-3 ${config.color}`} />
                      {t(`consultants.${badge}`)}
                    </span>
                  );
                })}
              </div>

              <div className="mt-auto flex items-center justify-between pt-4 border-t border-border/30">
                <div>
                  <span className="text-xl font-black text-foreground">${c.rate}</span>
                  <span className="text-xs text-muted-foreground">{t('consultants.per_hour')}</span>
                </div>
                {c.available && (
                  <span className="text-xs text-green-600 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    {t('consultants.available')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Button variant="outline" size="lg" className="rounded-2xl px-8 h-12 font-semibold">{t('consultants.view_all')}</Button>
        </div>
      </div>
    </section>
  );
}
