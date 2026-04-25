import { useTranslation } from 'react-i18next';
import logo from '@/assets/logo.png';
import { useDemoWizard } from './DemoRequestWizard';

export default function Footer() {
  const { t } = useTranslation();

  const links = {
    platform: [
      { label: t('nav.services'), href: '#categories' },
      { label: t('nav.consultants'), href: '#consultants' },
      { label: t('nav.pricing'), href: '/pricing' },
      { label: t('nav.knowledge'), href: '#faq' },
    ],
    company: [
      { label: t('footer.about'), href: '#about' },
      { label: t('footer.careers'), href: '#contact' },
      { label: t('footer.blog'), href: '#faq' },
    ],
    support: [
      { label: t('footer.help'), href: '#how-it-works' },
      { label: t('footer.contact'), href: '#contact' },
    ],
    legal: [
      { label: t('footer.privacy'), href: '#contact' },
      { label: t('footer.terms'), href: '#contact' },
    ],
  };

  return (
    <footer className="border-t border-border/30 bg-card relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(var(--primary)/0.02),transparent_50%)]" />
      <div className="container mx-auto px-4 py-16 relative">
        <div className="grid md:grid-cols-5 gap-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-5">
              <img src={logo} alt="AI SAP Support Now" className="w-11 h-11 rounded-xl object-contain shadow-sm" />
              <span className="font-black text-lg text-foreground tracking-tight">AI SAP Support Now</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              {t('footer.description')}
            </p>
          </div>

          {Object.entries(links).map(([key, items]) => (
            <div key={key}>
              <h4 className="font-bold text-foreground mb-5 text-xs uppercase tracking-widest">
                {t(`footer.${key}`)}
              </h4>
              <ul className="space-y-3">
                {items.map((item, i) => (
                  <li key={i}>
                    <a href={item.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 pt-6 border-t border-border/30 text-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AI SAP Support Now. {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  );
}
