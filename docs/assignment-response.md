# Feature L: assignment response policy

## Turn it on (owner)

1. Apply `docs/sql/assignment-response.sql` (run step 0, the `ALTER TYPE ... ADD VALUE 'expired'` line, on its own first if your SQL editor asks).
2. Nothing else: the reminder function is already deployed, and the file schedules the 5-minute check itself.
3. Until the file is applied: the popup, policy text, admin timings form and client card already work with the default timings; no reminders, "No response" notices or statistics exist yet, and the reminder function answers `{"ok":false}`.

Syntax check: all 56 statements and 14 procedural functions parse (PostgreSQL 17 parser); not executed.

## Where the policy appears

Popup, every reminder e-mail and notification, consultant Requests page, consultant Settings (Notifications card), consultant tour (step after "My bids"), quick guide ("How fast must I answer an assignment request?"), Terms & Conditions ("Assignment Requests"). The text follows the admin timings (Terms uses the default wording).

## Response rate

Answered share of requests under this policy, counted only from 3 requests on. Used inside the "response" ranking factor (half reply speed, half answered share) and shown only to administrators (Settings, lowest 10). Never shown to clients or other consultants.

## New English strings for Arabic

| Key | English |
| --- | --- |
| assignment_policy.title | Replying to assignment requests |
| quick_guide.reply_q | How fast must I answer an assignment request? |
| tour.c.reply_title | Answer assignment requests in time |
| assignment_client.title | Sent match requests |
| assignment_client.status_pending | Waiting |
| assignment_client.status_expired | No response |
| assignment_client.waiting | Request sent to {{name}}, waiting for reply. |
| assignment_client.no_response | {{name}} did not respond within the time limit. |
| assignment_client.invite_another | Invite another |
| assignment_client.open_bids | Open for bids |
| assignment_client.wait_longer | Wait longer ({{time}}, once) |
| assignment_client.wait_title | Give {{name}} more time? |
| assignment_client.wait_body | The request opens again for {{time}}. You can do this once per request; you can still invite someone else meanwhile. |
| assignment_client.wait_confirm | Give more time |
| assignment_client.extended | {{name}} has {{time}} more to reply. |
| assignment_client.extend_failed | More time could not be given. The request may already have had more time once. |
| admin.assignment_title | Assignment request reminders |
| admin.assignment_switch | Send reminders and No response notices |
| admin.assignment_switch_hint | Off: consultants still get the first request message, but no reminders, and requests are not marked No response. |
| admin.assignment_field_r1 | Reminder 1 after (hours) |
| admin.assignment_field_r2 | Reminder 2 after (hours) |
| admin.assignment_field_r3 | Reminder 3 after (hours) |
| admin.assignment_field_expire | No response after (hours) |
| admin.assignment_field_extend | "Wait longer" adds (hours) |
| admin.assignment_field_critical_r1 | Critical reminder 1 (minutes) |
| admin.assignment_field_critical_r2 | Critical reminder 2 (minutes) |
| admin.assignment_field_critical_r3 | Critical reminder 3 (minutes) |
| admin.assignment_field_critical_expire | Critical No response (minutes) |
| admin.assignment_field_hourly_limit | Most reminders per consultant per hour |
| admin.assignment_problem_range | Every value must be a whole number of minutes between 1 minute and 7 days (at most 60 reminders per hour). |
| admin.assignment_problem_order | Reminders must come in order (1, then 2, then 3) and not after the No response time. |
| admin.assignment_problem_critical | Critical reminders must come in order and not after the Critical No response time. |
| admin.assignment_save | Save timings |
| admin.assignment_reset | Undo changes |
| admin.assignment_saved | Timings saved. New requests use them. |
| admin.assignment_save_failed | The timings could not be saved. Please try again. |
| admin.assignment_policy_preview | Policy shown to consultants |
| admin.assignment_stats_unavailable | Statistics are unavailable until the assignment-response SQL is applied. |
| admin.assignment_last_run | Last check |
| admin.assignment_sent_today | Reminders sent today |
| admin.assignment_waiting | Requests waiting for a reply |
| admin.assignment_no_response | No response in the last 30 days |
| admin.assignment_lowest | Lowest response rates (administrators only) |
| admin.assignment_consultant | Consultant |
| admin.assignment_missed | {{count}} without reply |
| assignment_policy.accepted | Request accepted. |
| assignment_policy.declined | Request declined. |
| assignment_policy.answer_failed | Your answer could not be saved. Please try again. |
| (Terms page, English only) | Assignment Requests section |

The policy sentence itself, the reminder and "No response" notification texts and both e-mails already ship in Arabic (built from the timings), so they need no translation.
