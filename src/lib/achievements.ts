// Success stories & achievements: types, the checks the screen shows before saving (the database repeats the hard ones in
// docs/sql/consultant-achievements.sql), readable texts for its error codes, and the automatic platform achievements.
import { contactDetailsInText } from '../../supabase/functions/_shared/assignmentInfo';
import { isRoleKey } from '@/lib/consultantRoles';

export const MAX_ACHIEVEMENTS = 8;
export const OUTCOME_MAX = 400;
export type AchievementStatus = 'self_declared' | 'verified' | 'hidden' | 'rejected';

export interface Achievement {
  id: string;
  consultant_id?: string;
  title: string;
  role_played: string | null;
  sap_area: string | null;
  sap_version: string | null;
  industry: string | null;
  outcome: string;
  year: number | null;
  reference_url: string | null;
  is_public: boolean;
  status: AchievementStatus;
  review_reason?: string | null;
  has_evidence?: boolean;
}
export type AchievementInput = Pick<Achievement, 'title' | 'role_played' | 'sap_area' | 'sap_version' | 'industry' | 'outcome' | 'year' | 'reference_url'>;

/** Columns clients may read (evidence path and review details are not readable). */
export const PUBLIC_ACHIEVEMENT_COLUMNS = 'id, consultant_id, title, role_played, sap_area, sap_version, industry, outcome, year, reference_url, is_public, status, sort';

export type AchievementProblem = 'title' | 'outcome' | 'outcome_long' | 'year' | 'contact' | 'link' | 'role';
export type AchievementWarning = 'client_name' | 'absolute' | 'no_number';

const SHORTENERS = /^(www\.)?(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|cutt\.ly|wa\.me|t\.me)$/i;
/** Public reference link: https, a real host name (no IP, no link shortener, no e-mail), at most 300 characters. */
export function referenceUrlOk(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.length > 300 || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s@]*)?$/i.test(url)) return false;
  const host = url.slice(8).split('/')[0];
  return !/^(\d+\.){3}\d+$/.test(host) && !SHORTENERS.test(host);
}

// Company-looking names ("for Acme Ltd", "شركة ...") and absolute claims are only warnings: the screen asks to rephrase.
const CLIENT_NAME = /\b[A-Z][\w&-]+(?:\s+[A-Z][\w&-]+)*\s+(?:Ltd|LLC|Inc|PLC|GmbH|S\.?A\.?|Co\.?|Company|Corp(?:oration)?|Group|Holding|Bank)\b|شركة\s+\S+|مجموعة\s+\S+|بنك\s+\S+/;
const ABSOLUTE = /\b(best|only|first ever|guaranteed|100\s?%|world[- ]class|number one|#1|never fails?|always)\b|الأفضل|الوحيد|مضمون/i;

export function achievementProblems(a: AchievementInput, now = new Date()): AchievementProblem[] {
  const out: AchievementProblem[] = [];
  const title = a.title?.trim() ?? '';
  const outcome = a.outcome?.trim() ?? '';
  if (title.length < 3 || title.length > 120) out.push('title');
  if (outcome.length < 10) out.push('outcome');
  if (outcome.length > OUTCOME_MAX) out.push('outcome_long');
  if (a.year !== null && a.year !== undefined && (!Number.isInteger(a.year) || a.year < 1980 || a.year > now.getFullYear())) out.push('year');
  if ([title, outcome, a.sap_area, a.sap_version, a.industry].some((t) => contactDetailsInText(t ?? ''))) out.push('contact');
  if (!referenceUrlOk(a.reference_url)) out.push('link');
  if (a.role_played && !isRoleKey(a.role_played)) out.push('role');
  return out;
}

export function achievementWarnings(a: Pick<AchievementInput, 'title' | 'outcome'>): AchievementWarning[] {
  const text = `${a.title ?? ''}\n${a.outcome ?? ''}`;
  const out: AchievementWarning[] = [];
  if (CLIENT_NAME.test(text)) out.push('client_name');
  if (ABSOLUTE.test(text)) out.push('absolute');
  if (a.outcome?.trim() && !/\d/.test(a.outcome)) out.push('no_number');
  return out;
}

/** Database error codes from my_achievement_* as readable text keys. */
export function achievementErrorKey(message: string | null | undefined): string {
  const m = message ?? '';
  for (const k of ['contact_details', 'client_name', 'limit', 'link', 'year', 'incomplete', 'role', 'no_evidence', 'evidence'])
    if (m.includes(`achievement_${k}`)) return `achievements.err_${k}`;
  if (m.includes('rate_limited')) return 'achievements.err_rate';
  if (m.includes('reason_required')) return 'achievements.err_reason';
  return 'achievements.err_generic';
}

/** Cards clients see first: verified before self-declared, then newest year. */
export function topAchievements<T extends Pick<Achievement, 'status' | 'year' | 'is_public'>>(list: T[], n = 2): T[] {
  return list.filter((a) => a.is_public && (a.status === 'verified' || a.status === 'self_declared'))
    .sort((x, y) => (x.status === 'verified' ? 0 : 1) - (y.status === 'verified' ? 0 : 1) || (y.year ?? 0) - (x.year ?? 0))
    .slice(0, n);
}

/** Industries and roles from public stories, for directory filters and matching context. */
export function storyFacets(list: Array<Pick<Achievement, 'industry' | 'role_played' | 'is_public' | 'status'>>): { industries: string[]; roles: string[] } {
  const shown = list.filter((a) => a.is_public && (a.status === 'verified' || a.status === 'self_declared'));
  return {
    industries: [...new Set(shown.map((a) => a.industry?.trim()).filter((x): x is string => !!x))],
    roles: [...new Set(shown.map((a) => a.role_played).filter((x): x is string => !!x))],
  };
}

export type PlatformAchievement = { key: 'solved' | 'success_level' | 'responsiveness' | 'years' | 'founding'; value: string | number };
/** Achievements from existing platform data only (never invented, never ticket text). Missing data = no card. */
export function platformAchievements(x: {
  solved?: number | null; successLevel?: string | null; respLevel?: string | null; joinedAt?: string | null; foundingNumber?: number | null; now?: Date;
}): PlatformAchievement[] {
  const out: PlatformAchievement[] = [];
  if (x.solved && x.solved > 0) out.push({ key: 'solved', value: x.solved });
  if (x.successLevel) out.push({ key: 'success_level', value: x.successLevel });
  if (x.respLevel && x.respLevel !== 'new') out.push({ key: 'responsiveness', value: x.respLevel });
  if (x.joinedAt) {
    const years = Math.floor(((x.now ?? new Date()).getTime() - new Date(x.joinedAt).getTime()) / (365.25 * 86_400_000));
    if (years >= 1) out.push({ key: 'years', value: years });
  }
  if (x.foundingNumber) out.push({ key: 'founding', value: x.foundingNumber });
  return out;
}
