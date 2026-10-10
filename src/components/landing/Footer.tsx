import { useTranslation } from 'react-i18next';
import logo from '@/assets/brand/horizontal.webp.asset.json';
import { cn } from '@/lib/utils';
import { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_HREF } from '@/lib/contact';
import { useDemoWizard } from './DemoRequestWizard';

type FooterLink = { label: string; href: string; onClick?: () => void; dir?: 'ltr' | 'rtl' };

/**
 * The site footer with the company details and the policy links.
 * `compact` is the shorter version at the end of the client, consultant and admin pages.
 * Links to sections of the landing page start with "/" so they also work from any other page.
 */
export default function Footer({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const demoWizard = useDemoWizard();

  const links: Record<string, FooterLink[]> = {
    platform: [
      { label: t('nav.services'), href: '/#categories' },
      { label: t('categories.s4hana'), href: '/services/s4hana-support' },
      { label: t('categories.btp'), href: '/services/btp-support' },
      { label: t('nav.consultants'), href: '/#consultants' },
      { label: t('nav.pricing'), href: '/pricing' },
      { label: t('nav.knowledge'), href: '/#faq' },
    ],
    company: [
      { label: t('footer.about'), href: '/#about' },
      { label: t('footer.careers'), href: '/#contact' },
      { label: t('footer.blog'), href: '/#faq' },
    ],
    support: [
      { label: 'Request a demo', href: '#', onClick: () => demoWizard.open(undefined, { source: 'footer' }) },
      { label: t('footer.help'), href: '/#how-it-works' },
      { label: t('footer.contact'), href: '/#contact' },
      { label: `Call ${CONTACT_PHONE_DISPLAY}`, href: CONTACT_PHONE_HREF, dir: 'ltr' },
    ],
    legal: [
      { label: t('footer.privacy'), href: '/privacy-policy' },
      { label: t('footer.terms'), href: '/terms-and-conditions' },
      { label: 'Refund Policy', href: '/refund-policy' },
      { label: 'Subscription & Cancellation', href: '/subscription-and-cancellation' },
      { label: 'Service Delivery', href: '/service-delivery' },
      { label: 'Cookie Policy', href: '/cookie-policy' },
      { label: 'Acceptable Use', href: '/acceptable-use' },
    ],
  };

  return (
    <footer className="border-t border-border/30 bg-card relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(var(--primary)/0.02),transparent_50%)]" />
      <div className={cn('container mx-auto px-4 relative', compact ? 'py-8' : 'py-16')}>
        <div className={cn('grid sm:grid-cols-2 lg:grid-cols-7', compact ? 'gap-6' : 'gap-10')}>
          <div className="lg:col-span-3">
            <div className={cn('flex items-center gap-3', compact ? 'mb-3' : 'mb-5')}>
              <img
                src={logo.url}
                alt="AI Support 360 — aisupport360.com"
                width={576}
                height={128}
                className={cn('max-w-full object-contain object-left', compact ? 'h-12 w-auto' : 'w-[36rem] h-32')}
              />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              {t('footer.description')}
            </p>
          </div>

          {Object.entries(links).map(([key, items]) => (
            <div key={key}>
              <h4 className={cn('font-bold text-foreground text-xs uppercase tracking-widest', compact ? 'mb-3' : 'mb-5')}>
                {t(`footer.${key}`)}
              </h4>
              <ul className={compact ? 'space-y-1.5' : 'space-y-3'}>
                {items.map((item, i) => (
                  <li key={i}>
                    <a
                      href={item.href}
                      dir={item.dir}
                      onClick={item.onClick ? (e) => { e.preventDefault(); item.onClick!(); } : undefined}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={cn('border-t border-border/30 text-center', compact ? 'mt-6 pt-4' : 'mt-14 pt-6')}>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AI Support 360. {t('footer.rights')}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            AI Support 360 is operated by Qurtuba Tech for Software (قرطبة تك للبرمجيات), registered in Egypt. Commercial Registration No. 226435.
          </p>
        </div>
      </div>
    </footer>
  );
}
