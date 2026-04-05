import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Database, ShoppingCart, DollarSign, Factory, Shield, Layers,
  Smartphone, Cloud, Users, Package, BarChart3, Code,
  Lock, Warehouse, Truck, Plug, HardDrive, Headphones, Search, Wrench,
  Fuel, Landmark, ShoppingBag, Heart, Building2, Radio, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const solutions = [
  { key: 's4hana', icon: Database, desc: 'explore.sol_s4hana_desc' },
  { key: 'fi_co', icon: DollarSign, desc: 'explore.sol_fi_co_desc' },
  { key: 'mm', icon: Package, desc: 'explore.sol_mm_desc' },
  { key: 'sd', icon: ShoppingCart, desc: 'explore.sol_sd_desc' },
  { key: 'pp', icon: Factory, desc: 'explore.sol_pp_desc' },
  { key: 'btp', icon: Cloud, desc: 'explore.sol_btp_desc' },
  { key: 'sf', icon: Users, desc: 'explore.sol_sf_desc' },
  { key: 'fiori', icon: Smartphone, desc: 'explore.sol_fiori_desc' },
  { key: 'basis', icon: HardDrive, desc: 'explore.sol_basis_desc' },
  { key: 'security', icon: Lock, desc: 'explore.sol_security_desc' },
  { key: 'analytics', icon: BarChart3, desc: 'explore.sol_analytics_desc' },
  { key: 'abap', icon: Code, desc: 'explore.sol_abap_desc' },
  { key: 'ariba', icon: Layers, desc: 'explore.sol_ariba_desc' },
  { key: 'ewm', icon: Warehouse, desc: 'explore.sol_ewm_desc' },
  { key: 'tm', icon: Truck, desc: 'explore.sol_tm_desc' },
  { key: 'integration', icon: Plug, desc: 'explore.sol_integration_desc' },
  { key: 'migration', icon: HardDrive, desc: 'explore.sol_migration_desc' },
  { key: 'ams', icon: Headphones, desc: 'explore.sol_ams_desc' },
  { key: 'advisory', icon: Search, desc: 'explore.sol_advisory_desc' },
  { key: 'pm', icon: Wrench, desc: 'explore.sol_pm_desc' },
];

const industries = [
  { key: 'oil', icon: Fuel, desc: 'explore.ind_oil_desc', count: 'explore.ind_oil_count' },
  { key: 'banking', icon: Landmark, desc: 'explore.ind_banking_desc', count: 'explore.ind_banking_count' },
  { key: 'retail', icon: ShoppingBag, desc: 'explore.ind_retail_desc', count: 'explore.ind_retail_count' },
  { key: 'healthcare', icon: Heart, desc: 'explore.ind_healthcare_desc', count: 'explore.ind_healthcare_count' },
  { key: 'manufacturing', icon: Factory, desc: 'explore.ind_manufacturing_desc', count: 'explore.ind_manufacturing_count' },
  { key: 'government', icon: Building2, desc: 'explore.ind_government_desc', count: 'explore.ind_government_count' },
  { key: 'telecom', icon: Radio, desc: 'explore.ind_telecom_desc', count: 'explore.ind_telecom_count' },
  { key: 'logistics', icon: Truck, desc: 'explore.ind_logistics_desc', count: 'explore.ind_logistics_count' },
];

export default function ExploreServicesSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <section id="categories" className="py-24 bg-muted/20">
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-semibold tracking-wider uppercase mb-4">
            {t('explore.badge')}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-3">
            {t('explore.title')}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-base md:text-lg">
            {t('explore.subtitle')}
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="solutions" className="w-full">
          <div className="flex justify-center mb-10">
            <TabsList className="bg-card border border-border/50 rounded-2xl p-1.5 h-auto gap-1">
              <TabsTrigger
                value="solutions"
                className="rounded-xl px-6 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all"
              >
                {t('explore.tab_solutions')}
              </TabsTrigger>
              <TabsTrigger
                value="industries"
                className="rounded-xl px-6 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md transition-all"
              >
                {t('explore.tab_industries')}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Solutions Grid */}
          <TabsContent value="solutions" className="mt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {solutions.map(({ key, icon: Icon, desc }) => (
                <div
                  key={key}
                  className="group relative p-5 rounded-2xl bg-card border border-border/40 hover:border-accent/40 hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden"
                  onMouseEnter={() => setHoveredSolution(key)}
                  onMouseLeave={() => setHoveredSolution(null)}
                >
                  {/* Glow effect on hover */}
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  
                  <div className="relative z-10">
                    <div className="w-11 h-11 rounded-xl bg-accent/10 group-hover:bg-accent/20 flex items-center justify-center mb-3 transition-all duration-300 group-hover:scale-110">
                      <Icon className="w-5 h-5 text-accent transition-transform duration-300" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">
                      {t(`categories.${key}`)}
                    </h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 h-0 group-hover:h-auto">
                      {t(desc)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* Industries Grid */}
          <TabsContent value="industries" className="mt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {industries.map(({ key, icon: Icon, desc, count }) => (
                <div
                  key={key}
                  onClick={() => navigate(`/client/consultants?industry=${key}`)}
                  className="group relative p-6 rounded-2xl bg-card border border-border/40 hover:border-accent/40 hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden"
                >
                  {/* Background gradient on hover */}
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-14 h-14 rounded-2xl bg-primary/5 group-hover:bg-accent/10 flex items-center justify-center transition-all duration-300 group-hover:scale-105">
                        <Icon className="w-7 h-7 text-primary group-hover:text-accent transition-colors duration-300" />
                      </div>
                      <span className="text-[10px] font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-full">
                        {t(count)}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-foreground mb-1.5">
                      {t(`industries.${key}`)}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t(desc)}
                    </p>
                    <div className="flex items-center gap-1 mt-3 text-accent text-xs font-medium opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0">
                      {t('explore.learn_more')} <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
