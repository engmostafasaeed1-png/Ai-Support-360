import { useTranslation } from 'react-i18next';
import {
  Database, ShoppingCart, Coins, Factory, Shield, Layers,
  Fingerprint, CloudCog, UserCheck, PackageSearch, BarChart3, Terminal,
  KeyRound, Container, Route, Cable, ArrowRightLeft, Headset, Stethoscope, Settings,
  BookOpen, Workflow, Globe, BrainCircuit, MoreHorizontal,
} from 'lucide-react';

const categoryIcons = [
  { key: 's4hana', icon: Database },
  { key: 'mm', icon: PackageSearch },
  { key: 'sd', icon: ShoppingCart },
  { key: 'pp', icon: Factory },
  { key: 'fi_co', icon: Coins },
  { key: 'basis', icon: Settings },
  { key: 'fiori', icon: Fingerprint },
  { key: 'btp', icon: CloudCog },
  { key: 'sf', icon: UserCheck },
  { key: 'ariba', icon: Layers },
  { key: 'analytics', icon: BarChart3 },
  { key: 'abap', icon: Terminal },
  { key: 'security', icon: KeyRound },
  { key: 'ewm', icon: Container },
  { key: 'tm', icon: Route },
  { key: 'integration', icon: Cable },
  { key: 'migration', icon: ArrowRightLeft },
  { key: 'ams', icon: Headset },
  { key: 'advisory', icon: Stethoscope },
  { key: 'pm', icon: Settings },
  { key: 'hcm', icon: BookOpen },
  { key: 'bw', icon: BrainCircuit },
  { key: 'ibp', icon: Workflow },
  { key: 'concur', icon: Globe },
  { key: 'others', icon: MoreHorizontal },
];

export default function CategoriesSection() {
  const { t } = useTranslation();

  return (
    <section id="categories" className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t('categories.title')}</h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">{t('categories.subtitle')}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {categoryIcons.map(({ key, icon: Icon }) => (
            <div
              key={key}
              className="group p-5 rounded-2xl bg-card border border-border/50 hover:shadow-premium hover:border-accent/30 transition-all duration-300 cursor-pointer text-center"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-3 group-hover:bg-accent/20 transition-colors">
                <Icon className="w-5 h-5 text-accent" />
              </div>
              <span className="text-sm font-medium text-foreground">{t(`categories.${key}`)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
