# Feature M: consultant responsiveness

## Status: live (applied 2026-10-20, after Feature L)
1. `docs/sql/responsiveness.sql` is applied on the live backend as two migrations plus the default settings; the backfill found no earlier requests.
2. `responsiveness-run` is scheduled once an hour at minute 17 (24 runs a day) instead of every 10 minutes: in-app lines and popups are immediate, so only notice e-mails and the closing of overdue alarm/chat items wait up to an hour; the nightly recalculation still runs between 01:00 and 05:00 Riyadh.
3. Review the data on **Admin › Consultant responsiveness**, then switch on "Show responsiveness to clients" (`responsiveness_public`, off by default). Until then nothing shows on cards, ratings are unchanged, ranking ignores it and nobody is left out of critical alarms; statistics, friendly notices, e-mails and disputes already run.

## What counts
- Main split (rate, warnings, badge): assignment requests and private bid invitations. Critical split: Critical requests and critical alarms (answered by a proposal or by dismissing the alarm; ignored when another consultant took the ticket first). Chat split: the first unanswered client message on an active ticket, answered by the consultant's next message, "unanswered" after 24 h (setting).
- Each event is checked on arrival: inside weekly/one-date slots in the consultant's time zone (without slots: working week, default Sunday–Thursday, 08:00–20:00), not in a period marked unavailable in advance, not marked busy, not at the stated capacity. Otherwise "not counted".
- A decline in time is a response. Withdrawn requests are left out. An answer after "No response" (after "Wait longer") keeps the no-response.
- Levels (last 90 days, min 5 counted): Excellent median < 1 h and rate ≥ 90 %; Good < 4 h and ≥ 80 %; Fair < 24 h and ≥ 60 %; else Needs improvement. Clients see "Needs improvement" only from the 3rd counted no-response in 30 days or a rate below 60 %; before that it never shows below Fair. Stars: 5 / 4 / 3 / 2 (1 below 30 %).
- Overall rating = client reviews × 85 % + responsiveness stars × 15 % (only with client reviews and after the minimum sample); breakdown on hover.
- Ranking: matcher criterion `responsiveness` (weight 3, editable in Match weights); "New" is neutral.

## Choices to confirm
- Warnings and the badge use only personally addressed requests; broadcast critical alarms and chat feed their own statistics only.
- "Offline" status does not exclude a request (19 of 26 consultants are offline by default); only "Busy" does.
- The Feature I team panel does not exist yet; the chip is on directory cards, map list, profile header, bid cards and the ticket's sent-requests card.
- Consultants get two in-app lines when a request expires: Feature L's "Request closed" and the new counted/warning line.

## New English strings (for Arabic)
| Key | English |
|---|---|
| responsiveness.chip_label | Responsiveness |
| responsiveness.level_excellent / good / fair / needs_improvement / new | Excellent / Good / Fair / Needs improvement / New |
| responsiveness.chip_details | Median reply {{median}} · {{rate}}% answered |
| responsiveness.chip_new | Not enough requests yet |
| responsiveness.blend_breakdown | Client reviews {{client}} ({{cw}}%) + Responsiveness {{resp}} ({{rw}}%, calculated automatically) = {{overall}} |
| responsiveness.review_new | Not enough requests yet to calculate it. |
| responsiveness.review_auto | Calculated automatically from response times; it does not change client ratings. |
| responsiveness.stars_aria | {{n}} out of 5 stars |
| responsiveness.popup_improve | Accept or decline every request within the time limit (a decline counts as a response), keep your availability up to date and mark vacations in advance. |
| responsiveness.popup_dispute / popup_open / popup_ok | Dispute / My responsiveness / Understood |
| responsiveness.page_title | My responsiveness |
| responsiveness.page_intro | How quickly you answer requests, critical alerts and client messages. Only requests that arrive while you are available count. |
| responsiveness.not_ready | Responsiveness statistics are not switched on yet. Nothing is counted until the platform turns them on. |
| responsiveness.public_on | Clients see only your level, median reply time and response rate, never individual requests. Declines are never shown. |
| responsiveness.public_off | Clients do not see your responsiveness yet. It is shown only after the platform switches it on. |
| responsiveness.min_sample | You have {{n}} of {{min}} counted requests in 90 days: until then your level is "New" and nothing affects your card or ranking. |
| responsiveness.recovery | Your level uses the last 90 days, so it recovers automatically as good answers replace old ones. |
| responsiveness.summary / window / scope | Statistics / Period / Type |
| responsiveness.d30 / d90 / all | 30 days / 90 days / All time |
| responsiveness.scope_main / scope_critical / scope_chat | Requests / Critical / Client chat |
| responsiveness.rate / rate_hint | Response rate / {{a}} of {{b}} counted |
| responsiveness.median / avg / p90 | Median reply / Average reply / 90 % answered within |
| responsiveness.received / counted / not_counted / not_counted_hint / no_response | Received / Counted / Not counted / Outside your availability or removed / No response |
| responsiveness.buckets, bucket_lt15 … bucket_later | Reply times, < 15 min, < 1 h, < 4 h, < 24 h, Later |
| responsiveness.no_data / no_events | No data yet. / No requests yet. |
| responsiveness.trend / trend_aria | Response rate per week (requests) / Weekly response rate for the last 12 weeks |
| responsiveness.events | Requests in the last 90 days |
| responsiveness.critical / counted_note | Critical / Counted in your statistics |
| Kinds | Assignment request, Bid invitation, Critical alert, Client message |
| Outcomes | Waiting for your answer, Answered, No response, Withdrawn or taken by someone else (not counted), Removed after your dispute (not counted) |
| Not-counted reasons | Not counted – outside your availability; – during a period you marked unavailable; – you were marked busy; – you had reached your stated capacity |
| responsiveness.dispute_pending / dispute_upheld / dispute_rejected | Dispute under review / Dispute accepted: removed from your statistics / Dispute not accepted |
| responsiveness.dispute, dispute_title, dispute_desc, dispute_reason, dispute_send | Dispute this no-response, Dispute a no-response, Tell us briefly why it should not count, for example a technical failure or a request sent outside your stated hours. You can dispute within {{d}} days, once per request., Reason, Send dispute |
| responsiveness.dispute_length / dispute_sent / dispute_failed | Please write 10 to 500 characters. / Dispute sent. An administrator will review it. / The dispute could not be sent. |
| responsiveness.periods, periods_hint | Vacation or pause, Mark a period in advance. Requests that arrive during it are not counted. Your weekly hours come from your availability in the calendar. |
| responsiveness.period_start / period_end / period_reason / period_add / period_remove | From / Until / Note (optional, only you and admins see it) / Add period / Remove period |
| responsiveness.period_order / period_saved | The end must be after the start. / Period saved. Requests that arrive then are not counted. |
| responsiveness.capacity, capacity_hint, capacity_label | Capacity, The most tickets you work on at the same time. While you are at this number, new requests are not counted. You have {{n}} active now., Active tickets (empty = no limit) |
| responsiveness.capacity_range / capacity_saved | Enter a whole number from 1 to 50, or leave it empty for no limit. / Capacity saved. |
| responsiveness.improve_title, improve_1–4 | How to improve; Accept or decline every request within the time limit; a decline counts as a response.; Keep your weekly availability and time zone up to date.; Mark vacations in advance and set your capacity so busy periods are not counted.; Switch on push or Telegram alerts so you see requests quickly. |
| sidebar.responsiveness / sidebar.responsiveness_admin | My responsiveness / Consultant responsiveness |
| admin.resp_title, resp_recompute, resp_recomputed | Consultant responsiveness, Recalculate now, Recalculated {{n}} consultants. |
| admin.resp_tab_consultants / disputes / settings | Consultants / Disputes / Settings |
| admin.resp_search, resp_level, resp_all_levels, resp_only_missed, resp_empty | Search by name, Level, All levels, Only with no-responses (30 d), No consultants match. |
| admin.resp_col_* | Consultant, Level, Response rate (90 d), Median reply, Counted (90 d), No responses (30 d), Warnings (90 d), Disputes |
| admin.resp_unavailable | Not available until the responsiveness database update is applied. |
| admin.resp_no_disputes, resp_disputed, resp_note, resp_void, resp_reject | No disputes., disputed, Note to the consultant (optional, audited), Void the no-response, Reject dispute |
| admin.resp_voided / resp_rejected | No-response removed from the statistics (audited). / Dispute rejected (audited). |
| admin.resp_public, resp_public_hint | Show responsiveness to clients (cards, rating, ranking, critical alarms), Off by default: statistics, warnings and disputes still run, but nothing shows on cards, the overall rating is unchanged, ranking ignores it and nobody is left out of critical alarms. |
| admin.resp_field_* | Minimum counted requests before anything is public; Needs improvement below this response rate (%); Warnings before the indicator shows (badge from the next one); Responsiveness share of the overall rating (%); Excellent: median under (minutes); Excellent: rate at least (%); Good: median under (minutes); Good: rate at least (%); Fair: median under (minutes); Client message counts as unanswered after (minutes); Days to dispute a no-response; Hours without availability slots: from (HH:MM); … until (HH:MM) |
| admin.resp_rank_hint, resp_problems, resp_saved, resp_save_failed | The ranking weight is "Responsiveness" in the match weights card under Settings (default 3).; Please check: {{list}}; Saved. Use "Recalculate now" to apply them to every consultant.; The settings could not be saved. |
| Match criterion | Responsiveness; chip "Excellent responsiveness" (Arabic already added: الاستجابة / استجابة ممتازة) |

The notice e-mail and popup copy (friendly notice 1 of 2, 2 of 2, indicator shown, counted, not counted, dispute accepted / not accepted; owner rule: polite wording, never "warning") is already bilingual in `supabase/functions/_shared/responsivenessCopy.ts` and in the SQL notifications.
