# Roadmap

- [ ] Fix consultant landing head tags and identical pricing issue; test lifecycle and verify loaded preview tags.

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
