import { ReactNode } from 'react';

type Props = {
  /** The small uppercase eyebrow text inside the badge pill */
  eyebrow: string;
  /** Title — either a plain string or rich JSX (e.g. with a gradient highlight word) */
  title: ReactNode;
  /** Optional subtitle below the title */
  subtitle?: ReactNode;
  /** Center horizontally (default true). Set false for left-aligned headers. */
  centered?: boolean;
  className?: string;
};

/**
 * Unified section header used across the landing page.
 * Pairs:
 *  - a glassy badge pill with a pulsing primary dot
 *  - a large display title (use <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">…</span> for the highlight word)
 *  - an optional muted subtitle
 *
 * Animation respects `prefers-reduced-motion`.
 */
export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
  centered = true,
  className = '',
}: Props) {
  const align = centered ? 'text-center mx-auto' : 'text-left';
  return (
    <div
      className={`max-w-3xl mb-14 md:mb-20 motion-safe:animate-fade-in-up ${align} ${className}`}
    >
      <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-foreground/5 border border-border/60 text-foreground/80 text-xs font-bold tracking-[0.2em] uppercase mb-5 backdrop-blur-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse-soft" />
        {eyebrow}
      </span>
      <h2 className="text-4xl md:text-6xl font-black text-foreground tracking-tight leading-[1.05]">
        {title}
      </h2>
      {subtitle && (
        <p className="text-muted-foreground mt-6 text-base md:text-lg leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}
