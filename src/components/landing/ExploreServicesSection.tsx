import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Database, ShoppingCart, Coins, Factory, Layers,
  LayoutGrid, CloudCog, UsersRound, PackageSearch, BarChart3, Braces,
  ShieldCheck, Container, Route, Cable, ArrowLeftRight, LifeBuoy, Compass, Wrench,
  Fuel, Landmark, ShoppingBag, HeartPulse, Building2, RadioTower, Truck,
  ServerCog, Sparkles, ArrowUpRight,
} from 'lucide-react';

// Module color tokens — each SAP solution gets a signature hue from the design system
type Tone = 'sky' | 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'indigo' | 'fuchsia' | 'orange' | 'lime';

const toneStyles: Record<Tone, { ring: string; glow: string; icon: string; chip: string }> = {
  sky:      { ring: 'from-sky-500/40 to-sky-500/0',         glow: 'bg-sky-500/20',         icon: 'text-sky-500',         chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  violet:   { ring: 'from-violet-500/40 to-violet-500/0',   glow: 'bg-violet-500/20',      icon: 'text-violet-500',      chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  emerald:  { ring: 'from-emerald-500/40 to-emerald-500/0', glow: 'bg-emerald-500/20',     icon: 'text-emerald-500',     chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  amber:    { ring: 'from-amber-500/40 to-amber-500/0',     glow: 'bg-amber-500/20',       icon: 'text-amber-500',       chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  rose:     { ring: 'from-rose-500/40 to-rose-500/0',       glow: 'bg-rose-500/20',        icon: 'text-rose-500',        chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  cyan:     { ring: 'from-cyan-500/40 to-cyan-500/0',       glow: 'bg-cyan-500/20',        icon: 'text-cyan-500',        chip: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  indigo:   { ring: 'from-indigo-500/40 to-indigo-500/0',   glow: 'bg-indigo-500/20',      icon: 'text-indigo-500',      chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' },
  fuchsia:  { ring: 'from-fuchsia-500/40 to-fuchsia-500/0', glow: 'bg-fuchsia-500/20',     icon: 'text-fuchsia-500',     chip: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400' },
  orange:   { ring: 'from-orange-500/40 to-orange-500/0',   glow: 'bg-orange-500/20',      icon: 'text-orange-500',      chip: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  lime:     { ring: 'from-lime-500/40 to-lime-500/0',       glow: 'bg-lime-500/20',        icon: 'text-lime-500',        chip: 'bg-lime-500/10 text-lime-600 dark:text-lime-400' },
};

const solutions: { key: string; icon: any; desc: string; tone: Tone; tag: string }[] = [
  { key: 's4hana',      icon: Database,       desc: 'explore.sol_s4hana_desc',      tone: 'sky',     tag: 'ERP' },
  { key: 'fi_co',       icon: Coins,          desc: 'explore.sol_fi_co_desc',       tone: 'emerald', tag: 'Finance' },
  { key: 'mm',          icon: PackageSearch,  desc: 'explore.sol_mm_desc',          tone: 'amber',   tag: 'Logistics' },
  { key: 'sd',          icon: ShoppingCart,   desc: 'explore.sol_sd_desc',          tone: 'rose',    tag: 'Sales' },
  { key: 'pp',          icon: Factory,        desc: 'explore.sol_pp_desc',          tone: 'orange',  tag: 'Production' },
  { key: 'btp',         icon: CloudCog,       desc: 'explore.sol_btp_desc',         tone: 'cyan',    tag: 'Platform' },
  { key: 'sf',          icon: UsersRound,     desc: 'explore.sol_sf_desc',          tone: 'violet',  tag: 'HR' },
  { key: 'fiori',       icon: LayoutGrid,     desc: 'explore.sol_fiori_desc',       tone: 'indigo',  tag: 'UX' },
  { key: 'basis',       icon: ServerCog,      desc: 'explore.sol_basis_desc',       tone: 'sky',     tag: 'Infra' },
  { key: 'security',    icon: ShieldCheck,    desc: 'explore.sol_security_desc',    tone: 'emerald', tag: 'GRC' },
  { key: 'analytics',   icon: BarChart3,      desc: 'explore.sol_analytics_desc',   tone: 'fuchsia', tag: 'BI' },
  { key: 'abap',        icon: Braces,         desc: 'explore.sol_abap_desc',        tone: 'indigo',  tag: 'Dev' },
  { key: 'ariba',       icon: Layers,         desc: 'explore.sol_ariba_desc',       tone: 'violet',  tag: 'Procure' },
  { key: 'ewm',         icon: Container,      desc: 'explore.sol_ewm_desc',         tone: 'amber',   tag: 'Warehouse' },
  { key: 'tm',          icon: Route,          desc: 'explore.sol_tm_desc',          tone: 'lime',    tag: 'Transport' },
  { key: 'integration', icon: Cable,          desc: 'explore.sol_integration_desc', tone: 'cyan',    tag: 'iPaaS' },
  { key: 'migration',   icon: ArrowLeftRight, desc: 'explore.sol_migration_desc',   tone: 'rose',    tag: 'Migrate' },
  { key: 'ams',         icon: LifeBuoy,       desc: 'explore.sol_ams_desc',         tone: 'sky',     tag: 'Support' },
  { key: 'advisory',    icon: Compass,        desc: 'explore.sol_advisory_desc',    tone: 'fuchsia', tag: 'Strategy' },
  { key: 'pm',          icon: Wrench,         desc: 'explore.sol_pm_desc',          tone: 'orange',  tag: 'Maintain' },
];

const industries: { key: string; icon: any; desc: string; count: string; tone: Tone }[] = [
  { key: 'oil',           icon: Fuel,            desc: 'explore.ind_oil_desc',           count: 'explore.ind_oil_count',           tone: 'amber' },
  { key: 'banking',       icon: Landmark,        desc: 'explore.ind_banking_desc',       count: 'explore.ind_banking_count',       tone: 'emerald' },
  { key: 'retail',        icon: ShoppingBag,     desc: 'explore.ind_retail_desc',        count: 'explore.ind_retail_count',        tone: 'rose' },
  { key: 'healthcare',    icon: HeartPulse,      desc: 'explore.ind_healthcare_desc',    count: 'explore.ind_healthcare_count',    tone: 'cyan' },
  { key: 'manufacturing', icon: Factory,         desc: 'explore.ind_manufacturing_desc', count: 'explore.ind_manufacturing_count', tone: 'orange' },
  { key: 'government',    icon: Building2,       desc: 'explore.ind_government_desc',    count: 'explore.ind_government_count',    tone: 'indigo' },
  { key: 'telecom',       icon: RadioTower,      desc: 'explore.ind_telecom_desc',       count: 'explore.ind_telecom_count',       tone: 'violet' },
  { key: 'logistics',     icon: Truck,           desc: 'explore.ind_logistics_desc',     count: 'explore.ind_logistics_count',     tone: 'lime' },
];

export default function ExploreServicesSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <section id="categories" className="relative py-24 overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.08),transparent_50%),radial-gradient(circle_at_80%_90%,hsl(var(--accent)/0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.25)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.25)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>

      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-14">
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold tracking-[0.18em] uppercase mb-5 border border-accent/20">
            <Sparkles className="w-3.5 h-3.5" />
            {t('explore.badge')}
          </span>
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-3 tracking-tight">
            {t('explore.title')}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-base md:text-lg">
            {t('explore.subtitle')}
          </p>
        </div>

        <Tabs defaultValue="solutions" className="w-full">
          <div className="flex justify-center mb-12">
            <TabsList className="bg-card/60 backdrop-blur-xl border border-border/60 rounded-2xl p-1.5 h-auto gap-1 shadow-sm">
              <TabsTrigger
                value="solutions"
                className="rounded-xl px-6 py-2.5 text-sm font-medium data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary data-[state=active]:to-primary/80 data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg transition-all"
              >
                {t('explore.tab_solutions')}
              </TabsTrigger>
              <TabsTrigger
                value="industries"
                className="rounded-xl px-6 py-2.5 text-sm font-medium data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary data-[state=active]:to-primary/80 data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg transition-all"
              >
                {t('explore.tab_industries')}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Solutions */}
          <TabsContent value="solutions" className="mt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {solutions.map(({ key, icon: Icon, desc, tone, tag }) => {
                const s = toneStyles[tone];
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={t(`categories.${key}`)}
                    onClick={() => navigate(`/client/consultants?module=${key}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/client/consultants?module=${key}`);
                      }
                    }}
                    className="group relative rounded-2xl p-[1px] bg-gradient-to-br from-border/60 via-border/30 to-transparent hover:from-transparent hover:via-transparent hover:to-transparent cursor-pointer focus-visible:outline-2 focus-visible:outline-accent transition-all duration-500"
                  >
                    {/* Animated gradient border on hover */}
                    <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${s.ring} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                    <div className="relative h-full rounded-2xl bg-card/80 backdrop-blur-xl p-5 overflow-hidden">
                      {/* Corner glow */}
                      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl ${s.glow} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                      <div className="relative z-10">
                        <div className="flex items-start justify-between mb-3">
                          <div className={`relative w-11 h-11 rounded-xl bg-background border border-border/60 flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:-rotate-3 group-hover:border-transparent`}>
                            <div className={`absolute inset-0 rounded-xl ${s.glow} opacity-0 group-hover:opacity-100 transition-opacity blur-md`} />
                            <Icon className={`relative w-[22px] h-[22px] ${s.icon}`} strokeWidth={1.75} />
                          </div>
                          <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                        </div>

                        <h3 className="text-sm font-semibold text-foreground leading-tight mb-1">
                          {t(`categories.${key}`)}
                        </h3>
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-md ${s.chip} mb-2`}>
                          {tag}
                        </span>
                        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 opacity-70 group-hover:opacity-100 transition-opacity">
                          {t(desc)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Industries */}
          <TabsContent value="industries" className="mt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {industries.map(({ key, icon: Icon, desc, count, tone }) => {
                const s = toneStyles[tone];
                return (
                  <div
                    key={key}
                    onClick={() => navigate(`/client/consultants?industry=${key}`)}
                    className="group relative rounded-3xl p-[1px] bg-gradient-to-br from-border/60 via-border/30 to-transparent cursor-pointer transition-all duration-500"
                  >
                    <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${s.ring} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                    <div className="relative h-full rounded-3xl bg-card/80 backdrop-blur-xl p-6 overflow-hidden">
                      {/* Decorative pattern */}
                      <div className={`absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl ${s.glow} opacity-30 group-hover:opacity-100 transition-opacity duration-700`} />
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--foreground)/0.03),transparent_50%)]" />

                      <div className="relative z-10">
                        <div className="flex items-start justify-between mb-5">
                          <div className="relative w-14 h-14 rounded-2xl bg-background border border-border/60 flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:rotate-3">
                            <div className={`absolute inset-0 rounded-2xl ${s.glow} opacity-0 group-hover:opacity-100 blur-md transition-opacity`} />
                            <Icon className={`relative w-7 h-7 ${s.icon}`} strokeWidth={1.5} />
                          </div>
                          <span className={`text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full ${s.chip}`}>
                            {t(count)}
                          </span>
                        </div>

                        <h3 className="text-lg font-semibold text-foreground mb-1.5 tracking-tight">
                          {t(`industries.${key}`)}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                          {t(desc)}
                        </p>

                        <div className={`flex items-center gap-1.5 text-xs font-semibold ${s.icon} opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-1 group-hover:translate-x-0`}>
                          {t('explore.learn_more')}
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
