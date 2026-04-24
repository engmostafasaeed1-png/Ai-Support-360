import { Check, X, Sparkles, Bot, ShieldCheck, Zap, BrainCircuit, FileSearch, ArrowUpRight } from 'lucide-react';

const valuePillars = [
  {
    Icon: BrainCircuit,
    title: 'AI-native triage',
    desc: 'Every ticket is parsed, classified, and pre-solved by AI tuned for SAP — before a human even reads it.',
    accent: 'from-primary/30 via-primary/10 to-transparent',
    span: 'md:col-span-2 md:row-span-2',
    featured: true,
  },
  {
    Icon: Zap,
    title: 'On-demand experts',
    desc: 'Match with vetted SAP specialists in minutes, not weeks.',
    accent: 'from-accent/25 to-transparent',
  },
  {
    Icon: Sparkles,
    title: 'Pay per outcome',
    desc: 'No seats, no licenses. Resolution-based pricing.',
    accent: 'from-primary/20 to-transparent',
  },
  {
    Icon: ShieldCheck,
    title: 'Governance built-in',
    desc: 'NDAs, RBAC, audit trails, screen protection — native, not bolted on.',
    accent: 'from-accent/20 to-transparent',
    span: 'md:col-span-2',
  },
  {
    Icon: FileSearch,
    title: 'Knowledge that compounds',
    desc: 'Every resolved case becomes searchable IP for your team.',
    accent: 'from-primary/20 to-transparent',
  },
  {
    Icon: Bot,
    title: 'SAP-specific by design',
    desc: 'Tuned for S/4HANA, ECC, BTP & every module — not generic IT.',
    accent: 'from-accent/25 to-transparent',
  },
];

const comparison = [
  { feature: 'AI root-cause analysis on every ticket', us: true, them: false },
  { feature: 'On-demand vetted SAP specialists', us: true, them: false },
  { feature: 'Outcome-based pricing', us: true, them: false },
  { feature: 'SAP-native taxonomy & module routing', us: true, them: 'Generic' },
  { feature: 'Built-in NDA, audit & screen protection', us: true, them: 'Add-on' },
  { feature: 'Compounding knowledge base from your cases', us: true, them: false },
  { feature: 'Multi-tenant isolation by design', us: true, them: 'Varies' },
  { feature: 'Annual license lock-in', us: false, them: true },
];

export default function ValueDifferentiationSection() {
  return (
    <section className="py-32 relative overflow-hidden">
      {/* Ambient backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.08),transparent_50%),radial-gradient(circle_at_70%_80%,hsl(var(--accent)/0.06),transparent_50%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.04)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />

      <div className="container mx-auto px-4 relative">
        {/* Header */}
        <div className="text-center mb-20 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 backdrop-blur-sm mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="text-xs font-semibold tracking-widest uppercase text-primary">The Portal Advantage</span>
          </div>
          <h2 className="text-4xl md:text-6xl font-black text-foreground tracking-tight leading-[1.05]">
            Not another <span className="text-muted-foreground/60 line-through decoration-primary/40">support portal</span>
            <br />
            <span className="bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              An SAP operating layer.
            </span>
          </h2>
          <p className="text-muted-foreground mt-6 text-base md:text-lg leading-relaxed">
            Traditional portals open tickets and wait. We combine AI triage, on-demand experts,
            and outcome pricing to actually solve them — with knowledge that compounds.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 auto-rows-[220px] gap-4 max-w-6xl mx-auto mb-24">
          {valuePillars.map((p, i) => (
            <div
              key={i}
              className={`group relative rounded-3xl border border-border/40 bg-card/40 backdrop-blur-xl overflow-hidden hover:border-primary/40 transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5 ${p.span ?? ''}`}
            >
              {/* Gradient glow */}
              <div className={`absolute inset-0 bg-gradient-to-br ${p.accent} opacity-60 group-hover:opacity-100 transition-opacity duration-500`} />
              {/* Noise / shine */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent" />

              <div className="relative h-full p-7 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-background/80 border border-border/50 backdrop-blur-sm flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
                    <p.Icon className="w-6 h-6 text-primary" strokeWidth={2} />
                  </div>
                  <ArrowUpRight className="w-5 h-5 text-muted-foreground/40 group-hover:text-primary group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all duration-300" />
                </div>

                <div>
                  <h3 className={`font-black text-foreground mb-2 tracking-tight ${p.featured ? 'text-2xl md:text-3xl' : 'text-lg'}`}>
                    {p.title}
                  </h3>
                  <p className={`text-muted-foreground leading-relaxed ${p.featured ? 'text-base' : 'text-sm'}`}>
                    {p.desc}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison */}
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Side by side</span>
            <h3 className="text-3xl md:text-4xl font-black text-foreground tracking-tight mt-3">
              Logging problems vs. <span className="text-primary">solving them</span>
            </h3>
          </div>

          <div className="relative rounded-[2rem] border border-border/40 bg-card/30 backdrop-blur-xl overflow-hidden shadow-2xl shadow-primary/5">
            {/* Highlight column for "us" */}
            <div className="absolute top-0 bottom-0 left-1/2 md:left-[calc(50%+8%)] w-[28%] md:w-[20%] bg-gradient-to-b from-primary/[0.08] via-primary/[0.04] to-transparent pointer-events-none" />

            {/* Header */}
            <div className="relative grid grid-cols-[1fr_auto_auto] md:grid-cols-[2fr_1fr_1fr] gap-4 md:gap-8 px-6 md:px-10 py-6 border-b border-border/40">
              <span className="text-[11px] md:text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground self-center">
                Capability
              </span>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-primary/70">Ours</span>
                <span className="text-sm md:text-base font-black text-foreground">AI SAP Portal</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/70">Theirs</span>
                <span className="text-sm md:text-base font-bold text-muted-foreground">Typical Portals</span>
              </div>
            </div>

            {/* Rows */}
            {comparison.map((row, i) => (
              <div
                key={i}
                className={`relative grid grid-cols-[1fr_auto_auto] md:grid-cols-[2fr_1fr_1fr] gap-4 md:gap-8 px-6 md:px-10 py-5 items-center group hover:bg-muted/10 transition-colors ${
                  i !== comparison.length - 1 ? 'border-b border-border/20' : ''
                }`}
              >
                <span className="text-sm md:text-base text-foreground/90 font-medium">{row.feature}</span>

                {/* Us */}
                <div className="flex justify-center">
                  {row.us ? (
                    <div className="relative w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
                      <div className="absolute inset-0 rounded-full bg-primary/20 blur-md" />
                      <Check className="relative w-5 h-5 text-primary" strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-muted/50 flex items-center justify-center ring-1 ring-border/40">
                      <X className="w-5 h-5 text-muted-foreground/60" strokeWidth={2.5} />
                    </div>
                  )}
                </div>

                {/* Them */}
                <div className="flex justify-center min-w-[90px]">
                  {row.them === true ? (
                    <div className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center ring-1 ring-border/30">
                      <Check className="w-5 h-5 text-muted-foreground/60" strokeWidth={2.5} />
                    </div>
                  ) : row.them === false ? (
                    <div className="w-9 h-9 rounded-full bg-muted/40 flex items-center justify-center ring-1 ring-border/30">
                      <X className="w-5 h-5 text-muted-foreground/60" strokeWidth={2.5} />
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground/70 italic px-3 py-1 rounded-full bg-muted/40 border border-border/30">
                      {row.them}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground/60 mt-6 italic">
            Comparison based on common features of generic IT helpdesk and ticketing platforms.
          </p>
        </div>
      </div>
    </section>
  );
}
