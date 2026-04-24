import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, Quote } from 'lucide-react';
import SectionHeader from './SectionHeader';
import logoSaudiPetro from '@/assets/clients/saudi-petrochemical.png';
import logoRiyadhBank from '@/assets/clients/riyadh-bank.png';
import logoGccRetail from '@/assets/clients/gcc-retail.png';

type Testimonial = {
  name: string;
  role: string;
  text: string;
  rating: number;
  accent: string;
  /** Client company name, used for the logo alt text. */
  company: string;
  /** Client company logo. */
  logo: string;
};

const testimonials: Testimonial[] = [
  { name: 'Khalid Al-Otaibi', role: 'CIO, Saudi Petrochemical Corp', company: 'Saudi Petrochemical Corp', logo: logoSaudiPetro,  text: 'The platform matched us with an S/4HANA expert in under 10 minutes. Our migration issue was resolved in a single session. Outstanding service.', rating: 5, accent: 'from-cyan-500 to-blue-600' },
  { name: 'Noura Al-Saud',    role: 'IT Director, Riyadh National Bank', company: 'Riyadh National Bank',    logo: logoRiyadhBank,  text: 'The bilingual support is a game-changer for our team. Arabic consultants who understand Saudi banking regulations and SAP FI/CO deeply.', rating: 5, accent: 'from-violet-500 to-purple-600' },
  { name: 'James Mitchell',   role: 'VP Technology, GCC Retail Group',   company: 'GCC Retail Group',        logo: logoGccRetail,   text: 'We moved our entire SAP support here. The AI matching, SLA tracking, and consultant quality are enterprise-grade. Highly recommended.', rating: 5, accent: 'from-emerald-500 to-teal-600' },
];

export default function TestimonialsSection() {
  const { t } = useTranslation();

  return (
    <section className="relative py-24 md:py-32 overflow-hidden bg-background">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow="Testimonials"
          title={
            <>
              {t('testimonials.title').split(' ').slice(0, -1).join(' ')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('testimonials.title').split(' ').slice(-1)}
              </span>
            </>
          }
          subtitle={t('testimonials.subtitle')}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 max-w-6xl mx-auto">
          {testimonials.map((item, i) => (
            <article
              key={i}
              style={{ animationDelay: `${i * 90}ms` }}
              className="group relative p-7 md:p-8 rounded-3xl bg-card/70 backdrop-blur-sm border border-border/60 motion-safe:transition-all motion-safe:duration-500 hover:border-primary/40 hover:-translate-y-1 hover:shadow-2xl motion-safe:animate-fade-in-up"
            >
              {/* Subtle hover sheen */}
              <div className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-500 pointer-events-none bg-gradient-to-br from-primary/[0.04] via-transparent to-accent/[0.04]" />

              <Quote className="w-10 h-10 text-primary/15 absolute top-6 end-6 motion-safe:transition-colors group-hover:text-primary/30" aria-hidden="true" />

              <div className="relative">
                <div className="flex gap-0.5 mb-5">
                  {Array.from({ length: item.rating }).map((_, j) => (
                    <Star key={j} size={16} className="text-amber-400 fill-amber-400" aria-hidden="true" />
                  ))}
                </div>
                <p className="text-sm md:text-base text-foreground/80 mb-6 leading-relaxed">
                  &ldquo;{item.text}&rdquo;
                </p>
                <div className="flex items-center gap-3 pt-4 border-t border-border/40">
                  <ClientLogo item={item} />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.role}</p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Client company logo with a graceful initials fallback if the image
 * fails to decode. Uses the same gradient accent as the testimonial card.
 */
function ClientLogo({ item }: { item: Testimonial }) {
  const [failed, setFailed] = useState(false);
  const initials = item.name.split(' ').map((n) => n[0]).join('').slice(0, 2);

  return (
    <div
      className={`relative w-11 h-11 rounded-2xl shrink-0 overflow-hidden border border-border/40 bg-card flex items-center justify-center shadow-lg motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-110`}
    >
      {!failed ? (
        <img
          src={item.logo}
          alt={`${item.company} logo`}
          loading="lazy"
          decoding="async"
          width={88}
          height={88}
          onError={() => setFailed(true)}
          className="w-full h-full object-contain p-1.5"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${item.accent} text-white text-xs font-bold`}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
