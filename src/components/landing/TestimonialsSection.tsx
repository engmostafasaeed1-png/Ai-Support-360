import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';

const testimonials = [
  { name: 'Khalid Al-Otaibi', role: 'CIO, Saudi Petrochemical Corp', text: 'Qurtuba matched us with an S/4HANA expert in under 10 minutes. Our migration issue was resolved in a single session. Outstanding platform.', rating: 5 },
  { name: 'Noura Al-Saud', role: 'IT Director, Riyadh National Bank', text: 'The bilingual support is a game-changer for our team. Arabic consultants who understand Saudi banking regulations and SAP FI/CO deeply.', rating: 5 },
  { name: 'James Mitchell', role: 'VP Technology, GCC Retail Group', text: 'We moved our entire SAP support to Qurtuba. The AI matching, SLA tracking, and consultant quality are enterprise-grade. Highly recommended.', rating: 5 },
];

export default function TestimonialsSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('testimonials.title')}</h2>
          <p className="text-muted-foreground mt-3">{t('testimonials.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((item, i) => (
            <div key={i} className="p-6 rounded-2xl bg-card border border-border/50 hover:shadow-premium transition-all">
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: item.rating }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ))}
              </div>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">"{item.text}"</p>
              <div>
                <p className="font-semibold text-sm text-foreground">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
