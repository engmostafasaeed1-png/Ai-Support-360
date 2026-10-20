# Feature L: assignment response policy

## Status: live (applied 2026-10-20)

`docs/sql/assignment-response.sql` is applied on the live backend: step 0 and steps 1-10 as two migrations, the default settings and the 5-minute check (288 runs a day) separately. The reminder function answers `{"ok":true}`.

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
| assignment_policy.popup_reminder_title | Reminder: assignment request waiting |
| assignment_policy.popup_title | New assignment request |
| assignment_policy.area | SAP area |
| assignment_policy.urgency | Urgency |
| assignment_policy.critical | Critical |
| assignment_policy.bid_invite | Bid invitation |
| assignment_policy.proposed_rate | Proposed rate |
| assignment_policy.hour | hour |
| assignment_policy.reply_by | Reply by |
| assignment_policy.more_waiting | {{count}} more request(s) waiting after this one. |
| assignment_policy.decline | Decline |
| assignment_policy.view | View details |
| assignment_policy.accept | Accept |
| assignment_policy.later | Remind me later |
| assignment_policy.accepted | Request accepted. |
| assignment_policy.declined | Request declined. |
| assignment_policy.answer_failed | Your answer could not be saved. Please try again. |
| (Terms page, English only) | Assignment Requests section |

The policy sentence itself, the reminder and "No response" notification texts and both e-mails already ship in Arabic (built from the timings), so they need no translation.

## Addition: decision preview, Request more information, decline reasons

Status: live (applied 2026-10-21). `docs/sql/assignment-info-requests.sql` was applied unchanged; a rolled-back live trial (preview + viewed, ask + pause, second ask refused, answer + resume with at least 2 h, decline + private reason) passed. The app switches the options on through `assignment_info_ready`.

- **Open ticket description**: title, description (contact details and client names masked), SAP area/module/details, urgency, industry, country, hours/budget/rate, deadlines, attachment names + type + size only. Files, credentials, remote access, links and contact details stay behind NDA + rate + engagement. Opening it stores `viewed_at`; the client sees "Viewed by <name>". Not an answer, the clock keeps running.
- **Request more information**: up to 3 topics + 500 characters, contact filter, max 3 per request, one open at a time. The clock pauses, the request counts as responded at that moment (Feature L rate, Feature M first response). The client answers on the ticket (text + optional file through the normal upload); the clock resumes with the time left, at least 2 hours. No answer within `info_wait` (default 24 h, admin field) returns it to the client as "Waiting for your answer"; never counted against the consultant.
- **Decline reasons** (optional): stored privately for administrators; the ticket owner only sees anonymous "next best" tips.
- Arabic strings: `assignment_info.*` in the locale files (complete); e-mails are bilingual.
