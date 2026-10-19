import { useTranslation } from 'react-i18next';

/** Small client-facing line: profile completion bar plus the AI interview tier, for directory and bid cards. */
export default function CompletionBadge({ percent, tier, className = '' }: { percent: number; tier?: string | null; className?: string }) {
  const { t } = useTranslation();
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={t('consultants.completion', 'Profile completion')}>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${p}%` }} />
        </span>
        {t('consultants.completion_pct', 'Profile {{percent}}%', { percent: p })}
      </span>
      {tier && (
        <span className="inline-flex items-center rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
          {t('consultants.interview_tier', 'AI interview: {{tier}}', { tier })}
        </span>
      )}
    </div>
  );
}
