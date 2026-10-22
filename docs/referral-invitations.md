# Refer & earn notices and invitation

Prepared SQL: `docs/sql/referral-invitations.sql` (**not applied**). Checks: `docs/sql/referral-invitations.test.sql`
(RI01–RI14, one rolled-back transaction; passed on a scratch database with Feature R loaded).

## What it adds
- In-app referral notices (bell + Notifications): one card per event with icon and colour (violet-teal invitation,
  green earned / available / paid, amber held / pending, red reversed / rejected / expired), amount pill, one action
  that opens the right tab (earnings tab pre-filtered by status). Works for existing notices too.
- Referral e-mails: one shared layout (`supabase/functions/_shared/referralEmail.ts`), EN/AR with RTL, HTML + plain text,
  600 px tables, inline styles, system fonts, white body, bulletproof button, hosted logo and banner
  (`public/email/referral-banner.png`, used once the site is published), example numbers from settings.
- Admin › Referrals › "E-mails & invitation": preview of every referral e-mail (EN/AR, light / simulated dark, phone width,
  plain text) and "Send test to me" (own address only, `[TEST]`, 6 per hour); invitation switch, limits, version,
  example fee/currency, draft-terms line, history with CSV.
- Admin › Users: "Send Refer & earn invitation" for the selection and "Refer & earn: all eligible consultants", with the
  confirmation dialog, progress and result report (CSV). Rows show "Invited on <date> (v1)". No opened/clicked tracking.
- New event notices once the SQL is applied: reward recorded (after the first), held, available, paid, reversed, referral
  not accepted - one per line and event, never blocking the money write.

## Not e-mailed
The invitation goes out as an in-app notice (and Telegram for linked users) through the existing bulk-message worker.
Sending it by e-mail to many consultants would be promotional bulk mail, which the app e-mail service must not carry.

## How to test (after the owner applies the SQL)
1. Run `docs/sql/referral-invitations.test.sql` (rolls back).
2. Admin › Referrals › E-mails & invitation: pick each e-mail, check EN/AR, press "Send test to me".
3. Admin › Users › "Refer & earn: all eligible consultants" › "Send to me only": check your own bell.
4. Owner approves; a super admin switches invitations on; select ONE consultant in Users, open the dialog, tick
   "I confirm", send, watch the progress panel and download the CSV.
