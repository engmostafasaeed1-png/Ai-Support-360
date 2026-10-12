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
};

export type CompletenessItem = { key: string; label: string; hint: string; done: boolean };

const filled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return false;
};

export function profileCompleteness(p: ProfileForCompleteness): { percent: number; done: number; total: number; items: CompletenessItem[] } {
  const items: CompletenessItem[] = [
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
  ];
  const done = items.filter((i) => i.done).length;
  return { percent: Math.round((100 * done) / items.length), done, total: items.length, items };
}
