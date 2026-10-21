/**
 * Feature V: what a consultant must complete before the profile can be submitted (finished).
 * The list itself always comes from the server (consultant_missing_fields + policy for new registrations);
 * this module only groups it into sections, counts it and finds the field on screen.
 */

export const POLICY_ITEM = 'service_policy';

export interface ProfileSection { id: string; key: string; label: string }

/** Profile sections in screen order (ids are the section anchors on the profile page). */
export const PROFILE_SECTIONS: ProfileSection[] = [
  { id: 'profile-details', key: 'details', label: 'Profile details' },
  { id: 'expertise', key: 'expertise', label: 'SAP expertise' },
  { id: 'profile-experience', key: 'experience_profile', label: 'Experience profile' },
  { id: 'experience', key: 'work', label: 'Work experience & CV' },
  { id: 'certifications', key: 'certifications', label: 'Certifications' },
  { id: 'education', key: 'education', label: 'Education' },
  { id: 'projects', key: 'projects', label: 'Projects' },
  { id: 'availability', key: 'availability', label: 'Availability' },
  { id: 'payout-details', key: 'payout', label: 'Payout bank details' },
  { id: 'interview-history', key: 'interview', label: 'AI interview' },
  { id: 'service-policy', key: 'policy', label: 'Consultant Service Policy' },
];

const SECTION_OF: Record<string, string> = {
  display_name: 'profile-details', avatar: 'profile-details', phone: 'profile-details', bio: 'profile-details',
  hourly_rate: 'profile-details', timezone: 'profile-details', languages: 'profile-details', nationality: 'profile-details',
  country: 'profile-details', city: 'profile-details', linkedin_url: 'profile-details', credly_username: 'profile-details',
  github_url: 'profile-details', personal_website: 'profile-details', profile_video_url: 'profile-details',
  sap_role: 'expertise', seniority_level: 'expertise', total_sap_years: 'expertise', sap_roles: 'expertise',
  sap_technologies: 'expertise', skills: 'expertise',
  language_levels: 'profile-experience', work_modes: 'profile-experience', working_week: 'profile-experience',
  industries: 'profile-experience', customer_segments: 'profile-experience', vertical_solutions: 'profile-experience',
  localization_countries: 'profile-experience', localization_solutions: 'profile-experience',
  deployment_experience: 'profile-experience', project_types: 'profile-experience', project_scale: 'profile-experience',
  work_history: 'experience', cv: 'experience', certifications: 'certifications', education: 'education',
  projects: 'projects', availability: 'availability', bank_details: 'payout-details', ai_interview: 'interview-history',
  [POLICY_ITEM]: 'service-policy',
};

export function sectionOf(key: string): string {
  return SECTION_OF[key] ?? 'profile-details';
}

export interface ChecklistItem { key: string; label: string; sectionId: string; sectionLabel: string }
export interface Checklist {
  missing: ChecklistItem[];
  total: number;
  left: number;
  done: number;
  percent: number;
  complete: boolean;
  bySection: Record<string, number>;
}

/** Missing items in screen order, with counts. `total` is the number of required items (never below what is missing). */
export function buildChecklist(missingKeys: string[], total: number, labelOf: (key: string) => string, sectionLabelOf: (s: ProfileSection) => string = (s) => s.label): Checklist {
  const order = new Map(PROFILE_SECTIONS.map((s, i) => [s.id, i]));
  const unique = Array.from(new Set(missingKeys));
  const missing = unique
    .map((key, i) => ({ key, i, sectionId: sectionOf(key) }))
    .sort((a, b) => (order.get(a.sectionId)! - order.get(b.sectionId)!) || a.i - b.i)
    .map(({ key, sectionId }) => {
      const section = PROFILE_SECTIONS.find((s) => s.id === sectionId)!;
      return { key, label: labelOf(key), sectionId, sectionLabel: sectionLabelOf(section) };
    });
  const all = Math.max(total, missing.length);
  const left = missing.length;
  const bySection: Record<string, number> = {};
  for (const m of missing) bySection[m.sectionId] = (bySection[m.sectionId] ?? 0) + 1;
  return {
    missing, total: all, left, done: all - left, bySection, complete: left === 0,
    percent: all === 0 ? 100 : Math.round(((all - left) / all) * 100),
  };
}

/** Reads the server's rejection ("missing_required:bio,cv") into the list of missing keys. */
export function parseMissingRequired(message: string | null | undefined): string[] | null {
  const m = String(message ?? '').match(/missing_required:([a-z0-9_,]+)/i);
  return m ? m[1].split(',').filter(Boolean) : null;
}

export type SubmissionState = 'draft' | 'submitted' | 'verified';
export function submissionState(submittedAt: string | null | undefined, verificationStatus: string | null | undefined): SubmissionState {
  if (verificationStatus === 'verified') return 'verified';
  return submittedAt ? 'submitted' : 'draft';
}

/**
 * Draft saving rule: a section is always saved, except that a required field which already had a value may not be
 * emptied (that is what wiped profiles before). Returns the required field keys being cleared in this patch.
 */
export function requiredFieldsCleared(patch: Record<string, unknown>, fieldOf: Record<string, string>, isRequired: (field: string) => boolean): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const field = fieldOf[key];
    if (!field || !isRequired(field)) continue;
    const empty = value === null || value === undefined || (typeof value === 'string' && !value.trim())
      || (Array.isArray(value) && value.length === 0) || (key === 'hourlyRate' && !(Number(value) > 0));
    if (empty) out.push(field);
  }
  return out;
}

/** Scrolls to the field (or its section) and puts the keyboard focus on its first control. Returns false when not found. */
export function focusProfileItem(key: string, doc: Document = document): boolean {
  const field = doc.querySelector<HTMLElement>(`[data-profile-field~="${key}"]`);
  const section = doc.getElementById(sectionOf(key));
  const scope = field ?? section;
  if (!scope) return false;
  const control = scope.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [role="combobox"], [tabindex]:not([tabindex="-1"])');
  const target = control ?? (scope.getClientRects().length ? scope : section);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  (target ?? scope).scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  if (control) control.focus({ preventScroll: true });
  else if (section) { if (!section.hasAttribute('tabindex')) section.setAttribute('tabindex', '-1'); section.focus({ preventScroll: true }); }
  const mark = control ?? section;
  if (mark) {
    mark.setAttribute('data-required-highlight', 'true');
    window.setTimeout(() => mark.removeAttribute('data-required-highlight'), 2500);
  }
  return true;
}
