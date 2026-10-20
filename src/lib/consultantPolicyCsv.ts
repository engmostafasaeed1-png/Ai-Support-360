import { csvCell } from '@/lib/missingLocationCsv';

export interface PolicyOverviewRow {
  consultant_id: string;
  display_name: string | null;
  email: string | null;
  verification_status: string | null;
  signed_up_at: string | null;
  state: string | null;
  current_version: number | null;
  accepted_version: number | null;
  accepted_at: string | null;
  accepted_language: string | null;
  first_shown_at: string | null;
  deadline: string | null;
  last_reminder_at: string | null;
  reminders: number | null;
}

/** CSV for Admin > Consultant policy. No IP hashes, user agents or other private data. */
export function policyOverviewCsv(rows: PolicyOverviewRow[]): string {
  const head = ['Consultant ID', 'Name', 'E-mail', 'Verification status', 'Signed up', 'Policy status', 'Current version', 'Accepted version', 'Accepted at', 'Language shown', 'First shown', 'Deadline', 'Last reminder', 'Reminders (current version)'];
  const body = rows.map(r => [r.consultant_id, r.display_name, r.email, r.verification_status, r.signed_up_at, r.state, r.current_version, r.accepted_version, r.accepted_at, r.accepted_language, r.first_shown_at, r.deadline, r.last_reminder_at, r.reminders ?? 0].map(csvCell).join(','));
  return '\uFEFF' + [head.map(csvCell).join(','), ...body].join('\r\n');
}

export type PolicyFilter = 'all' | 'accepted' | 'grace' | 'pending' | 'blocked';

export function filterPolicyRows(rows: PolicyOverviewRow[], filter: PolicyFilter, search: string): PolicyOverviewRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter(r => (filter === 'all' || r.state === filter)
    && (!q || (r.display_name ?? '').toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q)));
}
