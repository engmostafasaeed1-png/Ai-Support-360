/** The lists of the company pages: the first-company form, the company selector and the company profile use the same values. */
export const COMPANY_INDUSTRIES = [
  'oil_gas', 'petrochemical', 'banking', 'telecom', 'healthcare',
  'retail', 'manufacturing', 'government', 'education', 'construction',
  'logistics', 'utilities', 'technology', 'other',
];

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

/** The list plus the stored value when it is not in the list (an older entry stays visible and can be changed). */
export function withCurrentOption(list: string[], current: string | null | undefined): string[] {
  return current && !list.includes(current) ? [...list, current] : list;
}
