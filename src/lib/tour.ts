/** Pure helpers for the consultant product tour state. */
export const TOUR_KEY = 'consultant-welcome';
export const TOUR_VERSION = 1;
export const GETTING_STARTED_DISMISSED_KEY = 'getting-started-dismissed';

export type TourStatus = 'in_progress' | 'completed' | 'skipped';

export interface TourProgress {
  tour_key: string;
  tour_version: number;
  last_step: number;
  completed_at: string | null;
  skipped_at: string | null;
}

export const clampStep = (i: number, total: number): number => {
  if (total <= 0) return 0;
  const n = Number.isFinite(i) ? Math.trunc(i) : 0;
  return Math.min(Math.max(n, 0), total - 1);
};

export const nextStep = (i: number, total: number): number => clampStep(i + 1, total);
export const prevStep = (i: number, total: number): number => clampStep(i - 1, total);

const isCurrentVersion = (p: TourProgress) => p.tour_version >= TOUR_VERSION;

/**
 * Auto-start only on the consultant dashboard, once onboarding is completed (or the consultant just
 * finished it: ?welcome=true), and when there is no progress row, the row is from an older tour
 * version, or the current version was neither completed nor skipped (then it resumes).
 */
export function shouldAutoStart({
  progress, welcomeParam, onboardingCompleted, pathname = '/consultant',
}: { progress: TourProgress | null | undefined; welcomeParam: boolean; onboardingCompleted: boolean; pathname?: string }): boolean {
  const onDashboard = pathname === '/consultant' || pathname === '/consultant/';
  if (!onDashboard) return false;
  if (!onboardingCompleted && !welcomeParam) return false;
  if (!progress) return true;
  if (!isCurrentVersion(progress)) return true;
  return !progress.completed_at && !progress.skipped_at;
}

/** Where to resume: the saved step for an unfinished current-version tour, otherwise 0. */
export function resumeStep(progress: TourProgress | null | undefined, total = Number.MAX_SAFE_INTEGER): number {
  if (!progress || !isCurrentVersion(progress) || progress.completed_at || progress.skipped_at) return 0;
  return clampStep(progress.last_step, total);
}
