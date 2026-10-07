import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileSignature,
  FileText,
  Handshake,
  MailOpen,
  Receipt,
  Search,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react';
import {
  accents,
  iconPlate,
  motion,
  radius,
  sheen,
  surface,
  tile,
  type AccentName,
} from './tokens';
import SectionHeader from './SectionHeader';

/**
 * "For Clients" / "For Consultants" — a factual map of what each side of
 * the platform can actually do. Copy comes from the i18n files so the
 * Arabic version stays in sync and RTL flipping is handled by the app's
 * direction provider.
 *
 * Visuals reuse the shared landing tokens (`tile`, `iconPlate`, `sheen`)
 * so the two panels read as siblings of How It Works and Why Choose Us.
 */

type IconType = typeof FileText;

type Item = {
  Icon: IconType;
  /** i18n key suffix under `audience.` */
  key: string;
};

type Panel = {
  /** i18n key prefix under `audience.` (also used for DOM ids). */
  id: 'clients' | 'consultants';
  Icon: IconType;
  /** Accent identity from shared tokens — drives the header plate + glow. */
  accent: AccentName;
  items: Item[];
};

const panels: Panel[] = [
  {
    id: 'clients',
    Icon: ClipboardList,
    accent: 'sky',
    items: [
      { Icon: FileText,      key: 'client1' },
      { Icon: Search,        key: 'client2' },
      { Icon: Handshake,     key: 'client3' },
      { Icon: CalendarClock, key: 'client4' },
      { Icon: Receipt,       key: 'client5' },
      { Icon: ShieldCheck,   key: 'client6' },
    ],
  },
  {
    id: 'consultants',
    Icon: Briefcase,
    accent: 'amber',
    items: [
      { Icon: UserRound,      key: 'consultant1' },
      { Icon: Clock,          key: 'consultant2' },
      { Icon: MailOpen,       key: 'consultant3' },
      { Icon: FileSignature,  key: 'consultant4' },
      { Icon: ClipboardCheck, key: 'consultant5' },
      { Icon: Wallet,         key: 'consultant6' },
    ],
  },
];

export default function AudienceSection() {
  const { t } = useTranslation();

  return (
    <section
      id="audience"
      className={`relative py-24 md:py-32 overflow-hidden ${surface.section}`}
    >
      {/* Decorative background mesh — same family as How It Works. */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 -right-32 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[150px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 -left-32 w-[520px] h-[520px] bg-accent/10 rounded-full blur-[160px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow={t('audience.eyebrow')}
          title={
            <>
              {t('audience.title_a')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('audience.title_highlight')}
              </span>
            </>
          }
          subtitle={t('audience.subtitle')}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6 max-w-6xl mx-auto">
          {panels.map((p) => {
            const titleId = `audience-${p.id}-title`;
            return (
              <article
                key={p.id}
                aria-labelledby={titleId}
                style={{ ['--glow' as string]: accents[p.accent].glow }}
                className={`${tile} h-full p-6 md:p-8 ${motion.enter}`}
              >
                {/* Hover sheen (shared token). */}
                <div className={sheen} />

                <header className="relative flex items-start gap-4">
                  <div
                    className={`${iconPlate(p.accent)} group-hover:shadow-[0_0_60px_-15px_rgba(var(--glow),0.55)]`}
                  >
                    <p.Icon
                      size={26}
                      strokeWidth={1.75}
                      absoluteStrokeWidth
                      className="text-white"
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3
                      id={titleId}
                      className="text-xl md:text-2xl font-black text-foreground tracking-tight leading-snug"
                    >
                      {t(`audience.${p.id}_title`)}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                      {t(`audience.${p.id}_subtitle`)}
                    </p>
                  </div>
                </header>

                <ul className="relative mt-6 md:mt-7">
                  {p.items.map((item, i) => (
                    <li
                      key={item.key}
                      className={`flex items-start gap-3 py-3.5 ${
                        i > 0 ? 'border-t border-border/30' : ''
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`shrink-0 w-8 h-8 ${radius.iconSm} bg-primary/[0.06] border border-primary/20 flex items-center justify-center`}
                      >
                        <item.Icon
                          size={15}
                          strokeWidth={2}
                          absoluteStrokeWidth
                          className="text-primary"
                        />
                      </span>
                      <span className="min-w-0 text-sm text-muted-foreground leading-relaxed pt-1.5">
                        {t(`audience.${item.key}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
