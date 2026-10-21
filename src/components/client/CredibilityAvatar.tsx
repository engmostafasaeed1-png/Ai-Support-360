import { cn } from '@/lib/utils';
import { credibilityTone } from '@/lib/consultantCredibility';
import ConsultantRing from '@/components/consultant/ConsultantRing';

interface CredibilityAvatarProps {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  total: number;
  statusClass: string;
  href?: string;
  /** Feature W: the photo carries the performance ring (client rating + responsiveness). */
  consultantId?: string | null;
  rating?: number | null;
  reviews?: number | null;
  badge?: string | null;
  verified?: boolean;
}

const toneClasses = {
  high: 'text-success',
  good: 'text-info',
  fair: 'text-warning',
  low: 'text-muted-foreground',
};

/** Profile header: the performance ring around the photo, with the credibility score as a separate link below. */
export default function CredibilityAvatar({ name, initials, avatarUrl, total, statusClass, href = '#credibility', consultantId, rating, reviews, badge, verified }: CredibilityAvatarProps) {
  const score = Math.max(0, Math.min(100, Number.isFinite(total) ? total : 0));
  const tone = credibilityTone(score);
  const label = `Credibility score ${score} percent. Open the credibility details.`;
  return (
    <div className="relative inline-flex flex-col items-center gap-3">
      <span className="rounded-full bg-card p-1 shadow-card">
        <ConsultantRing consultantId={consultantId} name={name} initials={initials} avatarUrl={avatarUrl} size="xl" statusClass={statusClass}
          rating={rating ?? 0} reviews={reviews ?? 0} badge={badge} verified={verified} />
      </span>
      <a href={href} aria-label={label} data-testid="credibility-pill" data-tone={tone}
        className={cn('z-10 inline-flex gap-1 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-bold shadow-card hover:underline', toneClasses[tone])}>
        <span>{score}%</span><span>credible</span>
      </a>
    </div>
  );
}
