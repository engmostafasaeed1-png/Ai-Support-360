import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { useRatingMinReviews, useRingStats } from '@/hooks/useRingStats';
import { ringSummary, type RingSummary } from '@/lib/ringAvatar';
import RingAvatar, { type RingAvatarProps, type RingSize } from './RingAvatar';
import RingPills from './RingPills';

export interface RingSource {
  consultantId?: string | null;
  /** Pure client rating and review count, when the card already has them (otherwise they are read once). */
  rating?: number | null;
  reviews?: number | null;
  badge?: string | null;
  verified?: boolean;
}

/**
 * The ring numbers for one consultant, the same everywhere: consultants.rating / total_reviews (client reviews only)
 * and responsiveness_public_summary (only while public).
 */
export function useConsultantRingSummary({ consultantId, rating, reviews, badge, verified }: RingSource): RingSummary {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const { publicOn, byId } = usePublicResponsiveness();
  const minReviews = useRatingMinReviews();
  const known = rating !== undefined && reviews !== undefined;
  const stats = useRingStats(consultantId, !known);
  const s = known ? { rating, reviews, badge, verified } : { rating: stats.data?.rating, reviews: stats.data?.reviews, badge: badge ?? stats.data?.badge, verified: verified ?? stats.data?.verified };
  const resp = consultantId ? byId.get(consultantId) ?? null : null;
  return useMemo(() => ringSummary({
    rating: s.rating, reviews: s.reviews, minReviews, publicOn, resp, badge: s.badge, verified: s.verified, lang,
  }), [s.rating, s.reviews, s.badge, s.verified, minReviews, publicOn, resp, lang]);
}

export interface ConsultantRingProps extends Omit<RingAvatarProps, 'summary' | 'size'>, RingSource {
  size?: RingSize;
}

/** The performance ring wherever a consultant is shown. */
export default function ConsultantRing({ consultantId, rating, reviews, badge, verified, size = 'md', ...rest }: ConsultantRingProps) {
  const summary = useConsultantRingSummary({ consultantId, rating, reviews, badge, verified });
  return <RingAvatar size={size} summary={summary} {...rest} />;
}

/** The ring's two always-visible pills (rating, responsiveness), from the same numbers as the ring. */
export function ConsultantRingPills({ size = 'sm', className, ...source }: RingSource & { size?: 'sm' | 'lg'; className?: string }) {
  const summary = useConsultantRingSummary(source);
  return <RingPills summary={summary} size={size} className={className} />;
}
