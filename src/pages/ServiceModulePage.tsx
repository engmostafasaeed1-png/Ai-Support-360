import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRight, HeadphonesIcon, Shield, Clock, Languages } from 'lucide-react';

type ModuleConfig = {
  slug: string;
  name: string;
  headline: string;
  intro: string;
  coverage: string[];
  scenarios: string[];
};

const MODULES: Record<string, ModuleConfig> = {
  's4hana-support': {
    slug: 's4hana-support',
    name: 'SAP S/4HANA',
    headline: 'SAP S/4HANA Support Services',
    intro:
      'On-demand support for SAP S/4HANA — from incident resolution and performance tuning to migration follow-up and continuous improvement, delivered by verified S/4HANA experts.',
    coverage: [
      'Incident and break-fix support across FI/CO, MM, SD, PP, and PM on S/4HANA',
      'Performance tuning and HANA database optimization',
      'Fiori app troubleshooting and UX improvements',
      'S/4HANA migration and brownfield conversion follow-up support',
      'Custom code remediation and ABAP on HANA adjustments',
      'Release upgrade readiness checks and regression support',
    ],
    scenarios: [
      'Posting errors and period-end close issues in Finance',
      'MRP exceptions and production order failures',
      'Fiori launchpad and catalog authorization problems',
      'Slow reports and HANA memory bottlenecks',
      'Interface failures between S/4HANA and connected systems',
    ],
  },
  'btp-support': {
    slug: 'btp-support',
    name: 'SAP BTP',
    headline: 'SAP BTP & Integration Support Services',
    intro:
      'Expert support for SAP Business Technology Platform and Cloud Platform Integration (CPI) — keeping your extensions, integrations, and data flows running reliably across your landscape.',
    coverage: [
      'Cloud Integration (CPI) iFlow design, monitoring, and error resolution',
      'BTP extension development support (CAP, Node.js, Java)',
      'API management and integration advisory',
      'Connectivity between S/4HANA, SuccessFactors, Ariba, and third-party systems',
      'BTP security, destinations, and trust configuration',
      'Event mesh, workflow, and automation troubleshooting',
    ],
    scenarios: [
      'Failed or stuck iFlows and message mapping errors',
      'Certificate expiry and authentication failures between systems',
      'Performance issues in high-volume integration scenarios',
      'New interface build-outs against tight deadlines',
      'Governance and monitoring setup for growing integration estates',
    ],
  },
};

export default function ServiceModulePage({ moduleSlug }: { moduleSlug: string }) {
  const { t } = useTranslation();
  const mod = MODULES[moduleSlug];

  if (!mod) return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="pt-28 pb-16 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5">
            <HeadphonesIcon className="w-3.5 h-3.5 me-1.5" />
            {mod.name} Support
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">{mod.headline}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{mod.intro}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
            <Button size="lg" className="gradient-primary border-0" asChild>
              <Link to="/signup">
                Get {mod.name} Support
                <ArrowRight className="w-4 h-4 ms-1" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Coverage */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">What We Cover</h2>
            <p className="text-muted-foreground mt-2">
              Comprehensive {mod.name} expertise across your landscape
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 max-w-4xl mx-auto">
            {mod.coverage.map((item) => (
              <div
                key={item}
                className="bg-card rounded-xl border border-border/50 p-5 flex items-start gap-3 hover:shadow-md transition-shadow"
              >
                <Check className="w-5 h-5 text-accent mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Common scenarios */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground">Common Issues We Resolve</h2>
            <p className="text-muted-foreground mt-2">
              Typical {mod.name} problems our consultants help with
            </p>
          </div>
          <div className="max-w-3xl mx-auto space-y-3">
            {mod.scenarios.map((s) => (
              <div
                key={s}
                className="bg-card rounded-xl border border-border/50 p-5 flex items-start gap-3"
              >
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm text-foreground">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="bg-card rounded-2xl border border-border/50 p-6 text-center">
              <Clock className="w-8 h-8 text-accent mx-auto mb-3" />
              <h3 className="font-bold text-foreground mb-2">Matched to your request</h3>
              <p className="text-sm text-muted-foreground">
                AI helps match your request with a verified {mod.name} expert. You agree the scope and the hourly rate before the work starts.
              </p>
            </div>
            <div className="bg-card rounded-2xl border border-border/50 p-6 text-center">
              <Shield className="w-8 h-8 text-accent mx-auto mb-3" />
              <h3 className="font-bold text-foreground mb-2">{t('whyQurtuba.feature2_title')}</h3>
              <p className="text-sm text-muted-foreground">{t('whyQurtuba.feature2_desc')}</p>
            </div>
            <div className="bg-card rounded-2xl border border-border/50 p-6 text-center">
              <Languages className="w-8 h-8 text-accent mx-auto mb-3" />
              <h3 className="font-bold text-foreground mb-2">{t('whyQurtuba.feature3_title')}</h3>
              <p className="text-sm text-muted-foreground">{t('whyQurtuba.feature3_desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Need {mod.name} help right now?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Submit a support request and get matched with a verified {mod.name} consultant.
          </p>
          <Button size="lg" className="gradient-primary border-0" asChild>
            <Link to="/signup">
              Get Started
              <ArrowRight className="w-4 h-4 ms-1" />
            </Link>
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
