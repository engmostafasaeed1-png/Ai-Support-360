# Feature H — Matching audit, fix and directory (2026-10-20)

## Part 1 — Audit: which ticket fields the matchers used (before this change)

| Ticket field | AI match (`ai-ticket` match_consultants) | Bid "AI Recommended" (RequestBidDialog) | Admin SendMatchDialog | Critical alerts (`critical_alert_targets`) |
|---|---|---|---|---|
| Title / description | AI prompt only (soft, model decides) | ignored | title only (no `ticket_id`) | ignored |
| SAP areas (sap_modules) | AI prompt only; **no hard filter** | exact equality with main module | main module text only | module token overlap; **falls back to all consultants** |
| Sub-module / T-codes / error codes / SAP Notes | not extracted; notes ignored | ignored | ignored | ignored |
| Urgency (critical) | prompt only; **offline consultants still ranked** | ignored | ignored | n/a |
| Language | AI soft score | ignored | ignored | ignored |
| Industry / segment / country / vertical / localization / project type | deterministic context fit (15 %) | ignored | **lost** (no ticket id) | ignored |
| Budget / rate, work mode, deployment, timezone | **no field exists** on the ticket | — | — | — |
| Attachments, session mode, request type | ignored | ignored | ignored | ignored |

Other facts: only `verification_status = verified` was enforced; 8 of 9 sub-scores came from the model; bid recommendations used the
top 50 by rating only; client ticket dialog loaded 50 consultants and highlighted AI picks only if they were in those 50.

## Golden run (synthetic fixtures, `src/test/fixtures/matchFixtures.ts`, no production data)

`MATCH_AUDIT=1 bunx vitest run src/lib/matchAudit.test.ts` prints the table. "Old" = the deterministic part of the old ranking
(context fit only; the model part cannot be replayed offline). "New" = `supabase/functions/_shared/ticketMatch.ts`.

| Ticket | Old top (context only) | New top 1 (why) |
|---|---|---|
| FI month-end close, S/4HANA, Saudi | c01 15, c06 7 (Basis), c14 7 (inactive), c15 7 (no English) | c01 91 — SAP FI, FB50, Saudi Arabia, 12+ yrs |
| MM purchasing ECC, Egypt | c02 15 (FI), c03 15, c09 15 (HCM) | c03 89 — SAP MM, ME21N, MM-PUR, Egypt |
| ABAP Fiori extension | all 0 (tie) | c05 73 — ABAP, SAP Fiori, 10+ yrs |
| Basis HANA upgrade, critical | c01 15 (FI), c06 15, c14 15 (inactive) | c06 91 — SAP Basis, ST22, BASIS-UPG; offline c07 excluded |
| SuccessFactors EC, UAE, Arabic | c04 15 (SD), c08 15 | c08 88 — SuccessFactors, SF-EC, UAE |
| BTP / CPI | all 0 | c10 75 — SAP Integration, SAP BTP |
| VMware / infrastructure | all 0 | c11 77 — Infrastructure, VMware |
| Vague one-liner | all 0 | asks: module, error, country |
| Arabic FI ticket (no areas) | all 0 | c01 93 — SAP FI, F5 702, Saudi Arabia |
| SD pricing UAE | c04 15, c08 15 (SF) | c04 86 — SAP SD, VK11, SD-PR |
| HCM payroll Egypt | c02 15 (FI), c03 15 (MM), c09 15 | c09 83 — SAP HCM, HCM-PY, Egypt |
| Ariba buying | all 0 | c16 73 — SAP Ariba |
| FI with 60/h budget | c02 15, c03 15 (MM), c09 15 | c01 84, c02 78 (within budget; gap shrinks vs no budget) |

## Root causes

1. No hard filters except "verified": wrong-module, inactive, offline-for-critical and wrong-language consultants could rank.
2. Description text was never parsed deterministically (no module/T-code/error/note/product extraction; Arabic ignored).
3. 85 % of the score came from the model, so rankings were not reproducible and did not move predictably when a field changed.
4. Context fit was the only deterministic part and ties everyone when the client gives no context.
5. Bid recommendations and the admin dialog used different, weaker logic (exact module equality; title only, context lost).
6. Candidate lists were truncated (top 50 by rating) before matching.
7. No budget / work mode / deployment fields; timezone, response time, completion and founding were not used.

## Part 2 — What changed

- One deterministic matcher (`_shared/ticketMatch.ts`) for the ticket page, invitations, private bids and admin; the model only writes the
  explanation text when the existing `ai_consultant_match` flag is on, and never changes the order or the score.
- Hard filters: verified, active (suspended accounts via SQL), module/area overlap, language, critical → available now, excluded if declined, hidden or the client.
- Weighted criteria with admin-tunable weights (Admin › Settings › Matching weights), up to 4 why-chips and a match % on every surface.
- Vague requests get 2–3 clarifying questions before results; answers re-run matching; ticket edits re-run it on the ticket page.
- Every run is logged (ids, scores, hashes, weights version; no ticket text) once `docs/sql/matching.sql` is applied.

## Owner action

Apply `docs/sql/matching.sql` (run log table, extra request fields for budget / work mode / deployment, suspended-account check).
Until then matching works; the log and suspended-account filter are skipped silently.

## New English strings for Arabic (`directory.*` keys; match chips, questions and the weights card already include Arabic)

Any · SAP area · SAP module · Sub-module · Role · Skill · Certification · e.g. S/4HANA Finance · Years of experience · {{n}}+ years ·
Industry · Customer segment · Country / localization · Vertical solution · Deployment experience · Work mode · Language · English ·
Arabic · French · German · Hindi · Urdu · Hourly rate · Availability · Available now · Available this week · At a specific time · Day ·
Time (your time) · Time zone · Close to my time zone (±2 h) · AI interview badge · Gold · Silver or higher · Bronze or higher ·
Any badge (Verified or higher) · Minimum rating · Profile completion · At least {{n}} % · Response time · Within {{n}} min ·
Within {{n}} h · Verified only · Founding Consultants · Credly profile only · Save these filters as · e.g. FI Saudi · Save filters ·
Saved · Delete saved filters {{name}} · Clear all · Status · All · Online · Busy · Offline · Keyword search · Sort by · Most experience ·
Credly profile first · View · List · Map · Map area · Clear map area · {{n}} filters active · {{n}} consultants found ·
Pins show the area of a city, never an address. · Search this area · Consultants on the map · No location set · Invite · badge ·
consultants here, press to zoom in · Find best matches · Re-run matching · Recommended · Match Suggestions
