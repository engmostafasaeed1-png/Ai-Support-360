import { useTranslation } from 'react-i18next';

export default function Footer() {
  const { t } = useTranslation();

  const links = {
    platform: [
      { label: t('nav.services'), href: '#categories' },
      { label: t('nav.consultants'), href: '#consultants' },
      { label: t('nav.pricing'), href: '#pricing' },
      { label: t('nav.knowledge'), href: '#faq' },
    ],
    company: [
      { label: t('footer.about'), href: '#' },
      { label: t('footer.careers'), href: '#' },
      { label: t('footer.blog'), href: '#' },
    ],
    support: [
      { label: t('footer.help'), href: '#' },
      { label: t('footer.contact'), href: '#' },
    ],
    legal: [
      { label: t('footer.privacy'), href: '#' },
      { label: t('footer.terms'), href: '#' },
    ],
  };

  return (
    <footer className="border-t border-border/50 bg-card">
      <div className="container mx-auto px-4 py-14">
        <div className="grid md:grid-cols-5 gap-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                <span className="text-sm font-bold text-primary-foreground">Q</span>
              </div>
              <span className="font-bold text-lg text-foreground">Qurtuba</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              {t('footer.description')}
            </p>
          </div>

          {Object.entries(links).map(([key, items]) => (
            <div key={key}>
              <h4 className="font-semibold text-foreground mb-4 text-sm">
                {t(`footer.${key}`)}
              </h4>
              <ul className="space-y-2.5">
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

        <div className="mt-12 pt-6 border-t border-border/50 text-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Qurtuba Talks. {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  );
}
