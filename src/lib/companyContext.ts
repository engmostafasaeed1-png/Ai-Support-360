// The customer segment and country of a client company as saved in client_profiles ('' = not specified = null).
export function companyContextFields(customerSegment: string, country: string): { customer_segment: string | null; country: string | null } {
  return { customer_segment: customerSegment.trim() || null, country: country.trim() || null };
}
