# Partner Portal — design document (no code, no SQL, no deploy)

## Deliverable
One new file: `docs/partner-portal-design.md`. No earlier partner-teams doc exists in the repo, so this becomes the only partner design. No source, SQL, function or setting changes. Before writing, I re-read the existing designs it reuses (team-engagement.md, support-agreements.sql, sla-policies.sql, availability-hold.sql, nda-signature-identity.sql, referral-program.sql, user-management.sql) so table names and rules are cited accurately.

## Document outline
1. **Structure.** A Mermaid ER diagram plus a table covering Partner organisation > staff roles (Owner, Admin, Resource manager, Delivery manager, Finance, Viewer) > Resources (Invited/Accepted/Active/Suspended/Left) > Assignments > Availability > Work > Money. The table has a "Reused" column (consultants, tenants/tenant_members, ticket_team_members, support agreements + crew + documents, SLA snapshots, hold_* rules, working week, NDA, BRD, ticket tracking, payouts, invoices) and a "New" column (partner_orgs, partner_staff, partner_resources, partner_allowances, partner_rate_cards, partner_audit). Rule: a consultant is independent OR in exactly one partner, joins only with explicit consent, and can leave with a notice period. The consultant keeps their own profile, availability within the partner's allowance, and an earnings view according to partner rules.
2. **Screens.** Text wireframes for Dashboard, Resources + Resource 360, Assignments board, Availability planner (heatmap, bulk open/close, bench offers), Clients and agreements, Tickets and SLA, Timesheets, Finance, Team performance, Documents, Settings and Audit log. Also a navigation and role-visibility matrix.
3. **Availability logic.** A table of who may open or close availability (resource manager vs consultant, consultant hold always wins for personal leave). Covers conflict checks against agreement capacity, double-booking prevention, and effects on matching, critical alarms, responsiveness exclusions and SLA clocks (reusing hold/notice rules). Also client notices and audit. Includes a sequence diagram.
4. **Visibility and privacy.** A who-sees-what matrix (partner, client, consultant, admin), a multi-tenant RLS strategy (security-definer partner_role_for helper, default deny), partner-level contact-bypass rules, controller/processor roles, and ID data that never reaches the partner.
5. **Money.** Options for the contracting seller, invoice and payout to the partner vs to individuals, the portal fee on partner work, rate card vs per-consultant rate, how staff are paid outside the platform, disputes and refunds, B2B VAT. Worked examples with pricing v2 (e.g. 40 h x 50 = 2,000; +200 portal fee; +110 payment fee; +346.50 VAT = 2,656.50 client total) and payout within 15 business days. Lawyer and accountant questions are flagged.
6. **Onboarding and trust.** Partner verification queue (registration documents, SAP partner proof verified, never a claim alone), logo moderation, and resource invite flow (profile + AI interview + NDA + policy still per person). An abuse case table covering fake partner, poaching, double listing, bench dumping and rate dumping, with mitigations.
7. **Admin side.** Partner console, verification queue, fee per partner, overrides, reports, and kill switches (`partner_portal_enabled` default OFF, plus sub-flags).
8. **Phased plan.** Phase 1 (org + resources + availability planner + read-only 360, payouts still to individuals, low legal risk), Phase 2 (assignments board, partner dashboards), Phase 3 (partner invoicing/payouts, after lawyer and accountant sign-off). Each phase has dependencies, effort size, migration/backfill, tests, rollback, a pilot with 1–2 partners and success metrics.
9. **Open decisions.** 15 decisions with options, a recommendation and the consequence of each, plus an empty decision log table.

## The 15 owner decisions (recommendation in brackets)
1. Can a consultant belong to more than one partner? (No, one only)
2. Who must consent to joining or leaving? (Consultant always; 30-day notice)
3. Can the partner override the consultant's own availability? (Only open within allowance; consultant leave always wins)
4. Who is the seller on client invoices? (Phase 1 unchanged; later the partner, via the platform)
5. Payout to the partner company or to individuals? (Individuals in pilot; partner company after legal sign-off)
6. Portal fee on partner work? (Same 10 %, admin setting per partner)
7. Rate setting: partner rate card or per consultant? (Rate card with per-consultant override, within admin bounds)
8. Does the client see the partner's name and brand? (Yes, after verification)
9. Do client feedback and success stats belong to the person or the partner? (Person; partner sees an aggregate)
10. Can the partner see a resource's individual earnings? (Only for work done under the partner)
11. Required SAP partner proof? (Certificate/registry check by admin, renewed yearly)
12. Non-poaching rule between partners and with clients? (Yes, 12 months, in partner terms)
13. Can the partner replace a crew member without client approval? (No, client + admin approval, as today)
14. Partner access to NDAs/IDs? (Masked status only, never ID numbers)
15. Pilot size and duration? (2 partners, 90 days, feature OFF for everyone else)

## After approval
I write the document, then reply with a short plain-language summary and the 15 decisions. Nothing else changes.
