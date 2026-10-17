import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BadgeCheck, Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SectionHeader from './SectionHeader';

export default function ConsultantsSection() {
  const { t } = useTranslation();

  return (
    <section id="consultants" className="public-anchor relative py-24 md:py-32 bg-muted/30 overflow-hidden">
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

        <div className="max-w-3xl mx-auto grid sm:grid-cols-2 gap-5">
          <div className="rounded-3xl bg-card/80 border border-border/60 p-8 flex flex-col">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-primary" aria-hidden="true" />
            </div>
            <h3 className="font-bold text-lg text-foreground mb-2">Need expert help?</h3>
            <p className="text-sm text-muted-foreground mb-6 flex-1">
              Every consultant is interviewed and verified before they can take your case. Create an account to browse experts and get matched.
            </p>
            <Button asChild className="rounded-2xl h-11 font-semibold">
              <Link to="/client/consultants">{t('consultants.view_all')}</Link>
            </Button>
          </div>
          <div className="rounded-3xl bg-card/80 border border-border/60 p-8 flex flex-col">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
              <UserPlus className="w-6 h-6 text-accent" aria-hidden="true" />
            </div>
            <h3 className="font-bold text-lg text-foreground mb-2 flex items-center gap-2">
              Are you an expert? <BadgeCheck className="w-5 h-5 text-accent" aria-hidden="true" />
            </h3>
            <p className="text-sm text-muted-foreground mb-6 flex-1">
              Join our verified network, complete your interview, and start receiving matched support requests.
            </p>
            <Button asChild variant="outline" className="rounded-2xl h-11 font-semibold">
              <Link to="/for-consultants">{t('hero.cta_consultant')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
