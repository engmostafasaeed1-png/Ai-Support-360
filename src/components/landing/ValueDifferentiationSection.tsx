import { Check, X, Sparkles, Bot, ShieldCheck, Zap, BrainCircuit, FileSearch, ArrowUpRight, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { accents, iconPlate, radius, shadow, type AccentName } from './tokens';
import { tileImageAlt } from './tileImageAlt';
import aiTriageImg from '@/assets/value/ai-triage.jpg';
import expertsImg from '@/assets/value/experts.jpg';
import outcomeImg from '@/assets/value/outcome.jpg';
import governanceImg from '@/assets/value/governance.jpg';
import knowledgeImg from '@/assets/value/knowledge.jpg';
import sapNativeImg from '@/assets/value/sap-native.jpg';

type Pillar = {
  Icon: typeof BrainCircuit;
  title: string;
  desc: string;
  /** Accent identity from shared tokens — drives gradient + glow color. */
  accent: AccentName;
  /** Decorative background image (subtle, with overlay gradient). */
  image: string;
  imageAlt: string;
  span?: string;
  featured?: boolean;
};

const valuePillars: Pillar[] = [
  {
    Icon: BrainCircuit,
    title: 'AI-assisted triage',
    desc: 'AI helps classify your request and suggests likely solutions and related knowledge while you write it, before a consultant picks it up.',
    accent: 'violet',
    image: aiTriageImg,
    imageAlt: 'Glowing neural network nodes representing AI triage',
    span: 'md:col-span-2 md:row-span-2',
    featured: true,
  },
  {
    Icon: Zap,
    title: 'On-demand experts',
    desc: 'Request a vetted specialist and agree the scope and the hourly rate up front.',
    accent: 'amber',
    image: expertsImg,
    imageAlt: 'Amber lightning bolt suggesting fast expert matching',
  },
  {
    Icon: Sparkles,
    title: 'Pay for approved hours',
    desc: 'No seats, no licenses. You approve the hourly rate and every timesheet before you pay.',
    accent: 'rose',
    image: outcomeImg,
    imageAlt: 'Pink sparkle particles representing value for approved hours',
  },
  {
    Icon: ShieldCheck,
    title: 'Governance built-in',
    desc: 'NDAs, RBAC, audit trails, screen protection — native, not bolted on.',
    accent: 'emerald',
    image: governanceImg,
    imageAlt: 'Emerald shield representing built-in governance',
    span: 'md:col-span-2',
  },
  {
    Icon: FileSearch,
    title: 'Knowledge that compounds',
    desc: 'Solved cases can become reviewed, anonymous knowledge articles that help the next request.',
    accent: 'sky',
    image: knowledgeImg,
    imageAlt: 'Stacked glowing layers representing a compounding knowledge base',
  },
  {
    Icon: Bot,
    title: 'Built for SAP',
    desc: 'S/4HANA, ECC, BTP and 20+ modules, with every request tagged by SAP area, not generic IT categories.',
    accent: 'cyan',
    image: sapNativeImg,
    imageAlt: 'Modular cyan cubes representing enterprise module architecture',
  },
];

/**
 * Side-by-side comparison rows. Each row carries:
 *  - `feature`: short capability name (left column)
 *  - `category`: groups rows visually so the table reads like a story
 *     (Triage → Expertise → Pricing → Governance → Knowledge), not a flat checklist
 *  - `usDetail` / `themDetail`: the concrete "how", shown under the
 *     icon. This is the difference between "we have AI triage" and
 *     "we suggest solutions while you write the request" — the second is what wins.
 * No row states a number or a time: the platform makes no promise about response or resolution times.
 */
type CompareCategory = 'Triage' | 'Expertise' | 'Pricing' | 'Governance' | 'Knowledge';

type CompareCellValue = boolean | string;

type CompareRow = {
  category: CompareCategory;
  feature: string;
  us: CompareCellValue;
  them: CompareCellValue;
  usDetail?: string;
  themDetail?: string;
};

const comparison: CompareRow[] = [
  {
    category: 'Triage',
    feature: 'Help while you write the request',
    us: true, them: false,
    usDetail: 'AI suggests likely solutions and related knowledge as you describe the issue, before anyone reads the ticket.',
    themDetail: 'The ticket waits in a queue until an agent reads it.',
  },
  {
    category: 'Triage',
    feature: 'Requests tagged by SAP area and module',
    us: true, them: 'Generic',
    usDetail: 'Every request carries its SAP area and module, so it reaches the right specialist.',
    themDetail: 'Free-text categories like "ERP Issue" or "Other".',
  },
  {
    category: 'Expertise',
    feature: 'Vetted specialists you can choose',
    us: true, them: 'Varies',
    usDetail: 'Consultants are interviewed and verified. You review proposals and rates and pick your consultant.',
    themDetail: 'Often assigned by the vendor, with no choice of consultant.',
  },
  {
    category: 'Expertise',
    feature: 'Arabic and English, right-to-left interface',
    us: true, them: 'Varies',
    usDetail: 'The whole portal works in Arabic and English.',
    themDetail: 'Often English only.',
  },
  {
    category: 'Pricing',
    feature: 'You approve the rate and every hour',
    us: true, them: 'Varies',
    usDetail: 'The consultant proposes an hourly rate and you approve it. You approve each timesheet before you pay.',
    themDetail: 'Seats or annual fees, whatever the usage.',
  },
  {
    category: 'Pricing',
    feature: 'Annual license lock-in',
    us: false, them: true,
    usDetail: 'No subscription and no minimum: you pay for the hours that you approve, plus the platform fees and VAT shown on the pricing page.',
    themDetail: 'Often a yearly commitment.',
  },
  {
    category: 'Governance',
    feature: 'Built-in NDA, audit trail and screen protection',
    us: true, them: 'Varies',
    usDetail: 'An NDA is signed before a consultant sees your case. Actions are logged and screens are watermarked.',
    themDetail: 'Compliance features are often sold separately.',
  },
  {
    category: 'Governance',
    feature: "Each company's data kept separate",
    us: true, them: 'Varies',
    usDetail: 'Row-level security in the database keeps the data of each company separate, not only the screens.',
    themDetail: 'Depends on the vendor and the plan.',
  },
  {
    category: 'Knowledge',
    feature: 'Knowledge from solved cases',
    us: true, them: false,
    usDetail: 'Solved cases can become reviewed, anonymous knowledge articles for the next request.',
    themDetail: 'Resolutions often stay buried in closed tickets.',
  },
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
              An enterprise operating layer.
            </span>
          </h2>
          <p className="text-muted-foreground mt-6 text-base md:text-lg leading-relaxed">
            Traditional portals open tickets and wait. We combine AI triage, vetted experts and hourly pricing that you approve,
            with knowledge that builds up over time.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 auto-rows-[220px] gap-4 max-w-6xl mx-auto mb-24">
          {valuePillars.map((p, i) => (
            <div
              key={i}
              style={{ ['--glow' as string]: accents[p.accent].glow }}
              className={`group relative ${radius.tile} border border-border/40 bg-card/40 backdrop-blur-xl overflow-hidden hover:border-primary/40 motion-safe:transition-all motion-safe:duration-500 motion-safe:hover:-translate-y-1 hover:shadow-[0_30px_80px_-20px_rgba(var(--glow),0.35)] ${p.span ?? ''}`}
            >
              {/* Background image — `tileImageAlt` decides whether to mark it
                  decorative (alt="") or descriptive based on whether the
                  tile already exposes a visible <h3> title. Here it does,
                  so the helper returns "" and SR users aren't told the
                  same thing twice. */}
              <img
                src={p.image}
                alt={tileImageAlt({ tileLabel: p.title, fallback: p.imageAlt })}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover opacity-25 group-hover:opacity-40 motion-safe:transition-opacity motion-safe:duration-700 motion-safe:group-hover:scale-105 motion-safe:transition-transform pointer-events-none"
              />
              {/* Readability scrim over the image */}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-card via-card/85 to-card/40"
              />
              {/* Accent radial glow tied to the icon's gradient */}
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-60 group-hover:opacity-100 motion-safe:transition-opacity motion-safe:duration-500"
                style={{
                  background:
                    'radial-gradient(circle at 20% 0%, rgba(var(--glow),0.22), transparent 55%)',
                }}
              />
              {/* Subtle top-edge sheen */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent" />

              <div className="relative h-full p-7 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  {/* Shared iconPlate — same gradient + motion as the rest of the landing */}
                  <div className={iconPlate(p.accent, p.featured ? 'md' : 'sm')}>
                    <p.Icon
                      size={p.featured ? 28 : 20}
                      strokeWidth={1.75}
                      absoluteStrokeWidth
                      className="text-white"
                      aria-hidden="true"
                    />
                  </div>
                  <span
                    className={`inline-flex items-center justify-center w-9 h-9 ${radius.pill} bg-background/60 border border-border/50 text-muted-foreground/60 group-hover:text-primary group-hover:border-primary/40 group-hover:bg-primary/5 motion-safe:transition-all motion-safe:duration-300 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5 ${shadow.soft}`}
                    aria-hidden="true"
                  >
                    <ArrowUpRight size={16} strokeWidth={2} absoluteStrokeWidth />
                  </span>
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
            <p className="text-muted-foreground mt-4 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
              The difference isn't a longer feature list — it's <span className="text-foreground font-semibold">how each capability is delivered</span>.
              Hover any row for the concrete "how" behind the headline.
            </p>
          </div>

          <div className="relative rounded-[2rem] border border-border/40 bg-card/30 backdrop-blur-xl overflow-hidden shadow-2xl shadow-primary/5">
            {/* Highlight column for "us" — widened slightly so it lands
                under the column on every breakpoint without leaking
                onto the "Theirs" column. */}
            <div className="absolute top-0 bottom-0 left-1/2 md:left-[calc(50%+10%)] w-[28%] md:w-[22%] bg-gradient-to-b from-primary/[0.08] via-primary/[0.04] to-transparent pointer-events-none" />

            {/* Header */}
            <div className="relative grid grid-cols-[1fr_auto_auto] md:grid-cols-[2fr_1fr_1fr] gap-4 md:gap-8 px-6 md:px-10 py-6 border-b border-border/40">
              <span className="text-[11px] md:text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground self-center">
                Capability
              </span>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-primary/70">Ours</span>
                <span className="text-sm md:text-base font-black text-foreground">AI Support 360</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/70">Theirs</span>
                <span className="text-sm md:text-base font-bold text-muted-foreground">Typical Portals</span>
              </div>
            </div>

            {/* Grouped rows. We render a tiny category header before
                the first row of each group so the table reads like
                chapters rather than a flat checklist. */}
            {comparison.map((row, i) => {
              const prev = comparison[i - 1];
              const newGroup = !prev || prev.category !== row.category;
              const isLast = i === comparison.length - 1;
              return (
                <div key={i}>
                  {newGroup && (
                    <div className="relative px-6 md:px-10 pt-6 pb-2">
                      <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary/70">
                        <span className="h-px w-6 bg-primary/40" />
                        {row.category}
                      </span>
                    </div>
                  )}
                  <div
                    className={`relative grid grid-cols-[1fr_auto_auto] md:grid-cols-[2fr_1fr_1fr] gap-4 md:gap-8 px-6 md:px-10 py-5 items-start group hover:bg-muted/10 transition-colors ${
                      !isLast ? 'border-b border-border/20' : ''
                    }`}
                  >
                    {/* Capability + the "how" sentence underneath */}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-start gap-2">
                        <div className="text-sm md:text-base text-foreground/90 font-semibold leading-snug flex-1">
                          {row.feature}
                        </div>
                        <LearnMorePopover row={row} />
                      </div>
                      {row.usDetail && (
                        <div className="hidden md:block text-[11px] md:text-xs text-muted-foreground leading-relaxed">
                          <span className="text-primary/80 font-semibold">Us: </span>
                          {row.usDetail}
                        </div>
                      )}
                      {row.themDetail && (
                        <div className="hidden md:block text-[11px] md:text-xs text-muted-foreground/70 leading-relaxed">
                          <span className="font-semibold text-muted-foreground">Them: </span>
                          {row.themDetail}
                        </div>
                      )}
                    </div>

                    {/* Us cell */}
                    <div className="flex flex-col items-center gap-1.5 self-start">
                      <CompareCell value={row.us} variant="us" />
                    </div>

                    {/* Them cell */}
                    <div className="flex flex-col items-center gap-1.5 min-w-[90px] self-start">
                      <CompareCell value={row.them} variant="them" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-center text-xs text-muted-foreground/60 mt-6 italic">
            Comparison based on common features of generic IT helpdesk and ticketing tools. It describes how AI Support 360 works and is not a promise of response or resolution times.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Single check / cross / label cell for the comparison table. Pulled
 * out so the row markup stays readable and so the same visual rules
 * (gradient halo for "us yes", muted plate for everything else) apply
 * consistently across all rows.
 *
 *  - boolean true  → check icon
 *  - boolean false → cross icon
 *  - string        → small pill with the literal label (e.g. "Varies")
 *
 * The `variant` only affects the "yes" treatment: only our column gets
 * the gradient halo, so the eye is pulled to the differences.
 */
function CompareCell({ value, variant }: { value: CompareCellValue; variant: 'us' | 'them' }) {
  if (value === true) {
    if (variant === 'us') {
      return (
        <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/30 motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-6">
          <div aria-hidden="true" className="absolute inset-0 rounded-2xl bg-primary/40 blur-lg -z-10" />
          <Check size={18} strokeWidth={3} absoluteStrokeWidth className="relative text-primary-foreground" aria-label="Included" />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-2xl bg-muted/40 border border-border/50 flex items-center justify-center text-muted-foreground/55">
        <Check size={18} strokeWidth={2.5} absoluteStrokeWidth aria-label="Included" />
      </div>
    );
  }

  if (value === false) {
    return (
      <div className="w-10 h-10 rounded-2xl bg-muted/40 border border-border/50 flex items-center justify-center text-muted-foreground/45">
        <X size={18} strokeWidth={2.25} absoluteStrokeWidth aria-label="Not included" />
      </div>
    );
  }

  // String label (e.g. "Generic", "Varies")
  return (
    <span className="text-xs font-medium text-muted-foreground/80 italic px-3 py-1 rounded-full bg-muted/40 border border-border/40 whitespace-nowrap">
      {value}
    </span>
  );
}

/**
 * Per-row "Learn more" popover. Works on tap (mobile) and click/keyboard
 * (desktop) via Radix Popover. Visible on every breakpoint so mobile —
 * where the inline us/them sentences are hidden to preserve layout — can
 * still surface the same delivery details on demand.
 */
function LearnMorePopover({ row }: { row: CompareRow }) {
  if (!row.usDetail && !row.themDetail) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Learn more about ${row.feature}`}
          className="shrink-0 inline-flex items-center gap-1 text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-primary px-2 py-1 rounded-full border border-border/40 hover:border-primary/40 bg-background/40 hover:bg-primary/5 transition-colors"
        >
          <Info size={11} strokeWidth={2.25} aria-hidden="true" />
          <span className="hidden sm:inline">Learn more</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-2rem))] p-4 space-y-3 border-border/50 bg-card/95 backdrop-blur-xl"
      >
        <div className="text-xs font-bold uppercase tracking-wider text-foreground/90">
          {row.feature}
        </div>
        {row.usDetail && (
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="text-primary font-semibold">Us: </span>
            {row.usDetail}
          </div>
        )}
        {row.themDetail && (
          <div className="text-xs leading-relaxed text-muted-foreground/80">
            <span className="font-semibold text-muted-foreground">Them: </span>
            {row.themDetail}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
