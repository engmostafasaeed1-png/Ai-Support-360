# Support agreements (long-term support commitments)

Status (Oct 25): LIVE and switched ON at the owner's request after publishing. `docs/sql/sla-policies.sql` is live
(migrations 0103-0104) and SLA policies are ON. `docs/sql/support-agreements.sql` is live byte-identical as migrations
0105-0107 (md5 c04f06c82781b0556b4aa622a8911b3e; the file header line "NOT APPLIED" is kept so the file stays identical).
The private storage bucket `agreement-documents` (20 MB) exists. `support-agreements.test.sql`: 36/36 checks passed on the
live database in one cancelled transaction (the bucket-creation fixture line was skipped because the bucket exists).
Admin review of first-time agreements and the "DRAFT - pending legal review" flag stay ON.

## 1. Inventory (what exists today and what is reused)

| Area | How it works today | Reused for agreements |
| --- | --- | --- |
| Rates (M30) | `ticket_rates` per ticket + consultant: proposed / approved / replaced, `source` (bid, counter, ...), approved rate drives timesheets and invoices | Every agreement ticket gets an approved `ticket_rates` row with new source `agreement` (constraint widened), so timesheets, invoices and payouts work unchanged |
| Bidding (M64) | `proposals`, counter-offers, Q&A, deadlines - all tied to one ticket | Same mechanics (apply, counter, accept, deadline, notices) rebuilt as agreement applications/offers/messages, because the bid tables need a ticket |
| Pricing v2 | approved timesheet x rate + portal fee (`payment_service_fee_percent`, 10 %) + payment fee (`payment_processing_fee_percent`, 5 %) + VAT (`payment_vat_percent`, 15 %) via `pricing_breakdown` | Unchanged for ticket work. Month-end hours-bank settlements are ordinary `payments` rows with the same three percentages |
| Invoices (M54) / payouts | payments rows, invoice documents, payouts after 15 business days | Settlements use the same payments/invoice path; payouts follow the existing rule |
| Team engagement + NDA | four gates, both-signed NDA | Agreement becomes active only when the NDA is signed by both (if required) and the start date is reached |
| Contact filter (M60) | `contact_details_in_text` | All agreement free text (request, applications, offers, messages, handover notes) |
| SLA policies | snapshots per ticket | Agreement stores the chosen policy + version; `sa_ticket_sla` hook makes agreement tickets use it |
| Ticket tracking | stage + timeline style | Lifecycle steps and history list use the same chip style |
| Favourites | client favourites list | "Invite favourites" when publishing |
| Matching | shared deterministic matcher | Availability commitments lower the availability fit (`reserved_share`, half week reserved = 25 % lower) |

## 2. What was built

- Database (`docs/sql/support-agreements.sql`): agreements, versions (content hash), applications, offers, immutable agreed-rate
  records, rate changes (never retroactive), acceptances (checkbox + typed name + time + version hash, append-only), members,
  replacements, messages, events, months (hours-bank settlements), linked tickets, e-mail queue. RLS on, no direct browser
  access; only SECURITY DEFINER functions with fixed search_path and role checks. Rate limits on create/apply/counter/messages.
  Daily job `support-agreements-daily` (02:17 UTC): activation, renewal reminders 60/30/7, auto-renew (both consented),
  expiry, notice-period endings, archive, rate changes coming into force, month settlement, no-activity alert.
- Shared rules `supabase/functions/_shared/supportAgreements.ts` (lifecycle, bounds, rollover/overage, fees, renewal,
  termination, inactivity), mirrored by the database; e-mail layout `_shared/agreementEmail.ts`, template `agreement-notice`,
  worker `agreement-run` (deployed; answers "not ready" until the SQL is applied).
- Screens: Client > Management > Support agreements (list, new request, detail); Consultant > Work > Support agreements
  (opportunities, my applications, my agreements); Admin > System > Support agreements (list, review, no-activity alerts,
  settings, fee examples, legal clause list, test e-mail). Ticket header and list tag "Agreement: name". New-request switch
  "Use my support agreement". Agreement summary PDF (shared BRD PDF writer, EN/AR). Menus hidden while the switch is off.

### Owner requirements of Oct 25 (built)

| Requirement | Where |
| --- | --- |
| Name + reference "SA-2026-000012" everywhere | `sa_guard_agreement` (reference on insert, never changes; name only in Draft), unique index per company; lists, ticket tag, notices (reference appended to every title), e-mail badge, summary/SLA/statement PDFs, invoice text, ticket rate note, assignment request text |
| Per client company, several agreements, own SLA snapshot | `sa_resolve_sla`: one of the company's ACTIVE policies, an active template or the platform default, always its active version; body + hash copied into the terms (part of the accepted hash) |
| Client crew | terms.team (planned before, kept when the lead is selected) -> `sa_members` with role (lead/functional/technical/basis/backup), hours/week, working hours/time zone, backup cover, required; `sa_invite_member` / `sa_update_member` / `sa_remove_member`; members accept place + SLA (`sa_member_respond`, append-only `sa_member_acceptances`) |
| Nobody works before confirmation | `sa_confirmation` checklist = terms accepted by client + lead, every required member accepted place + SLA, NDA both-signed per working member, admin review (pilot), start date; `sa_try_activate` uses it |
| SLA only after confirmation | `sa_ticket_sla` returns the agreement SLA only while Active/Renewal due; ticket chip "Agreement SLA" / "Platform SLA" (`sa_ticket_tags.sla_applied`); the lead's per-ticket SLA acceptance is recorded automatically when the ticket carries exactly the accepted version |
| Agreement documents | generated: summary PDF (version, both acceptances, fingerprint, crew), SLA snapshot PDF, rate records, crew + NDA references, monthly statements PDF, notices; uploads: SOW, scope annex, access plan, escalation matrix, other - PDF/DOCX/XLSX/PNG/JPG/WebP up to 20 MB, private bucket, versions, archive (never deleted), download log; NDA gate as for ticket documents; "no passwords" warning + confirmation + text filter |
| One settings form | Basics, Term, Rates, Commitment, SLA, Crew, Reporting (statement e-mails to company members only), Escalation contacts (company members only), Documents, Review & accept; progress checklist, validation per section, save draft any time |

## 3. Settings and defaults (admin)

| Setting | Default |
| --- | --- |
| Support agreements enabled | OFF |
| First-time agreements need admin review | ON (pilot) |
| "DRAFT - pending legal review" flag | ON |
| Commitment models offered | all three |
| Rate bounds | 10 - 1,000 per hour; per-area caps optional |
| Portal fee for agreement statements | empty = same as today (10 %) |
| Maximum multiplier (S1 / out of hours) | 2 |
| Renewal reminders | 60 / 30 / 7 days |
| No-activity alert | after 6 weeks |
| Minimum term | 1 month |
| Maximum notice | 90 days; handover 14 days |
| Prepayment / expire unused hours without charge | OFF / OFF |
| Applications per consultant per day | 10 |
| Crew size (lead included) / contacts per list | 6 / 5 |
| Document size / documents per agreement | 20 MB / 50 |

## 4. Fee options for long commitments (owner decision - NOT decided)

Example: 40 approved hours x 100 = 4,000 (consultant earns 4,000 in every option).

| Portal fee | Portal fee | Payment fee 5 % | VAT 15 % | Client pays |
| --- | --- | --- | --- | --- |
| 10 % (today) | 400 | 200 | 690 | 5,290 |
| 7 % | 280 | 200 | 672 | 5,152 |
| 5 % | 200 | 200 | 660 | 5,060 |

Today the agreement fee setting changes month-end agreement statements only; ticket timesheets keep the platform fee.
Applying a lower fee to agreement ticket timesheets too needs a small change in the payment pricing (prepared, commented out
in the SQL file) - only after the owner decides.

## 5. Owner decisions

Decided (Oct 25): termination by client, consultant (notice period) and admin - all with a reason; minimum term 1 month;
prepayment OFF; out-of-hours multipliers stored and shown, not applied automatically (work logs do not mark out-of-hours
work); agreement portal fee default = the existing 10 %.

Still open:
1. A lower portal fee for long commitments (options above) - not decided.
2. Liability wording and the clauses below (lawyer).
3. Expiring unused hours without charge (OFF).

Lawyer check list: term and renewal; termination and notice; rate changes (never retroactive); non-circumvention (work stays on
the platform); IP and confidentiality; liability; freelancer status (independent contractor, no employment); tax
responsibility; governing law. E-signature gap: acceptance is an in-portal electronic acceptance, not a qualified e-signature.

## 6. Test plan (after applying the SQL and switching on)

- Client: create request (areas, term, model, SLA policy), publish with deadline and invite a favourite; see applications;
  select one; counter the rate; accept terms (tick + name); download the summary PDF; after NDA + start date see Active;
  open a new request in a covered area with "Use my support agreement" on - ticket shows "Agreement: name", approved rate and
  the agreement SLA; propose a rate change with a past date (refused) and a future date; suspend and resume; end with reason.
- Lead consultant: see the opportunity, apply (rate outside bounds refused, SLA tick required), accept the client's counter,
  accept terms, see Usage, approve the rate change, write a handover note after termination.
- Crew member: get the invitation, open the Crew tab, accept place + SLA (box + typed name), sign the NDA from Team
  confirmation; see documents only after that; leave the crew with a reason.
- Client crew/documents: plan two members in the settings form, see the Team confirmation checklist after agreeing,
  upload a SOW (exe refused, "password:" refused), upload version 2, download and see the download log; an agreement ticket
  shows "Agreement SLA" only once Active.
- Applicant (not selected): sees only the request and own application, never other applicants or rates.
- Unrelated consultant: cannot open the agreement (forbidden) and does not see it in opportunities unless matched.
- Admin: approve a first-time agreement, see a no-activity alert, change settings (audited), send test e-mail.

## 7. Arabic strings

All screen texts are under `agreements.*` in `src/i18n/locales/ar.json` (630 keys, same set as English, checked by script);
e-mail and PDF texts are in `_shared/agreementEmail.ts` and `src/lib/agreements/pdf.ts`; database notices carry both languages.
