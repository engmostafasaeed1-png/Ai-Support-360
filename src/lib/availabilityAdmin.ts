import { csvCell } from './missingLocationCsv';

export interface MissingAvailabilityRow {
  consultant_id: string;
  display_name: string | null;
  email: string | null;
  verification_status: string | null;
  signed_up_at: string | null;
  days_since_signup: number | null;
  deadline: string | null;
  blocked: boolean;
  on_hold: boolean;
  last_reminded_at: string | null;
  reminders: number;
}

export interface AdminHoldRow {
  hold_id: string;
  consultant_id: string;
  display_name: string | null;
  starts_at: string;
  ends_at: string;
  state: 'current' | 'upcoming';
  reason: string | null;
  set_by_admin: boolean;
  admin_reason: string | null;
  client_notice_at: string | null;
}

export const ADMIN_REMINDER_BATCH = 50;

/** CSV for the admin "Missing weekly availability" list (no private profile data; formulas neutralised). */
export function missingAvailabilityCsv(rows: MissingAvailabilityRow[]): string {
  const head = ['Consultant ID', 'Name', 'E-mail', 'Verification status', 'Signed up', 'Days since sign-up', 'Grace deadline', 'Left out of new matching', 'On hold', 'Last reminder', 'Reminders'];
  const body = rows.map((r) => [r.consultant_id, r.display_name, r.email, r.verification_status, r.signed_up_at, r.days_since_signup, r.deadline,
    r.blocked ? 'yes' : 'no', r.on_hold ? 'yes' : 'no', r.last_reminded_at, r.reminders].map(csvCell).join(','));
  return '\uFEFF' + [head.map(csvCell).join(','), ...body].join('\r\n');
}

/** Rows that can be reminded now: not on hold and not reminded in the last 24 hours (the database applies the same rule). */
export function remindable(rows: MissingAvailabilityRow[], now = Date.now()): MissingAvailabilityRow[] {
  return rows.filter((r) => !r.on_hold && (!r.last_reminded_at || now - Date.parse(r.last_reminded_at) >= 24 * 3_600_000));
}
