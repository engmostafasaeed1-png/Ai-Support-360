# BRD approval by the assigned consultant

Status: **built, prepared, NOT applied.** The screens stay hidden until `docs/sql/ticket-brd-approval.sql` is
applied (they ask the database first and show nothing when its functions are missing). The e-mail worker
`brd-approval-run` is deployed and answers "not ready" until then.

## What it does

When the client attaches a BRD version to the ticket (or presses "Ask the consultant to approve vX"), the assigned
consultant must read that exact version and either **Approve** (with the tick "I have read BRD vX in full and agree it
describes the work"), **Request changes** (comment required) or **Decline** (reason required). The decision is bound
to the version number and a SHA-256 fingerprint of its content; it can never be edited or deleted.

States per version: Not requested · Pending consultant approval · Approved by consultant · Changes requested ·
Declined · Superseded (a newer version was submitted) · Withdrawn ("Proceed without BRD", or the version was
unattached).

## Settings (Admin › Settings › BRD, all audited)

| Setting | Default | Options |
|---|---|---|
| Approval rule | **Recommended** | Off · Recommended (show state, never block) · Required (block until approved) |
| Every team member must approve | Off (lead consultant only) | On: lead + every other consultant who can read the BRD (observers never) |
| Allow "no material change" | Off | On: a new version can keep the earlier approval; consultants get an FYI |
| Send approval e-mails | On | Off: in-app notices only |
| Remind the consultant every N days | 2 | 1-30 |
| Tell the client after N days | 3 | 1-60 |
| Escalate to administrators after N days | 5 | 1-90 |
| Maximum reminders per consultant | 5 | 0-20 |
| Decisions per consultant per hour | 20 | 1-200 |

"Required" blocks only while a BRD round is open. No BRD submitted, or the request withdrawn, never blocks: a BRD
stays optional. An earlier approved version keeps work going while a newer version waits. Admins can waive the
approval for one ticket (reason required, audited) and revoke the waiver.

## Where it shows

* BRD page: "Consultant approval" card above the editor/reader: state, who must approve, due date, the consultant's
  decision bar with "What changed since v1 (the version you approved)" (section diff), client "Ask for approval" and
  "Withdraw - proceed without BRD", admin "Waive approval", history (every round, decision, comment, time, fingerprint)
  and "Download BRD vX with approval record (PDF)" (the BRD PDF plus an "Approval record" page).
* Attach dialog: tick "Ask the assigned consultant to approve this version" (on by default while approval is on).
* Versions list: approval chip per version.
* Ticket header (client and consultant): state chip and, when blocking, "Waiting for BRD approval".
* Ticket tracking: new automatic step "BRD approved by consultant" between NDA and engagement confirmation ("Not
  used" when nobody asked), next action "the consultant approves / the client updates", side chip "Waiting for BRD
  approval", suggested working status "Waiting for consultant", and timeline rows (sent, approved by, changes
  requested, declined, superseded, withdrawn, waived) with the comment text for both sides.
* Lists: consultants "Needs my approval" (sorted first), clients "Awaiting consultant approval".
* Team engagement: on team tickets the next step after the NDA becomes "review and approve the BRD" while blocking.

## Notices and e-mails (one recipient per event)

| Event | In-app | E-mail |
|---|---|---|
| Submitted | lead (+ members when "all members") | "Please approve BRD vX": ticket, summary, what changed since the approved version, due date |
| Reminder every N days (max N) | approver | yes (reminders pause category) |
| No material change | approvers (FYI) | yes |
| Approved (all required) | client (green) | yes |
| Partly approved | client | no |
| Changes requested | client (amber) | yes, with the comment |
| Declined | client (red) + administrators | yes, next steps; administrators get their own mail |
| Still waiting after N days | client (once) | yes |
| Overdue after N days | administrators (once) | yes |
| Withdrawn / waived | consultants / client | no |

Admins preview every e-mail in EN/AR with sample data and can "Send test to me" (own address, "[TEST] ", 6/hour).

## Security

* Browsers never read or write the approval tables (no grants); everything goes through SECURITY DEFINER functions
  that check the caller with the BRD reader rule (`brd_role_for`) and the approver list (`brd_approval_required`).
* Observers, bidders, other consultants and outsiders cannot decide; company colleagues read only.
* Decisions are append-only; rounds keep their version and fingerprint (guard triggers); waivers can only be revoked.
* Notes refuse contact details (M60) and are limited to 2000 characters; decisions are rate limited.
* A decision on an old version is refused with "a newer version was submitted".
* Names follow the name-privacy rule (`consultant_name_for`).
* The BRD reader rule now also admits a team member whose NDA is signed by both (`nda_signed`), so the BRD can be
  approved before the engagement confirmation.

## Applying

1. Apply `docs/sql/ticket-brd-approval.sql` once (transaction). It also redefines, with identical combined bodies,
   functions from `ticket-brd.sql`, `team-engagement.sql` and `ticket-tracking.sql` (a test keeps them identical).
2. Run `docs/sql/ticket-brd-approval.test.sql` (26 checks, rolls back).
3. In Admin › Settings › BRD choose the approval rule (default Recommended).

Checked on a private copy of the live database: the file applies twice without errors, all 26 approval checks pass,
`ticket-brd.test.sql` (22) and `ticket-tracking.test.sql` still pass, and the home files work with the stubs alone.

## Test plan per role

* Client: attach v1 with the tick → card shows "Pending consultant approval"; header chip; list filter "Awaiting
  consultant approval". After "changes requested": amber notice + e-mail with the comment; edit, save v2, attach →
  v1 "Superseded", v2 pending. "Withdraw - proceed without BRD" → nothing blocks. Download approval record PDF.
* Consultant (lead): bell + e-mail "Please approve BRD v1"; list "Needs my approval"; open BRD → decision bar;
  Approve without the tick → refused; Request changes with < 10 characters → refused; phone number → refused;
  Approve v2 after v3 was submitted → "a newer version was submitted". In Required mode: work log and timesheet
  submission refused with "Waiting for BRD approval" until approved.
* Support member: no decision bar unless "every team member must approve" is on.
* Admin: settings, previews + test send, decline notice/e-mail, overdue escalation, waiver with reason (audit log).
* Arabic: switch language → all labels, chips, dialogs, notices and e-mails right-to-left.
