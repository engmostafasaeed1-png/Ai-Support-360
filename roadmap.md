# Roadmap

- [x] Refer & earn notices + invitation (Oct 22): (A) in-app referral cards per type, shared bilingual referral e-mail layout + per-type blocks (HTML + text), admin e-mail preview (EN/AR, light/dark) + "Send test to me"; (B) Users console "Send Refer & earn invitation" (selected / all eligible) with confirmation, server-side eligibility, dedupe per version, resend rules, caps, kill switch OFF, per-recipient report + CSV, "Invited on" in rows; docs/sql/referral-invitations.sql + test file passed on a scratch database (NOT applied, nothing sent); functions deployed
- [ ] Switch on Refer & earn invitation: awaits owner applying docs/sql/referral-invitations.sql (then its test file), turning on the invitation switch, and approving the first real send.

- [x] AI Interviewer Training (knowledge-based, profile-specific questions + admin knowledge documents): inventory, plan builder, optional version per module, document upload/extraction function, coverage, preview, question sources, consultant notice line, EN/AR, tests; docs/sql/interview-knowledge.sql + test file checked on a scratch database; functions deployed (Oct 22)
- [ ] Switch on AI Interviewer knowledge base: awaits owner applying docs/sql/interview-knowledge.sql (then run docs/sql/interview-knowledge.test.sql) and switching it on in Settings.

- [x] H1 consultant registration: scanner-safe /auth/confirm page + 6-digit code, expired-link panel on /login and confirm page (neutral resend, 60 s cooldown), clearer sign-up inbox screen, admin resend + super-admin "mark e-mail as confirmed" (audited, reason), unconfirmed consultants get a confirmation e-mail instead of profile reminders; tests (Oct 21)
- [ ] H1 follow-up: owner sets Auth settings → Email → One-time codes expiration to 24 h (the app cannot read or change it).

- [x] Feature T: modern scrolling + polish (scrollbars, smooth anchors, reading progress, back to top, restoration, overscroll/gutter, sticky/scroll tables, snap rows, chat jump chip, reveal; tokens/shadows/toasts/404/skeleton fallback; Lighthouse before/after; tests) — done Oct 21; not done: sticky mobile action bars, list-wide skeleton swap, sticky headers beyond Users

- [x] Feature Q: pause notifications (3 days / 1 week / 1 month) from settings, bell and signed e-mail links; one server-side pause check; essential notices never paused; consultant availability choice; admin switch/max length/count/audit; docs/sql/notification-pauses.sql + test file checked twice on a scratch database; 1,879 unit tests; functions deployed, signing secret generated (Oct 21)
- [ ] Switch on Feature Q: awaits owner applying docs/sql/notification-pauses.sql (then run docs/sql/notification-pauses.test.sql).
- [x] Feature R: admin bulk messages (Users › Message users + Admin › Messages / Campaigns): audience from selection/filter/saved/client group/pasted e-mails with preview and per-person exclusion, EN/AR editor with variables, brand images, templates, live preview, test, schedule with time zone, typed confirmation above 50, footer; channels in-app + pop-up and Telegram (throttled worker every minute), manual WhatsApp/SMS click-to-send with audited numbers; e-mail not offered (app e-mails are one-recipient only); paid provider off; kill switch, daily cap, messages.send permission, immutable records; recipients see 'Messages from AI Support 360'. docs/sql/bulk-messaging.sql + test file checked twice on a scratch database (also with Feature P groups and Feature Q pauses); 1,907 unit tests; worker deployed (Oct 21). Also removed our own unsubscribe link from Feature Q e-mail footers (the e-mail platform adds its own).
- [ ] Switch on Feature R: awaits owner applying docs/sql/bulk-messaging.sql (then run docs/sql/bulk-messaging.test.sql); paid WhatsApp/SMS awaits the owner choosing a provider.
- [x] Feature P inventory (read-only) of the Users page, roles, permissions and audit.
- [x] Feature P phases A–G: new Users console (server-side search/filters/sort/paging, URL-shared views, saved views, column chooser, stats, audited CSV), user details (identity, roles, organisations, linked records, activity, sessions, sign-ins, flags, notes, tags, messages, personal-data export), safe audited actions (roles with self/last-super-admin rules, suspend with reason/end date, sign-out everywhere, password reset, resend verification, two-step reset, 30-day delete/restore/anonymise, merge/unmerge), bulk invite/tag/remind/suspend with dry run and undo, permission matrix, admin groups, view-as preview, access review with revoke, optional 4-eyes, security alerts, admin history; Arabic, RTL, phone layout, keyboard shortcuts; suspended/deleted consultants hidden from directory and matching. docs/sql/user-management.sql + test file prepared and checked on a scratch database; 1,856 unit tests; server functions deployed (basic mode until SQL applied).
- [ ] Switch on Feature P fully: awaits owner applying docs/sql/user-management.sql (then run docs/sql/user-management.test.sql).
- [x] Feature O: client favourites, groups, tags, private notes, "do not suggest", My consultants page, hearts on cards/profile/bids/map/recommendations, "From my groups" in requests, bids and the new request wizard, favourite boost/chip and block exclusion in matching, admin count; prepared SQL tested on a scratch database; 1,829 unit tests.
- [x] Switch on Feature O: applied docs/sql/client-favourites.sql (migration 0074, byte-identical); signed-in save, group, private note and do-not-suggest verified in the preview, matching preferences checked, test entries removed.

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
- [x] Feature L SQL applied (Oct 20): reminders every 5 minutes live.
- [x] Feature M: responsiveness statistics (availability-fair metrics, warnings 1/2, chip on cards, blended rating, ranking weight, disputes, admin page, `responsiveness_public` off by default); function deployed, 1,755 tests pass (Oct 20)
- [x] Feature M SQL applied (Oct 20); client display switched on. Team panel chip waits for Feature I phase 2.
- [x] Feature N: versioned Consultant Service Policy (draft EN/AR), public printable /consultant-policy, final profile step, pop-up/banner/e-mails, grace restrictions, admin page, SQL + checks, tests, Arabic strings (Oct 20)
- [ ] Feature N SQL: owner has the draft text reviewed, applies docs/sql/consultant-policy.sql, optionally runs docs/sql/consultant-policy.test.sql
- [x] Feature L addition: decision preview (viewed_at, locked data), Request more information (pause/resume, limits, counts as response), decline reasons; popup, e-mails, notifications, Requests page, client card, admin, policy text, tests, Arabic (Oct 21)
- [x] Feature L addition SQL applied (Oct 21): preview, Request more information and decline reasons live; rolled-back live trial passed

- [x] Feature Z: consultant referral programme (codes/attribution, 0.5 % rewards for 12 months, referral payouts, Refer & earn page, admin Referrals page, e-mails via referral-run (deployed), SQL file + scratch test, Arabic strings in docs/referral-program.md) — Oct 21
- [x] Feature Z activation rule: pair active only after both pass the AI interview (referral_min_interview_score 50) and both acknowledge versioned terms; pending/active/expired (referral_activation_days 90), reminders at 14/45 days, notifications both sides, admin filters/resend, tests
- [x] Switch on Feature Z: docs/sql/referral-program.sql applied on owner request (Oct 22, migrations 0079-0085, byte-checked against a tested copy)
- [x] Feature Z addition: "Referral calculations" tab (summary strip, per-referral table + totals, invoice-line drill-down with formula, monthly chart + honest forecast, filters, CSV/PDF, monthly statements + notice, illustration calculator, live RPCs + last updated, admin read-only view with consultant picker + reconciliation check, tests, Arabic strings)
- [ ] Home page (/) redesign: ON HOLD by owner — full brief received again 01:05 UTC (new AI Support 360 design, honesty guardrails); waiting for an explicit "hold lifted" before any home page change
- [x] Feature Z addition: "Refer & earn" step in consultant onboarding guide + first-sign-in tour, dashboard card, welcome e-mail line, tests, Arabic strings
- [x] Feature Z addition: existing consultants — backfill codes (dry-run count), one-time intro pop-up, bell entry, admin set-referrer, claim window referral_claim_until (launch + 14 d), admin "Send announcement" (in-app; e-mail refused as bulk marketing), tests, Arabic strings
- [x] Feature Z change: tiered rates (referral_tiers 0.5/0.6/0.7/0.8/1.0 by verified referrals 0-10/11+/21+/31+/41+), applied rate + tier stored per line, all displays, tier card/ladder, admin editor + distribution + audit, tests, Arabic
- [x] Feature Z security & fraud hardening (A1-A8): flags/under_review, hold days, related-party, min invoice, caps, velocity, tier paid rule, code brute-force lock-out, tamper-proofing, four-eyes adjustments, anomaly dashboard, daily reconciliation alert, privacy (Engagement refs, hash retention), terms short version; docs/sql/referral.test.sql adversarial tests, unit tests, RPC review, docs/referral-security.md threat table (SQL unapplied)
- [x] Feature Z "Programme rules" hub on Refer & earn (sticky scroll-spy nav, 7 sections, live checklist, tier ladder, payment timeline, rules, simulator + pure tested math, PDF, admin plain-text section notes, EN/AR, tests)
- [x] Refer & earn page upgrade: header/sidebar pill + dot, policy cards + terms status, journey counts + next action, per-referral funnel chips, reward-line breakdown table (filters/sort/search/pages/CSV), earnings summary + chart, payouts + history, docs/sql/referral-tracking.sql (unapplied) + tests, Arabic
- [x] Switch on Refer & earn tracking: docs/sql/referral-tracking.sql applied with Feature Z (Oct 22); checks passed on a copy of the database structure
