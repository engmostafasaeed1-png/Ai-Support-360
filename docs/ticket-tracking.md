# Two-layer ticket tracking

Status: **built, switched OFF, database part prepared but NOT applied**
(`docs/sql/ticket-tracking.sql` + `docs/sql/ticket-tracking.test.sql`, for owner review).
Until the SQL is applied nothing changes for clients and consultants: the ticket page keeps the old status stepper,
lists show no new chips, the admin settings card says "not installed".

## 1. Current status model (inventory)

| Item | Where | Notes |
|---|---|---|
| Official status | `tickets.status` enum `ticket_status`: new, under_review, matched, in_progress, waiting_for_client, resolved, closed | **Unchanged.** Nothing renamed, removed or repurposed. |
| Who changes it | client edit/close flow, `consultant_set_ticket_status` (only in_progress / waiting_for_client / resolved, 30/h, participant check), admin board/detail, matching/assignment triggers | Unchanged. |
| Outcome | `client_set_ticket_outcome` → `close_outcome` (unresolved / cancelled), `close_outcome_at/by` | Read only by tracking. |
| SLA | `tickets_apply_sla`, `flag_sla_breaches` (sets `sla_breached`), critical first reply | Unchanged; tracking durations are "for information only". |
| Success stats | `success_on_ticket_change` on tickets.status / close_outcome | Unchanged, no new trigger on `tickets` updates. |
| Status history | `audit_tickets` trigger → `audit_logs` (`tickets.updated`, old/new json) | Source for status transitions, work start, delivery, reopen. |
| Assignments | `ticket_assignments` (lead/support/observer, active/completed/removed) | Observers are mirrored into `ticket_team_members` as legacy support rows → tracking checks observer first (read only). |
| Team engagement gates | `ticket_team_members` (accepted/rate_approved/nda_signed/confirmed/ready_at), `team_ticket_gated`, `team_next_step`, `team_member_started` | Reused as-is; no duplicate gate rule. |
| Rate | `ticket_rates` (`respond_to_ticket_rate`) | Rate approved step. |
| NDA | `nda_agreements` (consultant + client signatures, revoked_at) | NDA step. |
| Timesheets / invoices | `ticket_timesheet_submissions`, `ticket_work_logs`, `ticket_invoices`, `payments` | Work start + timeline. |
| Messages | `messages` via `sessions.ticket_id`, `ticket_team_messages` | Timeline shows daily counts only (no text). |
| Existing timeline | `ticket_timeline` / `ticket_timeline_v2` RPCs + `TicketTimeline` component (Activity tab) | Kept. The new unified timeline is inside the tracking card. |
| Notifications | `safe_insert_notification`, pause-aware `sendTemplateEmail`, notification pause categories activity / reminders | Reused. |

## 2. Automatic stage (derived, read-only)

One derivation only: the database returns **facts** (`tt_facts`), the browser derives the stepper with
`deriveStage` in `src/lib/ticketTracking.ts` (unit-tested). No stage is stored, so it can never drift.

| # | Step | Done when (source) |
|---|---|---|
| 1 | Submitted | always (`tickets.created_at`) |
| 2 | Details complete | SAP area set and description ≥ 20 characters; BRD attachment shown if present |
| 3 | Matching / bids open | first match request, bid or `opened_for_bids_at` |
| 4 | Consultant selected | accepted proposal / match, consultant assigned (audit), team member selected |
| 5 | Rate approved by client | approved `ticket_rates` row or team `rate_approved_at` |
| 6 | NDA signed by both | both signatures in `nda_agreements` or team `nda_signed_at` |
| 7 | Engagement confirmed | team-engagement tickets only (`ready_at` / both confirmations); legacy tickets show "Not used for this ticket" |
| 8 | Work in progress | first work log, timesheet, session, message after selection, or first move to in_progress |
| 9 | Delivered / awaiting client | ticket moved to resolved (audit) |
| 10 | Resolved / closed | status closed (+ outcome solved / not solved) |

Side states: On hold, Blocked (waiting for client / consultant / third party — from the official
`waiting_for_client` status or the working status), Cancelled (close_outcome), Reopened (resolved/closed → open again).
A step that was never reached while a later one was is shown as **skipped** (e.g. direct assignment without bids).
The "what happens next + who must act" line follows `team_next_step` for team-engagement tickets.

### Gaps (no exact data source today)

- **Details complete time**: no "details became complete" record. Shown with the ticket creation time when the
  details were complete at creation, otherwise "Time not recorded". Smallest fix if wanted: one
  `ticket_tracking_stage_events(ticket_id, step, at)` row written by a tiny trigger when SAP area + description first pass the check.
- **BRD attached**: the BRD SQL (`docs/sql/ticket-brd.sql`) is not applied either. Until then the BRD is recognised
  by its file name `BRD_<ticket>_v<N>_<date>.pdf`; after it is applied this should switch to `doc_type = 'brd'`.
- **Who triggered a step**: shown as a role (client / consultant / both / system), never a name.

## 3. Working status (manual, new data)

- Tables `ticket_working_status` (current, version) + `ticket_working_status_events` (history). Written only by
  `tt_set_working_status` (SECURITY DEFINER): caller's role on that ticket, admin matrix, mandatory notes,
  M60 contact filter, length limit, 30 changes/hour, optimistic concurrency (version), idempotent repeats.
- Default list and matrix (admin-editable in Admin › Settings › Ticket tracking):

| Status | Client | Consultant | Note required |
|---|---|---|---|
| Not started | ✓ | ✓ | |
| In analysis | | ✓ | |
| Waiting for client information | | ✓ | ✓ |
| Waiting for consultant | ✓ | | ✓ |
| Waiting for third party / access | ✓ | ✓ | ✓ |
| In development / configuration | | ✓ | |
| In testing | ✓ | ✓ | |
| Ready for client review | | ✓ | |
| Needs rework | ✓ | | ✓ |
| On hold | ✓ | ✓ | ✓ |
| Completed (from my side) | ✓ | ✓ | |

  Admins can always set every status. Observers, bidders, invited-but-not-ready consultants and company colleagues
  cannot set anything (observers can read).
- "Completed (from my side)" by a consultant never closes the ticket: the client sees "The consultant says their part
  is complete" with "Yes, done from my side too" / "Needs rework"; closing still uses the normal flow.
- Optional expected date (today … +1 year) and "who must act"; overdue badge after the date.
- Notifications: the other side gets an in-app notice (rapid changes within 15 minutes update the same unread
  notice) and, if e-mails are on, one e-mail per person and ticket per 15 minutes (pause rules respected,
  activity category). Reminders (reminders category): one day before the expected date, when overdue (max 3),
  and to the client after "Ready for client review" for 3+ days (max 3) — at most one per item per day,
  stop when the status changes. Daily job 06:43 UTC, bounded to 500 rows.

## 4. Screens

- Ticket header (client, consultant, admin): two clearly labelled chips — dashed "Stage: …" (automatic) and
  coloured "Working status: …" + "set by the consultant 2 h ago" — next to the unchanged official status badge.
- Tracking card: 10-step stepper with times and roles, side states, "Your turn" line, working status + change dialog,
  time per status / waiting on whom / time per stage, unified timeline (filters: system / working status / comments;
  CSV and PDF export with Arabic font).
- Lists (client tickets, consultant cases, admin board): working status chip, "Needs my action" toggle with count,
  filter by working status, sorts (waiting for me first, by working status, recently changed), saved filters (this browser).
- Admin: settings card (switch default OFF, e-mails, limits, status labels EN/AR, colour, order, on/off, matrix,
  reason → audit log) and dashboard card "Tickets stuck in one working status for more than N days".

## 5. Security

- Every read and write goes through SECURITY DEFINER RPCs with a fixed search path and a per-ticket role check;
  tables have RLS with no browser write policies; EXECUTE revoked from anon.
- Names never appear in tracking data or e-mails (roles only). Notes pass the M60 contact filter.
- E-mail worker `ticket-tracking-run`: job-token checked, claims at most 50 queued rows, counts-only response.
- Retention: rows reference the ticket with ON DELETE CASCADE, so they disappear with the ticket.

## 6. Applying (owner)

1. Review `docs/sql/ticket-tracking.sql`. 2. Apply it once (re-running is safe). 3. Run
`docs/sql/ticket-tracking.test.sql` on a scratch copy (66 checks passed on a copy of the current structure).
4. Deploy `ticket-tracking-run`. 5. Admin › Settings › Ticket tracking → check labels/matrix → switch on.

Arabic strings: `src/i18n/locales/ar.json` → `tracking` (same keys as `en.json`).
