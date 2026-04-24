import { Check, X, Sparkles, Bot, ShieldCheck, Clock, Users, FileSearch } from 'lucide-react';

const valuePillars = [
  {
    Icon: Bot,
    title: 'AI-Augmented SAP Expertise',
    desc: 'Every ticket is enriched by AI that drafts root-cause analysis, suggests SAP Notes, and prepares solution paths — before a human consultant even opens it.',
  },
  {
    Icon: Users,
    title: 'Vetted Senior Consultants On-Demand',
    desc: 'Skip the staffing agency. Match with pre-verified SAP specialists by module, industry, and language in minutes — not weeks.',
  },
  {
    Icon: Clock,
    title: 'Pay-Per-Outcome, Not Per-Seat',
    desc: 'No annual licenses, no idle support contracts. Open a case, get it solved, pay for the resolution. Transparent pricing tied to value delivered.',
  },
  {
    Icon: ShieldCheck,
    title: 'Enterprise-Grade Governance',
    desc: 'NDAs, role-based access, audit trails, screen protection, and SAP-aligned data handling are built in — not bolted on.',
  },
  {
    Icon: FileSearch,
    title: 'Living Knowledge Base',
    desc: 'Every resolved case becomes searchable institutional knowledge for your team — turning support spend into a long-term asset.',
  },
  {
    Icon: Sparkles,
    title: 'Built for SAP, Not Generic IT',
    desc: 'Workflows, taxonomies, and AI models are tuned specifically for S/4HANA, ECC, BTP, and SAP modules — not a one-size-fits-all helpdesk.',
  },
];

const comparison = [
  { feature: 'AI-assisted root-cause analysis on every ticket', us: true, them: false },
  { feature: 'On-demand match with vetted SAP specialists', us: true, them: false },
  { feature: 'Pay only for resolved outcomes', us: true, them: false },
  { feature: 'SAP-specific taxonomy & module routing', us: true, them: 'Generic categories' },
  { feature: 'Built-in NDA, screen protection & audit trail', us: true, them: 'Add-on / manual' },
  { feature: 'Searchable knowledge base from your own cases', us: true, them: false },
  { feature: 'Multi-tenant client isolation by design', us: true, them: 'Varies' },
  { feature: 'Annual license lock-in', us: false, them: true },
];

export default function ValueDifferentiationSection() {
  return (
    <section className="py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(var(--accent)/0.04),transparent_60%)]" />

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold tracking-widest uppercase mb-4">
            The Portal Advantage
          </span>
          <h2 className="text-3xl md:text-5xl font-black text-foreground tracking-tight">
            More than a support portal — a smarter SAP operating layer
          </h2>
          <p className="text-muted-foreground mt-4 text-base md:text-lg">
            Traditional support portals open tickets and wait. Our portal combines AI triage,
            on-demand SAP experts, and outcome-based pricing to actually solve them — faster, cheaper, and with knowledge that compounds.
          </p>
        </div>

        {/* Value pillars */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto mb-20">
          {valuePillars.map((p, i) => (
            <div
              key={i}
              className="p-7 rounded-3xl bg-card border border-border/40 hover:border-primary/30 hover:shadow-xl transition-all duration-500 group"
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                <p.Icon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{p.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h3 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
              How we compare to traditional support portals
            </h3>
            <p className="text-muted-foreground mt-3 text-sm md:text-base">
              The difference between logging a problem and actually resolving it.
            </p>
          </div>

          <div className="rounded-3xl border border-border/40 bg-card overflow-hidden shadow-lg">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto] md:grid-cols-[2fr_1fr_1fr] gap-3 md:gap-6 px-5 md:px-8 py-5 bg-muted/40 border-b border-border/40 items-center">
              <span className="text-xs md:text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Capability
              </span>
              <span className="text-xs md:text-sm font-black uppercase tracking-wider text-primary text-center">
                AI SAP Portal
              </span>
              <span className="text-xs md:text-sm font-bold uppercase tracking-wider text-muted-foreground text-center">
                Typical Portals
              </span>
            </div>

            {/* Rows */}
            {comparison.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-[1fr_auto_auto] md:grid-cols-[2fr_1fr_1fr] gap-3 md:gap-6 px-5 md:px-8 py-4 items-center ${
                  i !== comparison.length - 1 ? 'border-b border-border/30' : ''
                } hover:bg-muted/20 transition-colors`}
              >
                <span className="text-sm md:text-base text-foreground font-medium">{row.feature}</span>

                <div className="flex justify-center">
                  {row.us === true ? (
                    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
                      <Check className="w-5 h-5 text-primary" strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <X className="w-5 h-5 text-muted-foreground" strokeWidth={3} />
                    </div>
                  )}
                </div>

                <div className="flex justify-center">
                  {row.them === true ? (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <Check className="w-5 h-5 text-muted-foreground" strokeWidth={2.5} />
                    </div>
                  ) : row.them === false ? (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                      <X className="w-5 h-5 text-muted-foreground" strokeWidth={2.5} />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic text-center block">
                      {row.them}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6 italic">
            Comparison based on common features of generic IT helpdesk and ticketing platforms.
          </p>
        </div>
      </div>
    </section>
  );
}
