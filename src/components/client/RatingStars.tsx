import { useId } from 'react';
import { cn } from '@/lib/utils';
import { starFills } from '@/lib/consultantCredibility';

interface RatingStarsProps {
  rating: number;
  reviews: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const starPath = 'm12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.19l-5.56 2.93 1.06-6.2L3 9.53l6.22-.9L12 3Z';

export default function RatingStars({ rating, reviews, size = 'md', className }: RatingStarsProps) {
  const id = useId();
  const fills = starFills(rating);
  const value = fills.reduce((sum, fill) => sum + fill, 0);
  return (
    <div className={cn(size === 'sm' ? 'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs' : 'space-y-1.5', className)}>
      <div role="img" aria-label={`Rating ${value} out of 5`} className="flex shrink-0 items-center gap-0.5" dir="ltr">
        {fills.map((fill, index) => (
          <svg key={index} viewBox="0 0 24 24" aria-hidden="true" data-testid="rating-star" data-fill={fill}
            className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4')}>
            <defs><clipPath id={`${id}-${index}`}><rect width={24 * fill} height="24" /></clipPath></defs>
            <path d={starPath} fill="currentColor" className="text-muted-foreground/40" />
            <path d={starPath} fill="currentColor" className="text-warning" clipPath={`url(#${id}-${index})`} />
          </svg>
        ))}
      </div>
      <div className={cn('flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', size === 'lg' && 'flex-col')}>
        <span className={cn('font-bold text-foreground', size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-sm' : 'text-xs')}>{value.toFixed(1)}</span>
        {reviews > 0 ? (
          <span className="inline-flex gap-1 text-xs font-normal text-muted-foreground">
            {size === 'sm' ? <><span>(</span><span>{reviews}</span><span>)</span></> : <><span>{reviews}</span><span>{reviews === 1 ? 'review' : 'reviews'}</span></>}
          </span>
        ) : <span className="text-xs font-normal text-muted-foreground">No reviews yet</span>}
      </div>
    </div>
  );
}