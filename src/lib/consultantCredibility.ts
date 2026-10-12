/** The credibility score of a consultant profile (0-100) and the star fills of a rating. One place, used by the profile header and the credibility card. */
export type CredibilityInput = {
  certifications?: unknown[] | null;
  skills?: Array<{ years?: number | null }> | null;
  rating?: number | null;
  aiScore?: number | null;
};

export type CredibilitySegment = { label: string; value: number; max: number; color: string; highlight?: boolean };

export type CredibilityTone = 'high' | 'good' | 'fair' | 'low';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function credibility(input: CredibilityInput) {
  const interviewScore = Math.max(0, Math.min(100, num(input.aiScore)));
  const hasInterview = interviewScore > 0;
  const certScore = Math.min((input.certifications?.length ?? 0) * 10, 25);
  const expScore = Math.min((input.skills ?? []).reduce((sum, s) => sum + num(s.years), 0), 25);
  const reviewScore = Math.min(Math.round(Math.max(0, num(input.rating)) * 5), 25);
  // the interview adds up to 20 points when it was taken; 5 points for a complete profile
  const interviewContrib = hasInterview ? Math.round((interviewScore / 100) * 20) : 0;
  const profileScore = 5;
  const total = Math.min(certScore + expScore + reviewScore + interviewContrib + profileScore, 100);
  const segments: CredibilitySegment[] = [
    { label: 'Certifications', value: certScore, max: 25, color: 'bg-blue-500' },
    { label: 'Experience', value: expScore, max: 25, color: 'bg-green-500' },
    { label: 'Client Reviews', value: reviewScore, max: 25, color: 'bg-amber-500' },
    { label: 'AI Interview', value: interviewContrib, max: 20, color: 'bg-purple-500', highlight: true },
    { label: 'Profile Completeness', value: profileScore, max: 5, color: 'bg-muted-foreground/40' },
  ];
  const label = total >= 80 ? 'Highly Credible' : total >= 60 ? 'Credible' : total >= 40 ? 'Moderate' : 'Building Profile';
  return { total, label, hasInterview, interviewScore, interviewContrib, segments };
}

export function credibilityTone(total: number): CredibilityTone {
  return total >= 80 ? 'high' : total >= 60 ? 'good' : total >= 40 ? 'fair' : 'low';
}

/** Five numbers between 0 and 1: how much of each star is filled for the rating (4.6 gives 1, 1, 1, 1, 0.6). */
export function starFills(rating: number | null | undefined): number[] {
  const r = Math.max(0, Math.min(5, num(rating)));
  return Array.from({ length: 5 }, (_, i) => Math.round(Math.max(0, Math.min(1, r - i)) * 100) / 100);
}

