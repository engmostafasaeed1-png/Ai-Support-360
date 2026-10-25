import type { PartnerResource } from '@/lib/partnerPortal';

/**
 * Partner portal DEMO data: fictional people, browser memory only. Imported ONLY by the partner page
 * (guarded by partnerDemo.test.ts) so it never reaches search, matching, directory, KB, AI, sitemaps or admin stats.
 */
const r = (n: number, name: string, availability: PartnerResource['availability'], cap: number | null, tickets: number, risk: number, approved: number, pending: number, agreementCap: number, hold?: [string, string]): PartnerResource => ({
  resource_id: `demo-r${n}`, consultant_id: `demo-c${n}`, status: 'active', name, availability, capacity_hours_week: cap,
  hold: hold ? { from: hold[0], to: hold[1] } : null, active_tickets: tickets, sla_at_risk: risk,
  approved_hours_month: approved, pending_hours_month: pending, agreement_capacity: agreementCap,
});

const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export const DEMO_RESOURCES: PartnerResource[] = [
  r(1, 'Layla H. (sample)', 'available', 30, 3, 0, 42, 6, 20),
  r(2, 'Omar K. (sample)', 'busy', 20, 5, 1, 61, 12, 24),
  r(3, 'Sara M. (sample)', 'available', 40, 2, 0, 28, 0, 16),
  r(4, 'Yusuf A. (sample)', 'offline', 0, 1, 0, 9, 3, 8, [soon(2), soon(12)]),
  r(5, 'Nadia R. (sample)', 'available', 25, 4, 2, 37, 8, 10),
  { ...r(6, 'Karim T. (sample)', null, null, 0, 0, 0, 0, 0), status: 'invited' },
];

const t = (id: string, title: string, breached = false) => ({ id, title, status: 'in_progress', sla_breached: breached });
const a = (id: string, name: string, ref: string, role: string, capacity: number) => ({ id, name, ref, status: 'active', role, capacity });

export const DEMO_DETAILS: Record<string, Record<string, any>> = {
  'demo-c1': { modules: 'FI/CO · S/4HANA 2023', verification: 'verified', profile_submitted: true, interview_done: true, nda_signed: 3, policy_accepted: true, rating: 4.8, reviews: 21, responsiveness: { level: 'excellent' }, success: { level: 'gold' }, hours_month: { approved: 42, logged: 48 },
    agreements: [a('demo-a1', 'Finance run support (sample)', 'SA-2026-DEMO01', 'lead', 20)], tickets: [t('demo-t1', 'Month-end closing error (sample)'), t('demo-t2', 'Asset depreciation run (sample)'), t('demo-t3', 'Bank statement import (sample)')] },
  'demo-c2': { modules: 'MM/SD · ECC 6.0 EhP8', verification: 'verified', profile_submitted: true, interview_done: true, nda_signed: 5, policy_accepted: true, rating: 4.6, reviews: 34, responsiveness: { level: 'good' }, success: { level: 'silver' }, hours_month: { approved: 61, logged: 73 },
    agreements: [a('demo-a2', 'Logistics hypercare (sample)', 'SA-2026-DEMO02', 'functional', 24)], tickets: [t('demo-t4', 'Pricing condition missing (sample)', true), t('demo-t5', 'Delivery block on orders (sample)')] },
  'demo-c3': { modules: 'Basis · S/4HANA 2022', verification: 'verified', profile_submitted: true, interview_done: true, nda_signed: 2, policy_accepted: true, rating: 4.9, reviews: 12, responsiveness: { level: 'excellent' }, success: { level: 'platinum' }, hours_month: { approved: 28, logged: 28 },
    agreements: [a('demo-a1', 'Finance run support (sample)', 'SA-2026-DEMO01', 'basis', 16)], tickets: [t('demo-t6', 'Transport import failing (sample)')] },
  'demo-c4': { modules: 'HCM · SuccessFactors', verification: 'verified', profile_submitted: true, interview_done: false, nda_signed: 1, policy_accepted: true, rating: 4.4, reviews: 7, responsiveness: { level: 'good' }, success: { level: 'bronze' }, hours_month: { approved: 9, logged: 12 },
    agreements: [a('demo-a3', 'Payroll support (sample)', 'SA-2026-DEMO03', 'backup', 8)], tickets: [t('demo-t7', 'Payroll schema question (sample)')] },
  'demo-c5': { modules: 'ABAP/BTP · S/4HANA Cloud', verification: 'under_review', profile_submitted: true, interview_done: true, nda_signed: 2, policy_accepted: true, rating: 4.7, reviews: 15, responsiveness: { level: 'good' }, success: { level: 'gold' }, hours_month: { approved: 37, logged: 45 },
    agreements: [a('demo-a2', 'Logistics hypercare (sample)', 'SA-2026-DEMO02', 'technical', 10)], tickets: [t('demo-t8', 'Custom report timeout (sample)', true), t('demo-t9', 'BTP integration error (sample)', true)] },
};

/** Demo invite: adds an invited sample row in memory only. */
export function demoInvite(rows: PartnerResource[], email: string): PartnerResource[] {
  const n = rows.length + 1;
  const name = `${email.split('@')[0].slice(0, 12) || 'New'} (sample)`;
  return [...rows, { ...DEMO_RESOURCES[5], resource_id: `demo-r${n}-${Date.now()}`, consultant_id: `demo-c${n}-${Date.now()}`, name }];
}

/** Demo availability change on the in-memory sample state; returns sample agreement conflicts like the real RPC. */
export function demoSetAvailability(rows: PartnerResource[], ids: string[], v: { status?: string | null; capacity?: number | null; holdFrom?: string | null; holdTo?: string | null }) {
  const next = rows.map((x) => !ids.includes(x.consultant_id) ? x : {
    ...x,
    availability: (v.status as PartnerResource['availability']) || x.availability,
    capacity_hours_week: v.capacity ?? x.capacity_hours_week,
    hold: v.holdFrom && v.holdTo ? { from: v.holdFrom, to: v.holdTo } : x.hold,
  });
  const conflicts = next.filter((x) => ids.includes(x.consultant_id) && x.agreement_capacity > 0 &&
    (v.status === 'offline' || v.status === 'busy' || (v.capacity != null && v.capacity < x.agreement_capacity) || !!v.holdFrom))
    .map((x) => ({ consultant_id: x.consultant_id, agreement: DEMO_DETAILS[x.consultant_id]?.agreements?.[0]?.name ?? 'Sample agreement', committed: x.agreement_capacity }));
  return { rows: next, conflicts };
}
