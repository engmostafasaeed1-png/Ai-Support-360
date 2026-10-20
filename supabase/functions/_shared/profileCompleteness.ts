/** How complete is a consultant profile for the AI matching? Every item says what to add and why it helps. */
export type ProfileForCompleteness = {
  sap_roles?: string[] | null;
  seniority_level?: string | null;
  total_sap_years?: number | null;
  sap_technologies?: string[] | null;
  industries?: string[] | null;
  customer_segments?: string[] | null;
  vertical_solutions?: string[] | null;
  localization_countries?: string[] | null;
  localization_solutions?: string[] | null;
  project_types?: string[] | null;
  deployment_experience?: string[] | null;
  project_scale?: string | null;
  work_modes?: string[] | null;
  working_week?: string | null;
  language_levels?: Record<string, unknown> | null;
  skills_count?: number | null;
  /** Bank details saved with the current payout disclaimer acknowledged. */
  payout_ready?: boolean | null;
  /** A completed AI interview (consultants.ai_interview_completed_at or an earned interview badge). Pending or not taken = false. */
  interview_done?: boolean | null;
};

export type CompletenessItem = { key: string; label: string; hint: string; done: boolean };

/** Default share of the completion percentage that belongs to the AI interview (admin-editable; the database keeps the same default). */
export const DEFAULT_INTERVIEW_WEIGHT = 15;
export const MAX_INTERVIEW_WEIGHT = 50;

/** A weight from settings, clamped to 0..50; anything unreadable falls back to the default. */
export function clampInterviewWeight(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_INTERVIEW_WEIGHT;
  return Math.max(0, Math.min(MAX_INTERVIEW_WEIGHT, Math.round(n)));
}

/** True when the consultant completed an AI interview, read from columns any profile view already has. */
export function interviewDoneFrom(row: { ai_interview_completed_at?: string | null; ai_interview_badge?: string | null } | null | undefined): boolean {
  return !!(row?.ai_interview_completed_at || row?.ai_interview_badge);
}

const filled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return false;
};

/**
 * Profile fields make up (100 - interview weight) % and a completed AI interview the remaining weight (default 85 / 15),
 * so 100 % is impossible without a completed interview. The interview is its own item so checklists can show "AI interview - not taken".
 */
export function profileCompleteness(
  p: ProfileForCompleteness,
  options?: { includePayout?: boolean; interviewWeight?: number },
): { percent: number; done: number; total: number; items: CompletenessItem[]; fieldsPercent: number; interviewDone: boolean; interviewWeight: number } {
  const includePayout = options?.includePayout !== false;
  const weight = options?.interviewWeight === undefined ? DEFAULT_INTERVIEW_WEIGHT : clampInterviewWeight(options.interviewWeight);
  const fields: CompletenessItem[] = [
    { key: 'skills', label: 'SAP modules', hint: 'Add your SAP modules and skill levels: this is the strongest matching signal.', done: (p.skills_count ?? 0) > 0 },
    { key: 'roles', label: 'Roles', hint: 'Choose your roles so functional, technical and basis requests reach the right people.', done: filled(p.sap_roles) },
    { key: 'seniority', label: 'Seniority and years', hint: 'Add your seniority level and total SAP years for complex and urgent requests.', done: filled(p.seniority_level) && filled(p.total_sap_years) },
    { key: 'technologies', label: 'Technologies', hint: 'Add your technologies (S/4HANA, Fiori, BTP...).', done: filled(p.sap_technologies) },
    { key: 'industries', label: 'Industries', hint: 'Add the industries you worked in so clients in the same industry find you.', done: filled(p.industries) },
    { key: 'segments', label: 'Customer segments', hint: 'Add the customer segments you served (government, semi-government, sovereign-fund-owned, enterprise, SME...).', done: filled(p.customer_segments) },
    { key: 'verticals', label: 'Vertical solutions', hint: 'Add the industry solutions you implemented (IS-U, SAP Oil & Gas, FS-CD, PSM...).', done: filled(p.vertical_solutions) },
    { key: 'countries', label: 'Localization countries', hint: 'Add the countries whose local requirements you configured.', done: filled(p.localization_countries) },
    { key: 'localization', label: 'Localization solutions', hint: 'Add the local solutions you delivered (e-invoicing, payroll, tax, bank formats).', done: filled(p.localization_solutions) },
    { key: 'projects', label: 'Project types', hint: 'Add the kinds of projects you delivered (implementation, support, migration...).', done: filled(p.project_types) },
    { key: 'deployment', label: 'Deployment experience', hint: 'Add on-premise, private cloud, public cloud or BTP experience.', done: filled(p.deployment_experience) },
    { key: 'scale', label: 'Project scale', hint: 'Add the largest project size you worked on.', done: filled(p.project_scale) },
    { key: 'work', label: 'Work mode and working week', hint: 'Add remote or on-site, and your working week, so urgent requests reach you at the right time.', done: filled(p.work_modes) && filled(p.working_week) },
    { key: 'languages', label: 'Language levels', hint: 'Add your level in each language you speak.', done: filled(p.language_levels) },
    // Client-facing views pass includePayout: false so payout status is never exposed.
    ...(includePayout ? [{ key: 'payout', label: 'Bank details for payouts', hint: 'Add your bank details to receive payouts', done: p.payout_ready === true }] : []),
  ];
  const interviewDone = p.interview_done === true;
  const interviewItem: CompletenessItem = {
    key: 'interview',
    label: interviewDone ? 'AI interview' : 'AI interview - not taken',
    hint: 'Take the AI interview (about 10-15 minutes) to earn your badge. It counts for part of your profile completion.',
    done: interviewDone,
  };
  const fieldsDone = fields.filter((i) => i.done).length;
  const fieldsPercent = Math.round((100 * fieldsDone) / fields.length);
  const percent = Math.round(((100 - weight) * fieldsDone) / fields.length + (interviewDone ? weight : 0));
  const items = [...fields, interviewItem];
  return { percent, done: fieldsDone + (interviewDone ? 1 : 0), total: items.length, items, fieldsPercent, interviewDone, interviewWeight: weight };
}
