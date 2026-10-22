import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { formatRate, tierFor, tierRangeLabel, type Tier } from '@/lib/referrals';
import { cn } from '@/lib/utils';

/**
 * Feature Z reward tiers: the rate rises with the number of VERIFIED referred consultants (not suspended). Shows every
 * tier, highlights the current one (when a count is given) and how many more are needed for the next. Display only;
 * the database stores the rate of each reward line when it is created.
 */
export default function TierLadder({ tiers, count, compact = false }: { tiers: Tier[]; count?: number | null; compact?: boolean }) {
  const { t } = useTranslation();
  const cur = count == null ? null : tierFor(count, tiers);
  const pct = cur && cur.next ? Math.min(100, Math.round(((count! - cur.min) / (cur.next.min - cur.min)) * 100)) : 100;
  return (
    <div className="space-y-3 text-sm">
      {cur && (
        <div className="rounded-xl bg-muted/40 p-3 space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('refz.tier_current', 'Your tier: {{name}} - {{rate}} % ({{n}} verified referred consultants)', { name: cur.name, rate: formatRate(cur.rate), n: count })}
          </p>
          {cur.next ? (
            <>
              <Progress value={pct} aria-label={t('refz.tier_progress', 'Progress to the next tier')} />
              <p className="text-xs text-muted-foreground">
                {t('refz.tier_next', '{{needed}} more verified referred consultants to reach {{name}} ({{rate}} %) for new rewards.', { needed: cur.needed, name: cur.next.name, rate: formatRate(cur.next.rate) })}
              </p>
            </>
          ) : <p className="text-xs text-muted-foreground">{t('refz.tier_top', 'You are in the highest tier.')}</p>}
        </div>
      )}
      <table className="w-full text-xs">
        <caption className="sr-only">{t('refz.tier_table', 'Reward rate by number of verified referred consultants')}</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 text-start font-medium">{t('refz.tier_col_tier', 'Tier')}</th>
            <th className="py-1 text-start font-medium">{t('refz.tier_col_count', 'Verified referred consultants')}</th>
            <th className="py-1 text-end font-medium">{t('refz.tier_col_rate', 'Rate')}</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => (
            <tr key={tier.min} className={cn('border-t border-border/50', cur?.index === i + 1 && 'bg-primary/10 font-semibold')}>
              <td className="py-1.5 ps-1">{tier.name}</td>
              <td className="py-1.5 tabular-nums" dir="ltr">{tierRangeLabel(tiers, i)}</td>
              <td className="py-1.5 pe-1 text-end tabular-nums" dir="ltr">{formatRate(tier.rate)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && (
        <p className="text-[11px] text-muted-foreground">
          {t('refz.tier_rule', 'Only referred consultants who are verified, have at least one paid ticket and are not suspended count. Your tier is checked when each new reward is created; a new rate applies to later rewards only, never to rewards already created. If your count goes down, later rewards use the lower rate.')}
        </p>
      )}
    </div>
  );
}
