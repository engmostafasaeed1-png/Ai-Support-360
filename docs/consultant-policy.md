# Feature N - Consultant Service Policy acknowledgement

## Owner actions
1. Have your lawyer review the draft text (EN + AR) in `src/lib/consultantPolicy.ts` / step 11 of `docs/sql/consultant-policy.sql` (marked "Draft - have your lawyer review").
2. Apply `docs/sql/consultant-policy.sql` (independent of the other prepared files). The text becomes version 1 at that moment.
3. Optional: run `docs/sql/consultant-policy.test.sql` (rolls itself back).
Until then the public page shows the draft, nobody is asked or restricted, and the admin page is read-only.

## Behaviour
- Public, printable page `/consultant-policy` (EN/AR switch, `?version=N`), linked from the footer, the consultant sign-up form and the profile. Kept out of search results while it is a draft.
- New consultants (e-mail or Google - the step runs after the account exists): last section of the profile set-up, "Final step: Consultant Service Policy", summary + full text in a scrollable panel, required checkbox "I have read and accept the Consultant Service Policy (version X)", "Accept and submit for review" disabled until ticked. There was no separate "Submit for review" button before (profiles go to the admin review list on sign-up); the admin review card now shows "Policy accepted v1 on <date>" or "Policy not accepted yet".
- Existing consultants: pop-up "Please confirm our updated service policy" once per sign-in until confirmed (not on the profile page, which shows the step inline), persistent banner on dashboard and profile, one e-mail + in-app notice, one reminder after 3 days, "Remind me later" until the grace deadline.
- Grace: `policy_grace_days` (default 7) from the first display (pop-up, step or e-mail). After it: no new bids, no accepting assignments, hidden from directory/map/matching and Critical alerts. Declining, existing tickets, sign-in, reading and confirming are never blocked.
- New version (Admin > Console > Consultant policy > Publish): same flow for everyone, versions cannot be edited or deleted.
- Acknowledgements are append-only (consultant, version, time, salted IP hash, user agent, language shown, where accepted). Consultants read their own, admins all; nobody can update or delete.
- Admin page: status per consultant (accepted version/date, in grace, pending, restricted), search, filter, CSV, "Send reminder" (in-app now, e-mail within the hour, once per 24 h), grace days, publish, audit trail.
- E-mails: template `consultant-policy-notice` (EN/AR by profile language), hourly credential-free job `consultant-policy-run`, at most 200 per run; switch `consultant_policy_emails`.
- Not covered yet: the Feature I team-member "confirm engagement" step (its SQL is not applied); add the same check there when Feature I phase 2 is built.
- Note: the NDA and Terms do not contain an explicit "no off-platform" clause today; section 3 of the policy adds it from the existing platform rules (contact details only after assignment, clients pay the platform).

## New English strings (for Arabic)
The policy text itself is already bilingual (draft). UI strings:
- Consultant Service Policy / Summary / Full policy text / Read the full policy (printable) / Print / Language / version {{v}}
- I have read and accept the Consultant Service Policy / version / Tick the box to continue. / Confirm / Accept and submit for review
- Please confirm the Consultant Service Policy / Please confirm our updated service policy / Remind me later / Close
- Please confirm by {{date}}. Until then nothing changes for you.
- Please confirm within {{n}} days. Until then nothing changes for you.
- Until you confirm, you cannot accept new assignments or place new bids, and you are not shown in search, matching or Critical alerts. Your current tickets continue.
- Please confirm the Consultant Service Policy (version {{v}}) / Review and confirm
- Confirm the Consultant Service Policy to place new bids and accept new assignments.
- Final step: Consultant Service Policy
- Read the summary and the policy, then accept it. This is the last step before our team reviews your profile.
- We have updated our service policy. Please read the summary and confirm it.
- Confirming the policy will be available here shortly. You can already read it.
- Accepted version {{v}} on {{date}}.
- Thank you - the policy is confirmed. / Policy accepted. Our team reviews your profile next.
- Before your profile goes to review you will be asked to accept the
- Working as a consultant on AI Support 360
- Server messages: Confirm the Consultant Service Policy before placing a new bid / Confirm the Consultant Service Policy before accepting a new assignment / A newer version of the Consultant Service Policy is available. Please reload and read it. / Too many attempts. Please try again in an hour.
- Admin: Consultant policy / Accepted / In grace period / Pending (not shown yet) / Restricted / Grace period (policy_grace_days) / Days from first display before restrictions / Acknowledgements (current version {{v}}) / Search name or e-mail / Filter by status / All consultants / Export CSV / No consultants match. / Consultant / Status / First shown / Deadline / Last reminder / Send reminder / Reminder sent: in-app now, e-mail within the hour. / Not sent: already confirmed or reminded in the last 24 hours. / Publish a new version / Edit the text for a new version / Title (English) / Title (Arabic) / Summary (English) / Summary (Arabic) / Text (English) / Text (Arabic) / Effective from (empty = now) / Publish version {{v}} / Publish version {{v}}? / Every consultant will be asked to confirm the new version. It cannot be edited or deleted after publishing. / Audit trail / Version {{v}} published / Reminder sent (version {{v}}) / Grace period changed from {{from}} to {{to}} days / {{name}} accepted version {{v}} ({{lang}}, {{source}}) / Nothing yet. / Policy accepted v{{v}} on {{date}} / Policy not accepted yet / version {{v}} not yet
- Admin intro and pending notice: see `ConsultantPolicySection.tsx` (two sentences each).
