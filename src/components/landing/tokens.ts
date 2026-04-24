/**
 * Shared landing-page design tokens.
 *
 * One source of truth for the surfaces, borders, radii, shadows, and
 * accent palette used across the modernized marketing sections
 * (How It Works, Why Choose Us, Industries, Testimonials, FAQ, …).
 *
 * Tokens are expressed as Tailwind class strings so they compose with
 * the existing semantic HSL variables defined in `src/index.css`
 * (--background, --primary, --accent, --border, …) — never hard-code
 * raw colors in components.
 *
 * If you need to change the look of every tile in the marketing
 * landing page, edit this file and nothing else.
 */

// ─── Surfaces ────────────────────────────────────────────────────────
// Glassy card surface used for tiles, accordions, and forms.
export const surface = {
  /** Default tile surface — translucent card on top of any background. */
  card: 'bg-card/70 backdrop-blur-sm',
  /** Hover state — fully opaque card with a soft lift. */
  cardHover: 'hover:bg-card hover:-translate-y-1',
  /** Optional muted backdrop for full-section backgrounds. */
  section: 'bg-background',
} as const;

// ─── Borders ─────────────────────────────────────────────────────────
export const border = {
  /** Default border for tiles and accordion items. */
  base: 'border border-border/60',
  /** Hover border tint — uses primary at 40% to suggest interactivity. */
  hover: 'hover:border-primary/40',
  /** Active/open state border (e.g. accordion data-[state=open]). */
  active: 'border-primary/40',
} as const;

// ─── Radii ───────────────────────────────────────────────────────────
// Aligned to the existing `--radius: 0.75rem` token family.
export const radius = {
  /** Pills, eyebrow tags, small badges. */
  pill:  'rounded-full',
  /** Inline icon plates inside tiles (sm). */
  iconSm: 'rounded-xl',
  /** Icon plates / chips inside tiles. */
  icon:  'rounded-2xl',
  /** Tile cards. */
  tile:  'rounded-3xl',
} as const;

// ─── Shadows ─────────────────────────────────────────────────────────
export const shadow = {
  /** Resting shadow for floating elements (icon plates). */
  rest:  'shadow-lg',
  /** Hover shadow for cards. */
  hover: 'hover:shadow-2xl',
  /** Subtle shadow for popover-like badges. */
  soft:  'shadow-md',
} as const;

// ─── Motion ──────────────────────────────────────────────────────────
// Wrapped in `motion-safe:` so reduced-motion users get no animation.
export const motion = {
  /** Standard transition for hover/active state changes on a tile. */
  transition:    'motion-safe:transition-all motion-safe:duration-500',
  /** Faster opacity-only transition (sheen, icon color, etc). */
  transitionFast:'motion-safe:transition-opacity motion-safe:duration-500',
  /** Entrance animation for grid items. */
  enter:         'motion-safe:animate-fade-in-up',
  /** Standalone hover lift (used together with `transition`). */
  liftOnHover:   'motion-safe:hover:-translate-y-1',
} as const;

// ─── Sheen overlay ───────────────────────────────────────────────────
/**
 * Subtle gradient sheen that fades in on hover. Use as an absolutely
 * positioned overlay child inside a tile (with `pointer-events-none`).
 */
export const sheen =
  'absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 ' +
  'motion-safe:transition-opacity motion-safe:duration-500 pointer-events-none ' +
  'bg-gradient-to-br from-primary/[0.04] via-transparent to-accent/[0.04]';

// ─── Composed tile preset ────────────────────────────────────────────
/**
 * Canonical tile look used by Why Choose Us, How It Works, and any
 * future tile-style section. Compose with grid-span/height classes
 * at the call site.
 */
export const tile = [
  'group relative',
  radius.tile,
  border.base,
  surface.card,
  motion.transition,
  border.hover,
  surface.cardHover,
  shadow.hover,
  motion.enter,
].join(' ');

// ─── Accent palette ──────────────────────────────────────────────────
/**
 * Per-tile color identity. Each entry is reused across How It Works
 * (step icon plate) and Why Choose Us (overlay tint) so a step always
 * matches its corresponding feature visually.
 *
 * - `gradient`: tailwind gradient stops for the icon plate
 * - `glow`:     RGB triplet used inside `rgba(var(--glow), …)` shadows
 *               (glows are color-only, not picked up by Tailwind JIT)
 */
export type AccentName = 'sky' | 'violet' | 'amber' | 'emerald' | 'rose' | 'cyan';

export const accents: Record<AccentName, { gradient: string; glow: string }> = {
  sky:     { gradient: 'from-cyan-500 to-blue-600',     glow: '59, 130, 246'  },
  violet:  { gradient: 'from-violet-500 to-purple-600', glow: '139, 92, 246'  },
  amber:   { gradient: 'from-amber-500 to-orange-600',  glow: '245, 158, 11'  },
  emerald: { gradient: 'from-emerald-500 to-teal-600',  glow: '16, 185, 129'  },
  rose:    { gradient: 'from-rose-500 to-pink-600',     glow: '244, 63, 94'   },
  cyan:    { gradient: 'from-sky-500 to-cyan-600',      glow: '14, 165, 233'  },
};

// ─── Icon plate preset ───────────────────────────────────────────────
/**
 * Returns the className for the gradient icon plate used on tiles.
 * Pass an `AccentName` for the gradient tint.
 */
export const iconPlate = (accent: AccentName, size: 'sm' | 'md' = 'md') => {
  const dim = size === 'sm' ? 'w-11 h-11' : 'w-16 h-16';
  return [
    dim,
    radius.icon,
    `bg-gradient-to-br ${accents[accent].gradient}`,
    'flex items-center justify-center',
    shadow.rest,
    motion.transition,
    'motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-105',
  ].join(' ');
};
