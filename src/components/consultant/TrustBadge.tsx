import { Award, Sparkles, ShieldCheck, Medal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrustBadgeProps {
  badge?: string | null;
  credits?: number | null;
  size?: 'sm' | 'md';
  className?: string;
}

const tierConfig: Record<string, { label: string; cls: string; icon: typeof Award }> = {
  Gold:     { label: 'Gold',     cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 ring-1 ring-amber-300/50',   icon: Medal },
  Silver:   { label: 'Silver',   cls: 'bg-slate-200 text-slate-800 dark:bg-slate-700/40 dark:text-slate-200 ring-1 ring-slate-300/60',  icon: Medal },
  Bronze:   { label: 'Bronze',   cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 ring-1 ring-orange-300/50', icon: Medal },
  Verified: { label: 'Verified', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 ring-1 ring-emerald-300/50', icon: ShieldCheck },
};

/**
 * Compact trust indicator showing the consultant's AI Interview badge tier
 * and their credibility credits — used on consultant cards during matching.
 */
export function TrustBadge({ badge, credits, size = 'sm', className }: TrustBadgeProps) {
  const hasBadge = !!badge && tierConfig[badge];
  const hasCredits = typeof credits === 'number' && credits > 0;
  if (!hasBadge && !hasCredits) return null;

  const padding = size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-[10px]';
  const iconSize = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      {hasBadge && (() => {
        const cfg = tierConfig[badge!];
        const Icon = cfg.icon;
        return (
          <span
            className={cn('inline-flex items-center gap-0.5 rounded-full font-semibold', padding, cfg.cls)}
            title={`AI Interview: ${cfg.label} tier`}
          >
            <Icon className={iconSize} />
            {cfg.label}
          </span>
        );
      })()}
      {hasCredits && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 rounded-full font-semibold bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300 ring-1 ring-violet-300/50',
            padding,
          )}
          title={`${credits} credibility credits`}
        >
          <Sparkles className={iconSize} />
          {credits}
        </span>
      )}
    </div>
  );
}
