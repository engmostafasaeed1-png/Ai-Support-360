import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { Send, CheckCircle2, CalendarPlus, Mail } from 'lucide-react';
import SectionHeader from './SectionHeader';
import { useDemoWizard } from './DemoRequestWizard';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function ContactSection() {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);
  const demoWizard = useDemoWizard();

  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const notes = [get('phone') && `Phone: ${get('phone')}`, get('message')].filter(Boolean).join('\n\n').slice(0, 2000);
    setSending(true);
    const { error } = await supabase.rpc('submit_demo_request', {
      _demo_type: 'live',
      _scheduling_preference: 'flexible',
      _scheduled_date: null as any,
      _scheduled_slot: '',
      _timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      _meeting_format: '',
      _full_name: get('name'),
      _email: get('email'),
      _company: get('company'),
      _notes: notes,
      _source: 'contact-form',
    });
    setSending(false);
    if (error) {
      toast.error(error.message || 'Could not send your message. Please try again.');
      return;
    }
    setSubmitted(true);
  };

  return (
    <section id="contact" className="relative py-24 md:py-32 bg-muted/30 overflow-hidden">
      {/* Background mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        <div className="max-w-2xl mx-auto">
          <SectionHeader
            eyebrow="Contact"
            title={
              <>
                {t('contact.title').split(' ').slice(0, -1).join(' ')}{' '}
                <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                  {t('contact.title').split(' ').slice(-1)}
                </span>
              </>
            }
            subtitle={t('contact.subtitle')}
          />

          {submitted ? (
            <div className="text-center p-12 rounded-3xl bg-card/80 backdrop-blur-sm border border-primary/30 shadow-2xl motion-safe:animate-fade-in-up">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-5 shadow-lg">
                <CheckCircle2 size={40} strokeWidth={1.75} className="text-white" aria-hidden="true" />
              </div>
              <p className="text-xl font-bold text-foreground">{t('contact.success')}</p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="relative space-y-5 p-8 md:p-10 rounded-3xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-2xl motion-safe:animate-fade-in-up"
              style={{ animationDelay: '120ms' }}
            >
              {/* Subtle gradient ring */}
              <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-primary/15 via-transparent to-accent/15 -z-10 blur-xl opacity-50 pointer-events-none" />

              <div className="grid md:grid-cols-2 gap-4">
                <Input name="name" placeholder={t('contact.name')} required className="rounded-xl h-12 bg-background/60 border-border/60 focus-visible:border-primary/40 motion-safe:transition-colors" />
                <Input name="email" type="email" placeholder={t('contact.email')} required className="rounded-xl h-12 bg-background/60 border-border/60 focus-visible:border-primary/40 motion-safe:transition-colors" />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <Input name="company" placeholder={t('contact.company')} className="rounded-xl h-12 bg-background/60 border-border/60 focus-visible:border-primary/40 motion-safe:transition-colors" />
                <Input name="phone" placeholder={t('contact.phone')} className="rounded-xl h-12 bg-background/60 border-border/60 focus-visible:border-primary/40 motion-safe:transition-colors" />
              </div>
              <Textarea name="message" maxLength={1800} placeholder={t('contact.message')} rows={4} className="rounded-xl bg-background/60 border-border/60 focus-visible:border-primary/40 motion-safe:transition-colors" />
              <Button
                type="submit"
                size="lg"
                disabled={sending}
                className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-95 border-0 h-14 rounded-2xl font-semibold text-base shadow-lg motion-safe:transition-opacity"
              >
                {t('contact.submit')}
                <Send size={16} className="ms-2" aria-hidden="true" />
              </Button>

              <div className="relative flex items-center gap-3 pt-1">
                <div className="flex-1 h-px bg-border/50" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border/50" />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => demoWizard.open(undefined, { source: 'contact-section' })}
                  className="w-full h-12 rounded-2xl font-semibold border-primary/30 hover:border-primary/60 hover:bg-primary/5"
                >
                  <CalendarPlus size={16} className="me-2" aria-hidden="true" />
                  Request a tailored demo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  asChild
                  className="w-full h-12 rounded-2xl font-semibold border-primary/30 hover:border-primary/60 hover:bg-primary/5"
                >
                  <a href="mailto:info@qurtubatalks.com?subject=AI%20Support%20360%20request">
                    <Mail size={16} className="me-2" aria-hidden="true" />
                    Email us directly
                  </a>
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                Prefer email? Write to us any time at{' '}
                <a href="mailto:info@qurtubatalks.com" className="text-primary underline">info@qurtubatalks.com</a>
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
