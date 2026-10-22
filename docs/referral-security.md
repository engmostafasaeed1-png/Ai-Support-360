# Feature Z referral programme: security and fraud controls

Money is involved, so every rule is enforced in the database (`docs/sql/referral-program.sql`, prepared, **not applied**).
The browser can only call the listed RPCs; it never writes a referral table and never receives ids, hashes, client data or
the referred consultant's hourly rate. Adversarial checks: `docs/sql/referral.test.sql` (T01–T26). Behaviour checks:
`docs/sql/referral-program.test.sql`. Client mirrors: `src/lib/referrals.test.ts` ("referral security mirrors").

Run (scratch database only): apply the stub, then `referral-program.sql`, then both test files. Part 1 of
`referral.test.sql` is rolled back; part 2 (parallel double credit) needs `dblink`, commits its own fixtures and deletes them.

## Threat table

| # | Threat | Control | Test name |
|---|---|---|---|
| A1.1 | Self-referral with the same account or e-mail variants (Gmail dots / +tag / googlemail / case) | `referral_attribute` refuses `self` (same user, normalised e-mail via `referral_norm_email`); CHECK referred <> referrer | T02 self_referral_email_variants |
| A1.2 | Referral loops (A-B-A, A-B-C-A) | Recursive `referral_is_loop` (25 levels) refuses; admin "change referrer" uses the same check | T03 referral_loops |
| A1.3 | Same bank account (rings paying into one account) | `referral_same_bank` compares normalised IBAN / account number inside the payout table at attribution and again at every payout release; never copied into referral tables; anomaly view clusters them by salted hash | T05 same_bank_hash |
| A1.4 | Same phone, company domain, device, network (at sign-up and first sign-ins) | `referral_attribution_flags` + `referral_note_device` (30 days after attribution, both directions) add signals; device id and IP stored only as salted hashes | T04 two_signals_under_review |
| A1.5 | Weak single signals vs. real rings | Weighted score (`referral_flag_score`: bank / phone / e-mail / account = 2, others 1); score ≥ `referral_review_flag_threshold` (2) creates the referral as `review` (= under review): rewards held, earns nothing until an administrator approves | T04 two_signals_under_review |
| A1.6 | Mass sign-ups | Velocity flags: > `referral_velocity_per_day` (5) per referrer, > `referral_velocity_per_ip` (3) per network hash in 24 h | T06 velocity |
| A2.1 | Rewards on unpaid / refunded work | Line written only by `referral_create_reward` when the payout is RELEASED and the client payment is `completed`; otherwise `payment_not_cleared` / `no_invoice` | T11 hold_period_boundaries |
| A2.2 | Refund or chargeback after the reward | `referral_hold_days` (14) pending period, matured only by `referral_mature_lines` while payment and payout are still cleared; refund -> reversal at the original rate; dispute -> held | T11 hold_period_boundaries, T12 refund_reversal |
| A2.3 | Wash work for a friendly client | Related-party check at release: client shares account / e-mail / company domain / phone / network hash with referrer or referred, or one of them is a member of the paying tenant -> line `held` (`related_party`), administrators notified | T13 related_party |
| A2.4 | Many tiny fake invoices | `referral_min_invoice` (20, invoice currency) on the invoice line fee | T10 min_invoice |
| A2.5 | Farming beyond normal volumes | Monthly caps per referrer (1,000) and per referred consultant (250) and optional lifetime cap: the full line is HELD (`cap`) and flagged, never silently cut | T14 caps_flag_not_cut |
| A3 | Tier gaming with fake consultants | Tier count only: admin-verified, profile gate passed, active non-review referral, active pair, not suspended / rejected / merged / anonymised, and (default on) first paid ticket within 90 days of verification or admin approval | T17 tier_gaming |
| A4.1 | Guessing codes | Generated codes carry 7 random characters from a 31-character safe alphabet (31^7); custom codes need ≥ 7 letters/digits; no code listing or search for non-admins | T01 codes_unguessable |
| A4.2 | Brute force on the code checker | Rate limit per network hash AND per account; 10 invalid codes in an hour lock that key for an hour (generic message; valid codes are not answered either); counters stored by salted hash | T08 code_bruteforce_lockout |
| A4.3 | Enumeration | Valid = `{valid, masked name}` only; invalid, unknown, too short and switched-off codes give the identical `{"valid": false}` | T09 enumeration_identical |
| A4.4 | Late / stuffed / spoofed attribution | Only `referral_code` is read from sign-up metadata (ids, status, amounts ignored); link older than 30 days ignored; first valid code wins, never overwritten (PK); after sign-up only the claim window or an audited admin | T07 spoofed_signup_metadata, T03 |
| A5.1 | Forged writes (status, amount, rate, referrer) | No INSERT/UPDATE/DELETE grant on any referral table for anon / authenticated; RLS select-own or admin-only | T18 browser_cannot_write, T25 function_privileges_catalogue |
| A5.2 | Calling internal money functions | Default deny: every referral function outside the RPC list has EXECUTE revoked from PUBLIC/anon/authenticated; all definer functions pin `search_path` | T19 internal_functions_denied, T25 |
| A5.3 | Double credit (replays, job + trigger, parallel sessions) | Unique key + unique index per payout (`kind = 'reward'`) and per reversal, `FOR UPDATE` on payout and referral rows, nightly catch-up uses the same idempotent function, payout bundling serialised by an advisory lock | T15 double_credit_repeated, T26 double_credit_parallel |
| A5.4 | Bad money values | numeric(14,2); CHECKs: reward ≥ 0 with a payout and rate, reversal ≤ 0 referencing its original, adjustment ≠ 0 with an author, currency `^[A-Z]{3}$`, rate 0–10; one rounding function `referral_money` (2 decimals, half-up) | T16 money_constraints |
| A5.5 | Paying the wrong account / account takeover | Only through the normal payout flow to the referrer's own payout details that an admin verified; 7-day cool-down (`payout_details_change_hold_days`) after any bank change, plus in-app and e-mail notice to the account | T23 payout_cooldown |
| A6.1 | Admin enriching their own account | `referral_admin_is_party`: no admin action on a line, referral, code or adjustment where they are referrer or referred | T22 admin_self_and_four_eyes |
| A6.2 | Large manual adjustments | Above `referral_adjust_four_eyes_amount` (100) a request is created; only a different super administrator (not the requester, not the target) approves; expires after 7 days | T22 admin_self_and_four_eyes |
| A6.3 | Silent insider changes | Every admin action, setting / tier change and announcement logged with actor, reason, before/after (`referral_events` + `audit_logs`); rate-change history | T22 (audit count) |
| A6.4 | Books drifting / tampering | Nightly `referral_daily_reconcile` (formula, reversal mirror, payouts = lines, paid = completed payouts, in-payout lines open, nothing available before its hold, rate cap, one reward per payout) -> security notification to super administrators; anomaly dashboard (top earners, fast risers, network / bank clusters, reversal ratio, rewards vs invoices) | T24 reconcile_alert |
| A7.1 | Referrer learns the referred consultant's rate, clients, tickets, e-mail | Answers carry masked names, fee base, hours and an anonymous "Engagement #XXXX" only; no hourly rate column; salted opaque keys | T21 masked_names_only |
| A7.2 | Reading other consultants' data / ids | RLS own-row; calculation RPCs refuse another consultant's id; no uuid in consultant answers | T20 rls_own_data_only, T21 |
| A7.3 | Fingerprint / IP / bank leaks | Salted hashes in service-only tables (`referral_devices`, `referral_attribution_signals`, `referral_party_signals`, `referral_code_attempts`); acknowledgement hash/user agent not granted to the browser; retention `referral_signal_retention_days` (365) in the nightly job | T20 rls_own_data_only, T04, T05 |
| A8 | Disputes about rules | Terms (lawyer draft) state the review period, hold / reverse / cancel / forfeit for fraud, monthly limits and not-wages; short version on the Refer & earn page | manual review |

## Refer & earn page tracking (docs/sql/referral-tracking.sql, prepared, not applied)

| # | Threat | Control | Test name |
|---|---|---|---|
| TR.1 | Anonymous callers or other signed-in users read referral tracking | All four RPCs take the consultant only from `auth.uid()` (`referral_my_consultant`), EXECUTE revoked from PUBLIC/anon; internal helpers revoked from authenticated | TR01 tracking_functions_denied |
| TR.2 | Wrong or tampered calculation shown | Lines show the stored fee, rate, tier and amount exactly as created by the database; the page only formats them (`src/lib/referralTracking.ts`) | TR02 reward_line_breakdown |
| TR.3 | Hold reasons reveal fraud signals | `referral_public_hold_reason` reduces holds to review / dispute / cap; related-party and admin holds read as "review" | TR03 hold_reason_public |
| TR.4 | Leak of ids, full names, client, ticket or hourly rate | Masked name (Feature X public format), anonymous `L-XXXXXX` line and `Engagement #XXXX` references, approved hours and fee only; no ticket title (decided against the request's "shortened ticket title": a title can name the client) | TR04 privacy_no_ids_names_rates |
| TR.5 | Payout references usable to reach other data | `RP-` + first 8 hex of the consultant's own payout row plus the bank's own transfer reference; nothing else | TR05 payouts_with_reference |
| TR.6 | Rejection reasons reveal the admin note or flags | One of three plain categories (account closed, fraud review, rules) | TR06 rejected_reason_plain |
| TR.7 | Terms re-acceptance skipped | Accepted version/date and current version from the append-only acknowledgements; a new version shows "accept again" | TR07 terms_status |
| TR.8 | Menu dot reveals other people's activity | `my_referral_nav_state` returns only the caller's newest line time and own pending count; NULL for non-consultants | TR08 nav_state |

## RPC and edge function review

Refer & earn page (read-only, SECURITY DEFINER, fixed search_path, no service key): `my_referral_reward_lines`, `my_referral_payouts`, `my_referral_tracking`, `my_referral_nav_state`; CSV is built in the browser from the caller's own rows.


Browser RPCs (all `SECURITY DEFINER`, `search_path` pinned, revoked from PUBLIC; anon only the first three):

- Public: `referral_validate_code` (rate limit + lock-out, generic answers), `referral_track_click` (counts only), `referral_public_settings` (numbers only).
- Consultant (own data via `referral_my_consultant()` from `auth.uid()`): `my_referral_overview`, `my_referrals`, `my_referral_invite`, `my_referral_history`, `referral_claim` (claim window, lock-out), `referral_accept_terms` (append-only), `referral_update_code` (once, ≥ 7 characters), `referral_calc_*` (own id unless admin via `referral_calc_target`), `referral_is_admin`.
- Admin (`referral_is_admin()` first line; settings and actions rate limited, reason required, audited): `admin_referral_overview`, `_referrals`, `_referrers`, `_lines`, `_events`, `_action`, `_set_settings`, `_export`, `_reconcile`, `_rate_history`, `_announcement_preview/_send/_log`, `_anomalies`, `_adjust_requests`; `admin_referral_decide_adjustment` requires super admin.
- Service only (job / triggers): `referral_create_reward`, `referral_mature_lines`, `referral_bundle_payouts`, `referral_nightly`, `referral_daily_reconcile`, `referral_email_claim`, `referral_email_done`.

Edge function `referral-run` (the only one for this feature): uses the service role, but takes **no input** from the
request (body ignored, POST only); it only sends what the service-only `referral_email_claim` leased (10-minute lease,
at most 5 attempts), to the queued user's own confirmed address, and answers with counts. No user-controlled value
reaches a service-role query. No other edge function was added.

## Limits we could not make fully safe

- Payment-method fingerprint: payments store no card or bank fingerprint (transfers only carry free-text references), so the related-party check uses account, e-mail, company domain, phone, network hash and company membership only.
- Device and network signals are probabilistic: the device id is a random browser id (cleared by private windows) and VPNs change the network hash; they flag, they do not prove.
- Paying clients' network hash is seen only when the client reports or confirms a payment themselves.
- Bank details have no separate contact: the change notice goes to the account in the app and by e-mail; e-mail address changes rely on the sign-in system's own confirmation to both addresses (setting not verified here).
- Rate limits use the existing database counter (`check_rate_limit`); there is no platform-level rate limiter.
- Anyone holding the database salt (database owner) could brute-force IPv4 hashes; the salt lives in a service-only table.
- A payout that produced a reward can no longer be deleted (RESTRICT), by design for the money audit trail.
