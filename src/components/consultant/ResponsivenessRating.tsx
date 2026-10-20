import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RatingStars from '@/components/client/RatingStars';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { blendedRating } from '../../../supabase/functions/_shared/responsiveness';
import { formatMinutes, LEVEL_LABEL } from '@/lib/responsivenessFormat';

function useBlend(consultantId: string | null | undefined, rating: number, reviews: number) {
  const { publicOn, byId, reviewWeight } = usePublicResponsiveness();
  const r = consultantId ? byId.get(consultantId) : undefined;
  const blend = blendedRating({
    clientRating: rating, reviewCount: reviews, stars: r?.stars ?? null, level: r?.level ?? null, publicOn,
    settings: { review_weight: reviewWeight },
  });
  return { blend, r, publicOn };
}

/**
 * The overall displayed rating: client reviews blended with the computed responsiveness stars (admin weights, default
 * 85 % / 15 %) once the consultant has the minimum sample and the owner made responsiveness public. Client stars are
 * never changed; the breakdown is shown on hover/focus and read to screen readers.
 */
export function BlendedRatingStars({ consultantId, rating, reviews, size = 'md', className, interactive = true }: {
  consultantId?: string | null; rating: number; reviews: number; size?: 'sm' | 'md' | 'lg'; className?: string; interactive?: boolean;
}) {
  const { t } = useTranslation();
  const { blend } = useBlend(consultantId, rating, reviews);
  if (!blend.applied || blend.overall == null) return <RatingStars rating={rating} reviews={reviews} size={size} className={className} />;
  const breakdown = t('responsiveness.blend_breakdown', 'Client reviews {{client}} ({{cw}}%) + Responsiveness {{resp}} ({{rw}}%, calculated automatically) = {{overall}}', {
    client: blend.client?.toFixed(1), cw: blend.clientWeight, resp: blend.responsiveness, rw: blend.responsivenessWeight, overall: blend.overall.toFixed(2),
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={interactive ? 0 : undefined} title={interactive ? undefined : breakdown} className="inline-block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="blended-rating">
          <RatingStars rating={blend.overall} reviews={reviews} size={size} className={className} />
          <span className="sr-only">{breakdown}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{breakdown}</TooltipContent>
    </Tooltip>
  );
}

/** Read-only "Responsiveness" line next to the client ratings (clearly labelled as calculated automatically). */
export function ResponsivenessReviewLine({ consultantId }: { consultantId?: string | null }) {
  const { t, i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const { publicOn, byId } = usePublicResponsiveness();
  if (!publicOn || !consultantId) return null;
  const r = byId.get(consultantId);
  const level = r?.level ?? 'new';
  const levelName = ar ? LEVEL_LABEL[level][1] : t(`responsiveness.level_${level}`, LEVEL_LABEL[level][0]);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-3" data-testid="responsiveness-review-line">
      <span className="text-sm font-semibold text-foreground">{t('responsiveness.chip_label', 'Responsiveness')}</span>
      {level === 'new' || r?.stars == null ? (
        <span className="text-xs text-muted-foreground">{t('responsiveness.review_new', 'Not enough requests yet to calculate it.')}</span>
      ) : (
        <>
          <RatingStars rating={r.stars} reviews={0} size="sm" className="[&>div:last-child>span:last-child]:hidden" />
          <span className="text-xs text-muted-foreground">
            {levelName} · {t('responsiveness.chip_details', 'Median reply {{median}} · {{rate}}% answered', { median: formatMinutes(r.median_minutes, ar), rate: r.response_rate ?? 0 })}
          </span>
        </>
      )}
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Info className="h-3 w-3" aria-hidden="true" />
        {t('responsiveness.review_auto', 'Calculated automatically from response times; it does not change client ratings.')}
      </span>
    </div>
  );
}
