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
    <section id="consultants" className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('consultants.title')}</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">{t('consultants.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {mockConsultants.map((c, i) => (
            <div key={i} className="rounded-2xl bg-card border border-border/50 p-6 hover:shadow-premium transition-all duration-300 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                  {c.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-foreground text-sm truncate">{c.name}</h4>
                  <p className="text-xs text-muted-foreground truncate">{c.role}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 mb-3">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-semibold text-foreground">{c.rating}</span>
                <span className="text-xs text-muted-foreground">({c.reviews})</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {c.badges.map((badge) => {
                  const config = badgeConfig[badge];
                  if (!config) return null;
                  const BadgeIcon = config.icon;
                  return (
                    <span key={badge} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted">
                      <BadgeIcon className={`w-3 h-3 ${config.color}`} />
                      {t(`consultants.${badge}`)}
                    </span>
                  );
                })}
              </div>

              <div className="mt-auto flex items-center justify-between">
                <div>
                  <span className="text-lg font-bold text-foreground">${c.rate}</span>
                  <span className="text-xs text-muted-foreground">{t('consultants.per_hour')}</span>
                </div>
                {c.available && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    {t('consultants.available')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-10">
          <Button variant="outline" size="lg">{t('consultants.view_all')}</Button>
        </div>
      </div>
    </section>
  );
}
