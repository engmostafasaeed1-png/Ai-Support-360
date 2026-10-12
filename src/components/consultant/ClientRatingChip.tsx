import RatingStars from '@/components/client/RatingStars';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useClientRatingSummaries, type ClientRatingSummary } from '@/hooks/useClientRatings';
import { cn } from '@/lib/utils';

interface Props {
  clientId: string;
  /** A summary already loaded for a list (one batched call); when absent the chip loads its own. */
  summary?: ClientRatingSummary | null;
  /** Show the criteria averages in a popover (case page header only). */
  details?: boolean;
  className?: string;
}

function Inner({ summary, details, className }: { summary: ClientRatingSummary | null | undefined; details?: boolean; className?: string }) {
  if (!summary || summary.review_count === 0) {
    return <span className={cn('text-xs text-muted-foreground', className)}>New client: no ratings yet</span>;
  }
  const chip = (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)} data-testid="client-rating-chip">
      <RatingStars rating={summary.avg_score} reviews={summary.review_count} size="sm" />
      <span className="text-muted-foreground">Client rating</span>
    </span>
  );
  const rows = [
    ['Communication', summary.communication_avg],
    ['Clarity of requirements', summary.clarity_avg],
    ['Cooperation', summary.cooperation_avg],
  ].filter(([, v]) => v !== null) as [string, number][];
  const hasDetails = details && (rows.length > 0 || summary.would_work_again_pct !== null);
  if (!hasDetails) return chip;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{chip}</button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 text-sm">
        {rows.map(([label, v]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-foreground" dir="ltr">{v.toFixed(1)}</span>
          </div>
        ))}
        {summary.would_work_again_pct !== null && (
          <p className="text-xs text-muted-foreground"><span dir="ltr">{summary.would_work_again_pct}%</span> <span>would work with them again</span></p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SelfLoading({ clientId, details, className }: Omit<Props, 'summary'>) {
  const { data, isLoading } = useClientRatingSummaries([clientId]);
  if (isLoading) return null;
  return <Inner summary={data?.get(clientId)} details={details} className={className} />;
}

export default function ClientRatingChip({ clientId, summary, details, className }: Props) {
  if (summary !== undefined) return <Inner summary={summary} details={details} className={className} />;
  return <SelfLoading clientId={clientId} details={details} className={className} />;
}
