import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, BadgeCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SectionHeader from './SectionHeader';
import c01 from '@/assets/consultants/c01-gulf.jpg';
import c02 from '@/assets/consultants/c09-nordic.jpg';
import c07 from '@/assets/consultants/c07-pakistani.jpg';
import c08 from '@/assets/consultants/c08-moroccan.jpg';

type Consultant = {
  name: string;
  role: string;
  rating: number;
  reviews: number;
  rate: number;
  /** Initials shown as fallback if the photo fails to load. */
  avatar: string;
  /** Real portrait photo for the consultant. */
  photo: string;
  /** Gradient used for the ring + initials fallback tint. */
  accent: string;
  badges: string[];
  available: boolean;
};

const mockConsultants: Consultant[] = [
  { name: 'Ahmed Al-Rashid',  role: 'SAP S/4HANA Finance Expert',     rating: 4.9, reviews: 127, rate: 150, avatar: 'AR', photo: c01, accent: 'from-cyan-500 to-blue-600',     badges: ['verified', 'top_rated'], available: true },
  { name: 'Sarah Johnson',    role: 'SAP BTP & Integration Architect',rating: 4.8, reviews:  98, rate: 175, avatar: 'SJ', photo: c02, accent: 'from-violet-500 to-purple-600', badges: ['verified', 'fast_responder'], available: true },
  { name: 'Mohammed Al-Farsi',role: 'SAP MM/SD Functional Lead',      rating: 4.9, reviews: 215, rate: 130, avatar: 'MF', photo: c07, accent: 'from-amber-500 to-orange-600',  badges: ['verified', 'top_rated'], available: false },
  { name: 'Dr. Fatima Hassan',role: 'SAP SuccessFactors & HCM',       rating: 5.0, reviews:  87, rate: 200, avatar: 'FH', photo: c08, accent: 'from-emerald-500 to-teal-600',  badges: ['verified', 'top_rated', 'fast_responder'], available: true },
];

const badgeConfig: Record<string, { Icon: typeof Star; color: string }> = {
  verified:       { Icon: BadgeCheck, color: 'text-sky-500' },
  top_rated:      { Icon: Star,       color: 'text-amber-500' },
  fast_responder: { Icon: Zap,        color: 'text-emerald-500' },
};

export default function ConsultantsSection() {
  const { t } = useTranslation();

  return (
    <section id="consultants" className="relative py-24 md:py-32 bg-muted/30 overflow-hidden">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow="Experts"
          title={
            <>
              {t('consultants.title').split(' ').slice(0, -1).join(' ')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('consultants.title').split(' ').slice(-1)}
              </span>
            </>
          }
          subtitle={t('consultants.subtitle')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {mockConsultants.map((c, i) => (
            <article
              key={i}
              style={{ animationDelay: `${i * 80}ms` }}
              className="group relative rounded-3xl bg-card/80 backdrop-blur-sm border border-border/60 p-6 motion-safe:transition-all motion-safe:duration-500 hover:border-primary/40 hover:bg-card hover:-translate-y-1 hover:shadow-2xl flex flex-col motion-safe:animate-fade-in-up"
            >
              {/* Hover sheen */}
              <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-500 pointer-events-none bg-gradient-to-br from-primary/[0.04] via-transparent to-accent/[0.04]" />

              <div className="relative">
                <div className="flex items-center gap-3 mb-5">
                  <ConsultantAvatar c={c} />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-foreground text-sm truncate">{c.name}</h4>
                    <p className="text-xs text-muted-foreground truncate">{c.role}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mb-4">
                  <Star size={16} className="text-amber-400 fill-amber-400" aria-hidden="true" />
                  <span className="text-sm font-bold text-foreground">{c.rating}</span>
                  <span className="text-xs text-muted-foreground">({c.reviews})</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-5">
                  {c.badges.map((badge) => {
                    const config = badgeConfig[badge];
                    if (!config) return null;
                    const { Icon, color } = config;
                    return (
                      <span key={badge} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-muted/70 border border-border/40 font-medium">
                        <Icon size={12} strokeWidth={2} className={color} aria-hidden="true" />
                        {t(`consultants.${badge}`)}
                      </span>
                    );
                  })}
                </div>

                <div className="mt-auto flex items-center justify-between pt-4 border-t border-border/40">
                  <div>
                    <span className="text-xl font-black text-foreground">${c.rate}</span>
                    <span className="text-xs text-muted-foreground ms-1">{t('consultants.per_hour')}</span>
                  </div>
                  {c.available && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                      <span className="relative flex w-2 h-2">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
                        <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
                      </span>
                      {t('consultants.available')}
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="text-center mt-12">
          <Button variant="outline" size="lg" className="rounded-2xl px-8 h-12 font-semibold">
            {t('consultants.view_all')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Avatar with a real consultant portrait, gradient accent ring, and
 * graceful initials fallback. Falls back automatically if the image
 * fails to decode (e.g. asset missing or network error in the future).
 */
function ConsultantAvatar({ c }: { c: Consultant }) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative w-14 h-14 rounded-2xl p-[2px] bg-gradient-to-br ${c.accent} shadow-lg motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-3`}
    >
      <div className="relative w-full h-full rounded-[inherit] overflow-hidden bg-card flex items-center justify-center">
        {!failed ? (
          <img
            src={c.photo}
            alt={`Portrait of ${c.name}, ${c.role}`}
            loading="lazy"
            decoding="async"
            width={112}
            height={112}
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          // Fallback — gradient tile with the consultant's initials.
          <span
            aria-hidden="true"
            className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${c.accent} text-white font-bold text-base`}
          >
            {c.avatar}
          </span>
        )}
      </div>
    </div>
  );
}
