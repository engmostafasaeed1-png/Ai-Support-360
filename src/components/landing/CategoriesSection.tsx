import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Database, ShoppingCart, Coins, Factory, Layers,
  Fingerprint, CloudCog, UserCheck, PackageSearch, BarChart3, Terminal,
  KeyRound, Container, Route, Cable, ArrowLeftRight, Headset, Stethoscope, Settings,
  BookOpen, Workflow, Globe, BrainCircuit, MoreHorizontal,
} from 'lucide-react';
import SectionHeader from './SectionHeader';

const categoryIcons = [
  { key: 's4hana',      icon: Database },
  { key: 'mm',          icon: PackageSearch },
  { key: 'sd',          icon: ShoppingCart },
  { key: 'pp',          icon: Factory },
  { key: 'fi_co',       icon: Coins },
  { key: 'basis',       icon: Settings },
  { key: 'fiori',       icon: Fingerprint },
  { key: 'btp',         icon: CloudCog },
  { key: 'sf',          icon: UserCheck },
  { key: 'ariba',       icon: Layers },
  { key: 'analytics',   icon: BarChart3 },
  { key: 'abap',        icon: Terminal },
  { key: 'security',    icon: KeyRound },
  { key: 'ewm',         icon: Container },
  { key: 'tm',          icon: Route },
  { key: 'integration', icon: Cable },
  { key: 'migration',   icon: ArrowLeftRight },
  { key: 'ams',         icon: Headset },
  { key: 'advisory',    icon: Stethoscope },
  { key: 'pm',          icon: Settings },
  { key: 'hcm',         icon: BookOpen },
  { key: 'bw',          icon: BrainCircuit },
  { key: 'ibp',         icon: Workflow },
  { key: 'concur',      icon: Globe },
  { key: 'others',      icon: MoreHorizontal },
];

export default function CategoriesSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <section id="categories" className="public-anchor relative py-24 md:py-32 bg-muted/30 overflow-hidden">
      {/* Ambient mesh */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[420px] h-[420px] bg-primary/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift" />
        <div className="absolute bottom-0 right-1/4 w-[480px] h-[480px] bg-accent/10 rounded-full blur-[140px] motion-safe:animate-mesh-shift-alt" />
      </div>

      <div className="container mx-auto px-4 relative">
        <SectionHeader
          eyebrow="Categories"
          title={
            <>
              {t('categories.title').split(' ').slice(0, -1).join(' ')}{' '}
              <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                {t('categories.title').split(' ').slice(-1)}
              </span>
            </>
          }
          subtitle={t('categories.subtitle')}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4 max-w-6xl mx-auto">
          {categoryIcons.map(({ key, icon: Icon }, i) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(`/client/consultants?module=${key}`)}
              style={{ animationDelay: `${i * 30}ms` }}
              className="group relative rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm p-4 md:p-5 text-center motion-safe:transition-all motion-safe:duration-500 hover:border-primary/40 hover:bg-card hover:-translate-y-1 hover:shadow-xl motion-safe:animate-fade-in-up"
            >
              {/* Subtle hover glow */}
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-500 pointer-events-none bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.06]" />

              <div className="relative">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 border border-border/40 flex items-center justify-center mx-auto mb-3 motion-safe:transition-all motion-safe:duration-500 motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-3 group-hover:border-primary/30">
                  <Icon size={20} strokeWidth={1.75} absoluteStrokeWidth className="text-primary" aria-hidden="true" />
                </div>
                <span className="block text-xs md:text-sm font-semibold text-foreground leading-tight">
                  {t(`categories.${key}`)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
