# SLA policies

Status: **built, database part prepared for review and NOT applied.** Admin switch `sla_policies.enabled` defaults to
**OFF**. While it is off (or while `docs/sql/sla-policies.sql` is not applied) everything works exactly as today.

## 1. How SLA works today (inventory)

| Piece | Today |
|---|---|
| Policy rows | `ticket_sla_policies`: 4 system rows (critical 60/480, high 240/1440, medium 480/4320, low 1440/10080 minutes) + client rows, written directly from the browser (`SLAPolicyManager`). `business_hours_only` is stored but **not used** in the maths. |
| Deadlines | Trigger `tickets_apply_sla`: from **submission** (`created_at`), ordinary minutes (24x7), client policy for urgency/module else system default -> `sla_response_deadline`, `sla_deadline`. `first_response_at` = first status change away from `new` (not a consultant reply). |
| Breach | Cron `sla-breach-check` every 5 min -> `flag_sla_breaches()`: sets `sla_breached`, one in-app "SLA breached" notice to admins + the primary consultant. No client notice, no team, no reminders before the breach. |
| Screens | Client SLA page (averages, breach rate, deadline table, Configure tab), `TicketSLATracker` (recomputes from the live policy, so edits could change open tickets on screen), deadline field on ticket lists/details. |
| Critical service (M56) | Separate: `critical_response`, 30-minute reply, +30 % surcharge, own alarm. Unchanged. |
| Related | Ticket tracking working statuses (waiting for client info / third party / on hold), BRD approval gate (prepared, not applied), NDA both-signed rule, consultant responsiveness (assignment replies), notification pauses (Feature Q), push/Telegram links, shared e-mail sender settings. |

## 2. What is reused

- **Clock pauses** read the ticket-tracking working status (`ticket_working_status.status_key`), the official status
  `waiting_for_client`, the NDA both-signed rule (`nda_agreements`) and the BRD approval gate (`brd_gate_state`, probed:
  no pause while that file is not applied).
- **People** come from existing assignment data: `tickets.consultant_id`, `ticket_assignments` (lead/support),
  `ticket_team_members` (ready/active), company roles in `tenant_members` (owner/admin/manager).
- **Start rule "ready"** uses the team engagement gates (`team_ticket_gated`, `ready_at`).
- **First response** = first chat message / team message / critical reply by an assigned consultant.
- **Notifications**: in-app rows with the Feature Q pause category (`reminders`, or `essential` for S1 steps the policy
  marks "cannot be paused"); e-mail through `sendTemplateEmail` + shared sender settings; Web Push and Telegram helpers
  of the bulk-message worker; job-token wake-up like BRD approval. Same 30-minute minimum between repeats.
- **Contact-info filter (M60)** `contact_details_in_text` on every free text.
- **Critical service** stays the premium rule: an S1 response under 60 minutes needs it; without it the snapshot uses 60.
- **Today's 5-minute cron** is reused: `flag_sla_breaches()` keeps its old work for tickets without a snapshot and
  runs `sla_sweep()` when the switch is on. No new cron job.

## 3. Model

- **Severities** S1 Critical, S2 High, S3 Medium, S4 Low (admin-editable labels EN/AR, colours, definitions; examples
  shown to clients when they choose the urgency). Mapping urgency -> severity is admin-editable.
- **Policy** (versioned, immutable versions, hash dedupe): per severity response / optional workaround / resolution;
  coverage 24x7 or business hours (days, start-end, IANA time zone or the client's company time zone, client dates,
  admin national holiday lists); clock start (submitted / assigned / ready), pauses, stop (resolved / closed); escalation
  ladder per severity (percent of target or minutes after the target; who; channels in-app / e-mail / push / Telegram;
  message; repeat >= 30 min, until acknowledged; S1 "cannot be paused"); breach handling (notify, flag, ask client,
  offer replacement); extra contacts (registered company members on the company domain only).
- **Scopes**: one platform default (mandatory, seeded from today's live rows), three templates, client policies owned by
  a company (or by a client without company). Applies to all tickets, an SAP area or SAP modules (tickets have no tags).
- **Snapshot**: on ticket creation (switch on) the effective policy version is copied to the ticket. Later edits never
  change it; "Apply new policy to this ticket" (client) or activation with "apply to open tickets" creates a new
  snapshot, keeps counted minutes and informs both parties. Re-classification restarts the targets from the change time.
- **Clock maths**: `sla_business_minutes` / `sla_add_business_minutes` (SQL) = `businessMinutes` / `addBusinessMinutes`
  (TypeScript); tests cover time zones, DST, holidays, weekends, pause/resume.
- **No penalties**: `sla_breach_financial_hook(ticket, clock)` is an empty extension point.

## 4. Who can do what

| Role | Can |
|---|---|
| Admin | Switch, severities, mapping, bounds (minimum targets, max steps/repeats, coverage/start/pause options, premium rule), quiet hours, acceptance requirement, compliance alert, channels; edit platform default + templates; view/override client policies (client managers are told); holidays; re-classify tickets with a reason; compliance by client/consultant/severity, breach list with reason codes, CSV; dry run; test e-mail to self. |
| Client company owner/admin (or own-account client) | Create from template / default / scratch, edit (drafts always save), activate with effective date (never in the past), optionally apply to open tickets, history with diff + restore, duplicate, archive; on tickets: apply new policy, accept/decline consultant re-classification or counter-proposal, breach choice (extend / another consultant / admin help). |
| Client member | Reads the company's policies and the ticket SLA. |
| Assigned consultant | Sees the ticket snapshot (not the extra contacts), acknowledges with ETA (client sees it), marks workaround, proposes re-classification. |
| Candidate consultant (request / bid / team invite) | Sees the terms (no clocks) and must tick "I accept the SLA ..." before accepting or bidding (stored with snapshot + version); may counter-propose targets (bounds apply). |
| Others / other clients | Nothing (all RPCs check the role on that ticket / company). |

## 5. Settings and defaults (`platform_settings` key `sla_policies`)

`enabled` false · at risk from 75 % · quiet hours 22:00-07:00 (consultant time zone, not S1) · consultants must accept
true · S1 unpausable steps allowed true · compliance alert below 90 % (once a day, min 10 measured targets) · channels
in-app / e-mail / push / Telegram on (SMS does not exist) · minimum response S1 15 / S2 30 / S3 60 / S4 120 min ·
minimum resolution S1 120 / S2 240 / S3 480 / S4 960 min · max 6 steps · max 6 repeats · repeats >= 30 min ·
max 5 extra contacts · premium: S1 response under 60 min needs the Critical service.

Templates (seeded, admin-editable): **Standard** (business hours Sun-Thu 09-17; S1 1 h / workaround 4 h / 2 bd, S2 2 h /
2 bd, S3 1 bd / 5 bd, S4 2 bd / 10 bd; full ladder), **Enterprise 24x7** (S1 1 h / 4 h / 8 h, S2 2 h / 1 d, S3 8 h / 2 d,
S4 1 d / 5 d), **Business hours light** (S1 2 h / 4 bd ... short ladder). National holiday lists start empty: the admin
adds the dates per year (no dates were invented).

## 6. Files

- SQL (not applied): `docs/sql/sla-policies.sql`, rolled-back checks `docs/sql/sla-policies.test.sql` (SL01-SL30, all pass on a scratch copy of the current structure).
- Shared rules: `supabase/functions/_shared/slaPolicy.ts` (+ `src/lib/sla/policy.ts` re-export); e-mail layout `_shared/slaEmail.ts`, template `sla-notice.tsx` (registry); worker `supabase/functions/sla-run/` (deployed; without the SQL it answers "not ready").
- Browser: `src/lib/sla/api.ts`, `src/hooks/useSla.ts`, `src/components/sla/*` (chips, ticket panel, acceptance box, policy editor/centre, compliance cards, list controls, severity guide), `src/pages/admin/AdminSlaPage.tsx` (route `/admin/sla`, menu "SLA policies").
- Wired into: client ticket detail, consultant case detail (chips + panel), client tickets / consultant cases / admin ticket board (SLA chip, filter at risk / breached / paused, sort by time left), new request (severity guide), bid form and assignment popup (acceptance), client and consultant dashboards, client SLA page (new tabs while on).
- Tests: `src/lib/sla/slaPolicy.test.ts` (29), `src/lib/sla/slaUi.test.ts` (5).

## 7. Arabic strings

All texts live under `sla.*` in `src/i18n/locales/ar.json` (411 keys, same keys as English; checked by the generator)
plus `sidebar.sla_policies`. E-mail texts are in `_shared/slaEmail.ts` (EN/AR, RTL). Database notices are EN/AR by the
recipient's preferred language. Consultant-facing wording avoids "warning" / "تحذير".

## 8. Test plan (after applying the SQL and switching on)

1. **Admin**: open Admin > SLA policies, switch on with a reason; check the platform default (= today's numbers); edit
   bounds; add a holiday date; send the test e-mail (EN and AR) to yourself; dry run a ticket ID.
2. **Client admin (company owner)**: SLA page > SLA policy > start from "Standard"; change S2 response to 2 h; preview
   "S2 opened Sunday 17:00" shows Monday 11:00 (Riyadh); try S1 response 5 min (blocked) and 30 min (warning: needs
   Critical service); add `boss@gmail.com` as extra contact (refused); save, activate now. Create a new ticket (High) -> header shows "Response: 2 h left".
3. **Client member**: sees the policy read-only; cannot save.
4. **Consultant (candidate)**: assignment popup / bid form shows "I accept the SLA ..."; Accept / Send bid stays disabled until ticked; propose different targets; client accepts -> snapshot changes.
5. **Assigned consultant**: first chat reply -> "Response: Met"; set working status "Waiting for client information" -> "Paused: ... since hh:mm"; resume; acknowledge with ETA (client sees it); propose S3.
6. **Breach**: let a short target pass (or wait) -> reminders at 50/75/90 %, breach notice, client gets "choose the next step"; extend 1 h -> chip back to "left".
7. **Other client / unassigned consultant**: ticket SLA and policies are refused.
8. **Switch off** -> new tickets get no snapshot; legacy deadlines and "SLA breached" notices continue.

## 9. Open questions for the owner

- Pricing: should tighter-than-default targets (e.g. 24x7 or S1 under 2 h) cost more, beyond today's Critical +30 %? Today the platform only measures; no price change is applied.
- Lawyer review of the disclaimer texts (policy editor, ticket panel, consultant acceptance).
- National holiday dates (Saudi Arabia, UAE, Egypt, ...) to pre-load per year.
- Should the response target count from assignment (new default for policies) or from submission (today) for the platform default? The seeded default keeps today's "from submission".
- When the switch is on, "response" means the first consultant reply (today: first status change). Confirm.
- Extra recipients outside the company (e.g. an external manager) are not supported: the platform e-mails registered users only.
