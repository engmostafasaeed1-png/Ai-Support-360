import { useState } from 'react';
import { cn } from '@/lib/utils';
import { credibilityTone } from '@/lib/consultantCredibility';

interface CredibilityAvatarProps {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  total: number;
  statusClass: string;
  href?: string;
}

const toneClasses = {
  high: 'text-success',
  good: 'text-info',
  fair: 'text-warning',
  low: 'text-muted-foreground',
};

export default function CredibilityAvatar({ name, initials, avatarUrl, total, statusClass, href = '#credibility' }: CredibilityAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const score = Math.max(0, Math.min(100, Number.isFinite(total) ? total : 0));
  const tone = credibilityTone(score);
  const circumference = 2 * Math.PI * 46;
  const label = `Credibility score ${score} percent. Open the credibility details.`;
  return (
    <a href={href} aria-label={label} className="relative inline-flex flex-col items-center rounded-full pb-3">
      <div className="relative h-28 w-28 sm:h-32 sm:w-32">
        <svg viewBox="0 0 100 100" role="img" aria-label={label} className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="46" strokeWidth="5" fill="currentColor" stroke="hsl(var(--border))" className="text-card" />
          <circle cx="50" cy="50" r="46" strokeWidth="5" fill="none" stroke="currentColor" strokeLinecap={score > 0 ? 'round' : 'butt'}
            strokeDasharray={`${circumference * score / 100} ${circumference}`} className={toneClasses[tone]} data-testid="credibility-arc" data-tone={tone} />
        </svg>
        <div className="absolute inset-[9px] flex items-center justify-center overflow-hidden rounded-full gradient-primary text-3xl font-bold text-primary-foreground sm:text-4xl">
          {avatarUrl && failedUrl !== avatarUrl ? <img src={avatarUrl} alt={name} className="h-full w-full rounded-full object-cover" onError={() => setFailedUrl(avatarUrl)} /> : <span>{initials}</span>}
        </div>
        <span aria-hidden="true" className={cn('absolute bottom-1 end-1 h-5 w-5 rounded-full border-2 border-card', statusClass)} />
      </div>
      <span data-testid="credibility-pill" className={cn('z-10 -mt-1 inline-flex gap-1 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-bold shadow-card', toneClasses[tone])}>
        <span>{score}%</span><span>credible</span>
      </span>
    </a>
  );
}