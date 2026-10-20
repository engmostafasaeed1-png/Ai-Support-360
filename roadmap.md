# Roadmap

- [x] Connect the profile dialog to the existing AI assessment; resume pending sessions, surface failures, confirm server-awarded badge readback and refresh profile/history. Signed-in start/greeting verified; 27 targeted tests passed.
- [ ] Verify a completed real assessment and first-completion credits through the UI: awaits consultant's own interview answers; do not invent answers or alter their credibility for QA.

- [x] Refresh Feature D manual-save dialog with honest benefits, real progress/badges, accessible mobile/RTL/dark presentation; 15 regression tests passed and signed-in save/reload, 375 px and focus trapping verified.

- [x] Feature D: section Save/status controls, dirty-only four-second autosave controller, completion/interview guidance, notification-trigger audit and safety tests; signed-in save/reload verified.
- [ ] Activate and verify Feature D automatic saving: awaits user-applied docs/sql/profile-autosave.sql; manual section saving works, database unchanged.

- [x] Feature C: prepare unapplied Founding Consultant SQL, shared badges, admin settings/overrides and rule tests; full unit suite passed and real admin pending-activation state verified.
- [ ] Activate/test Founding Consultant SQL awards and audited overrides: awaits user-applied docs/sql/founding-consultants.sql; no live data changed.

- [x] Add payout readiness banners and administrator badges; payout details already belongs to the seven-item checklist. Full unit suite: 1,512 passed; automatic TypeScript/build clean.
- [ ] Daily assignment/accepted-bid payout reminder: blocked by service-only safe_insert_notification and absent server-side daily dedupe; requires database changes not authorized by this frontend-only request.

- [x] Fix consultant landing head tags and identical pricing duplication; 1,477 tests passed, automatic TypeScript/build check clean, preview tags and navigation cleanup verified.

- [x] Apply exact M69 SQL and add administrator full-profile sheet and entry points; timed masking, empty/full records, error/deep-link tests passed. Verified real profile at desktop/mobile and audit row; TypeScript clean, 1,458 tests passed.

- [x] Add credential-free notification event callbacks, atomic administrator email claims, switches/count and bounded retries; historical rows backfilled, live test email accepted, switch save/readback verified, TypeScript and 1,449 tests passed. No queue/schedule added; interrupted callbacks need a later invocation, while managed delivery retries accepted mail.

- [x] Email consultants on payout approval with actual amount, currency and expected date; tested and deployed. Real approval/email delivery not exercised to avoid changing live financial records.

- [x] Compact invoice details with fixed payment actions, test footer states, and verify three screen sizes.

- [x] Redesign timesheet PDF/CSV tables; test data helpers and inspect 25-entry and single-entry PDFs.

- [x] Redesign the client-facing consultant profile header with shared credibility/avatar and rating displays; verify the header and Reviews action.

- [x] Align all legal policies with current hourly pricing and verify all seven policy pages.

- [x] Replace existing logo placements and browser icons with the uploaded AI Support 360 artwork; verify rendering.

- [x] Combine consultant onboarding and profile under one Profile destination and verify navigation.
- [x] Consolidate duplicate profile editors without losing unique fields.
- [x] Match tickets against complete saved expertise and show ranked weighted scores; verify signed-in flow.

- [x] Replace the old brand name قرطبة with AI Support 360 in the two Arabic sign-in and sign-up lines.

- [ ] Paymob secrets: user adds PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET, PAYMOB_CARD_INTEGRATION_ID in Cloud > Secrets, then switches on card payments in Admin > Payments > Settings

- [x] Reports/dashboards 4 faults: client ReportsPage replaced (period/company/module filter/CSV/PDF), consultant dashboard upcoming sessions, consultant reports billable hours from signed timesheets, client activity feed filters admin/consultant notices (Oct 11)

- [x] Implement M64-B3 client bidding screens and run requested checks.
- [x] Show and verify registration guides, welcome checklist and remembered completion in the embedded consultant profile only.
- [x] Move hero platform badge below subtitle and add top clearance for fixed navbar.
- [x] Consultant sidebar link to the public /for-consultants landing page, opened in a new tab (Oct 17)
- [x] Feature H: matching audit, deterministic explainable ranking on all match surfaces, full directory filters in the URL and clustered map (Oct 20)
- [ ] Feature H SQL: owner applies docs/sql/matching.sql (match run log, budget/work mode/deployment request fields, suspended-account filter)
- [x] Feature H part 4: step-based progress for ticket submit and every expert-matching place (wizard, ticket page, bid invitations, admin match, solution suggestions), duplicate-safe submit, tests (Oct 20)
- [ ] Feature H addition (read every consultant profile field): profile-text matcher written but not tested or switched on; SQL file not written. Waiting for the owner to say continue.
- [x] Feature I step 1: read-only inventory + design, approved by the owner (Oct 20)
- [x] Feature I phase 1: team engagement SQL file docs/sql/team-engagement.sql written and syntax-checked (Oct 20)
- [x] Feature I phase 1 addition: admin multi-assign through the same gates with audit, consultant team requests (limits, approve/decline/choose), team thread; SQL + post-apply checks (docs/sql/team-engagement.test.sql) + rule tests + Arabic strings (docs/team-engagement.md) (Oct 20)
- [ ] Feature I SQL: owner applies docs/sql/team-engagement.sql, then runs docs/sql/team-engagement.test.sql
- [ ] Feature I phase 2 (after the SQL is applied): engage dialog, Team panel with per-member stepper (client and admin), engagement confirmation card, consultant invitation answers, team request button + request cards, team chat, client e-mail for team requests, admin settings, email/push/Telegram for critical, tests, Arabic strings

- [x] Fix J: AI interview start resumes/reuses open sessions with visible reasons, preflight and text-only; completion includes a weighted AI interview (default 15 %).
- [ ] Fix J database update `docs/sql/interview-completion.sql` (then `profile-reminders.sql`): awaits owner applying it; until then the app uses the default 15 % share and the admin share control reports it is not yet available.
- [x] Fix K: consultant location mandatory (country + city), shown everywhere, sign-up picker, prompt/banner/checklist, admin 'Who is missing location'.
- [ ] Fix K database update `docs/sql/consultant-location.sql` (after interview-completion.sql): awaits owner; until then no grace deadline, no blocking, admin page read-only.

- [x] Feature L: popup, e-mails, reminders 2 h/4 h/24 h and Critical 10/20/30 min, client countdown + No response card (Invite another / Open for bids / Wait longer once), admin timings card + stats, response rate in ranking, policy text in popup/e-mails/notifications/Settings/tour/guide/Terms; reminder function deployed, 1,724 tests pass (Oct 20)
- [ ] Feature L SQL: owner applies docs/sql/assignment-response.sql (status, log, claim, cron every 5 minutes); syntax-checked, not executed. Until then no reminders, No response notices or stats.
