import { useTranslation } from 'react-i18next';
import { Star, Quote } from 'lucide-react';

const testimonials = [
  { name: 'Khalid Al-Otaibi', role: 'CIO, Saudi Petrochemical Corp', text: 'The platform matched us with an S/4HANA expert in under 10 minutes. Our migration issue was resolved in a single session. Outstanding service.', rating: 5 },
  { name: 'Noura Al-Saud', role: 'IT Director, Riyadh National Bank', text: 'The bilingual support is a game-changer for our team. Arabic consultants who understand Saudi banking regulations and SAP FI/CO deeply.', rating: 5 },
  { name: 'James Mitchell', role: 'VP Technology, GCC Retail Group', text: 'We moved our entire SAP support here. The AI matching, SLA tracking, and consultant quality are enterprise-grade. Highly recommended.', rating: 5 },
];

export default function TestimonialsSection() {
  const { t } = useTranslation();

  return (
    <section className="py-28">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-bold tracking-widest uppercase mb-4">
            Testimonials
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('testimonials.title')}</h2>
          <p className="text-muted-foreground mt-4 text-base md:text-lg">{t('testimonials.subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((item, i) => (
            <div key={i} className="p-7 rounded-3xl bg-card border border-border/40 hover:shadow-xl hover:border-primary/15 transition-all duration-500 relative group">
              <Quote className="w-8 h-8 text-primary/10 absolute top-6 end-6" />
              <div className="flex gap-0.5 mb-5">
                {Array.from({ length: item.rating }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ))}
              </div>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">"{item.text}"</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                  {item.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
