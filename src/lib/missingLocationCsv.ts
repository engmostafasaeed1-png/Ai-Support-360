export interface MissingLocationRow {
  consultant_id: string;
  display_name: string | null;
  email: string | null;
  verification_status: string | null;
  signed_up_at: string | null;
  country: string | null;
  city: string | null;
  deadline: string | null;
  blocked: boolean;
  last_reminded_at: string | null;
}

/** Quotes a CSV cell and neutralises spreadsheet formulas (cells starting with = + - @). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV for the admin "Who is missing location" list. No bank, contact-link or private profile data. */
export function missingLocationCsv(rows: MissingLocationRow[]): string {
  const head = ['Consultant ID', 'Name', 'E-mail', 'Verification status', 'Signed up', 'Country', 'City', 'Deadline', 'Blocked', 'Last reminder'];
  const body = rows.map(r => [r.consultant_id, r.display_name, r.email, r.verification_status, r.signed_up_at, r.country, r.city, r.deadline, r.blocked ? 'yes' : 'no', r.last_reminded_at].map(csvCell).join(','));
  return '\uFEFF' + [head.map(csvCell).join(','), ...body].join('\r\n');
}
