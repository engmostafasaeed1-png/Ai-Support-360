import { useTranslation } from 'react-i18next';
import {
  Database, ShoppingCart, DollarSign, Factory, Shield, Layers,
  Smartphone, Cloud, Users, Package, BarChart3, Code,
  Lock, Warehouse, Truck, Plug, HardDrive, Headphones, Search, Wrench
} from 'lucide-react';

const categoryIcons = [
  { key: 's4hana', icon: Database },
  { key: 'mm', icon: Package },
  { key: 'sd', icon: ShoppingCart },
  { key: 'pp', icon: Factory },
  { key: 'fi_co', icon: DollarSign },
  { key: 'basis', icon: HardDrive },
  { key: 'fiori', icon: Smartphone },
  { key: 'btp', icon: Cloud },
  { key: 'sf', icon: Users },
  { key: 'ariba', icon: Layers },
  { key: 'analytics', icon: BarChart3 },
  { key: 'abap', icon: Code },
  { key: 'security', icon: Lock },
  { key: 'ewm', icon: Warehouse },
  { key: 'tm', icon: Truck },
  { key: 'integration', icon: Plug },
  { key: 'migration', icon: HardDrive },
  { key: 'ams', icon: Headphones },
  { key: 'advisory', icon: Search },
  { key: 'pm', icon: Wrench },
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
