import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Send } from 'lucide-react';

export default function ContactSection() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('contact.title')}</h2>
            <p className="text-muted-foreground mt-3">{t('contact.subtitle')}</p>
          </div>

          {submitted ? (
            <div className="text-center p-10 rounded-2xl bg-card border border-accent/30">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                <Send className="w-7 h-7 text-accent" />
              </div>
              <p className="text-lg font-semibold text-foreground">{t('contact.success')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 p-8 rounded-2xl bg-card border border-border/50 shadow-premium">
              <div className="grid md:grid-cols-2 gap-4">
                <Input placeholder={t('contact.name')} required className="rounded-xl h-12" />
                <Input type="email" placeholder={t('contact.email')} required className="rounded-xl h-12" />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input placeholder={t('contact.company')} className="rounded-xl h-12" />
                <Input placeholder={t('contact.phone')} className="rounded-xl h-12" />
              </div>
              <Textarea placeholder={t('contact.message')} rows={4} className="rounded-xl" />
              <Button type="submit" size="lg" className="w-full gradient-primary border-0 h-12">
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
