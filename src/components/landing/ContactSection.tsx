import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Send, CheckCircle } from 'lucide-react';

export default function ContactSection() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <section className="py-28 bg-muted/30 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(var(--primary)/0.04),transparent_60%)]" />
      <div className="container mx-auto px-4 relative">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <span className="inline-block px-4 py-1.5 rounded-full bg-primary/5 text-primary text-xs font-bold tracking-widest uppercase mb-4">
              Contact
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">{t('contact.title')}</h2>
            <p className="text-muted-foreground mt-4 text-base md:text-lg">{t('contact.subtitle')}</p>
          </div>

          {submitted ? (
            <div className="text-center p-12 rounded-3xl bg-card border border-primary/15 shadow-xl">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-10 h-10 text-primary" />
              </div>
              <p className="text-xl font-bold text-foreground">{t('contact.success')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 p-8 md:p-10 rounded-3xl bg-card border border-border/40 shadow-xl">
              <div className="grid md:grid-cols-2 gap-4">
                <Input placeholder={t('contact.name')} required className="rounded-xl h-12 bg-muted/30 border-border/40" />
                <Input type="email" placeholder={t('contact.email')} required className="rounded-xl h-12 bg-muted/30 border-border/40" />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input placeholder={t('contact.company')} className="rounded-xl h-12 bg-muted/30 border-border/40" />
                <Input placeholder={t('contact.phone')} className="rounded-xl h-12 bg-muted/30 border-border/40" />
              </div>
              <Textarea placeholder={t('contact.message')} rows={4} className="rounded-xl bg-muted/30 border-border/40" />
              <Button type="submit" size="lg" className="w-full gradient-primary border-0 h-14 rounded-2xl font-semibold text-base shadow-lg">
                {t('contact.submit')}
                <Send className="w-4 h-4 ms-2" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
