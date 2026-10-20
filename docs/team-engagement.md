# Feature I — team engagement: multi-assign check, team requests, team thread

Database file: `docs/sql/team-engagement.sql` (not applied). Post-apply checks: `docs/sql/team-engagement.test.sql` (runs in a transaction and rolls back).

## Can a ticket have more than one consultant today? (checked 20 Oct 2026)

- `tickets.consultant_id` is a single column: one "main" consultant per ticket.
- `ticket_assignments` already allows several consultants per ticket (unique per ticket + consultant; roles lead / support / observer). Clients can add them on their own tickets and administrators on any ticket, through the same "Assignments" panel on the ticket page (the admin ticket page reuses it). The live database has 0 assignment rows, so this was never used.
- Today those assignments skip every gate (no acceptance, rate, NDA or confirmation) and leave no audit entry.
- Per-consultant data already exists: rates (`ticket_rates`: one approved per ticket + consultant), work logs (`ticket_work_logs.consultant_id`), timesheets (`ticket_timesheet_submissions.submitted_by` + own `hourly_rate`), invoices (`ticket_invoices.consultant_id`), payments and payouts (`consultant_id`), private chat and ratings (per `sessions` row = one client + one consultant).

## How the team table replaces the single column without breaking anything

- `ticket_team_members` holds every consultant on a ticket. `tickets.consultant_id` stays as the "primary" consultant; it is filled by the first member who passes all four gates and moves when the client marks another started member as primary.
- `ticket_assignments` rows are written only by `team_activate()` after the four gates, so files, remote access, chat and timesheets follow the gates without being rewritten.
- Existing single-consultant tickets are copied in as legacy/active members; nothing changes for them.
- Each member keeps their own approved rate, work logs, timesheet submissions, invoice lines, payments and payout, exactly as today, because all of those are already keyed by consultant.
- Clients and administrators use the same `team_invite` / `team_end_member` / `team_replace_member` functions; administrators no longer skip the gates when adding someone, may skip only the removal notice, and every administrator change is written to `audit_logs`.
- Phase 2 switches the Assignments panel (client and admin) to these functions, so the direct-insert path disappears from the screens.

## Consultant-initiated team requests (section 15)

- Who: a consultant whose engagement is accepted or further (accepted, rate approved, NDA signed, ready, active).
- Fields: reason (required, 3–300 characters), needed skill/module (prefilled from the ticket), optional suggested consultant (id only, chosen from matcher shortlist or directory public cards), optional estimated extra hours, payer = client (fixed; each consultant is paid their own approved rate).
- Client (or administrator) answers Approve / Decline / Choose someone else. Approval invites the consultant as a normal request; they then go through accept, rate approval, NDA and engagement confirmation.
- Limits: team size from setting `max_team_size` (default 5), 3 open requests per consultant per ticket, one request per 24 h per consultant, a declined person cannot be suggested again on that ticket for 7 days. Open requests expire after 14 days, when the ticket finishes or when the requester leaves.
- M60: reason, skill and notes pass the contact-details check; no names or contact data are exchanged outside the portal.
- Notifications: client (card + in-app), copy to administrators, outcome to the requester. E-mail for the client is Phase 2.

## Team thread (section 16)

- One shared thread per ticket for the client, company colleagues, administrators and members who passed all four gates. Display names only, text only, contact-details check on every message, 20 messages per minute per person. Private client–consultant threads are unchanged.

## New English strings for Arabic translation

| English | Arabic |
|---|---|
| Request an additional consultant | طلب استشاري إضافي |
| Reason | السبب |
| Needed skill or module | المهارة أو الوحدة المطلوبة |
| Suggested consultant (optional) | استشاري مقترح (اختياري) |
| Estimated extra hours (optional) | الساعات الإضافية المقدّرة (اختياري) |
| Who pays: the client pays each consultant's approved rate | من يدفع: يدفع العميل لكل استشاري سعره المعتمد |
| Send request | إرسال الطلب |
| Team request | طلب فريق |
| Team request (copy) | طلب فريق (نسخة) |
| Team request approved | تمت الموافقة على طلب الفريق |
| Team request declined | تم رفض طلب الفريق |
| Approve | موافقة |
| Decline | رفض |
| Choose someone else | اختيار شخص آخر |
| Withdraw request | سحب الطلب |
| Pending | قيد الانتظار |
| Approved | تمت الموافقة |
| Declined | مرفوض |
| Withdrawn | مسحوب |
| Expired | منتهي الصلاحية |
| Please give a short reason (3 to 300 characters) | يرجى كتابة سبب مختصر (من 3 إلى 300 حرف) |
| You cannot suggest yourself | لا يمكنك اقتراح نفسك |
| This consultant is already on the team | هذا الاستشاري موجود في الفريق بالفعل |
| This consultant is already suggested in an open request | هذا الاستشاري مقترح بالفعل في طلب مفتوح |
| The client declined this consultant recently; you can suggest them again after 7 days | رفض العميل هذا الاستشاري مؤخرًا؛ يمكنك اقتراحه مرة أخرى بعد 7 أيام |
| The team is already full (5 consultants) | الفريق مكتمل بالفعل (5 استشاريين) |
| You already have 3 open team requests on this ticket | لديك بالفعل 3 طلبات فريق مفتوحة على هذا الطلب |
| You can send one team request every 24 hours | يمكنك إرسال طلب فريق واحد كل 24 ساعة |
| Only a consultant who accepted this request can ask for an additional consultant | فقط الاستشاري الذي قبل هذا الطلب يمكنه طلب استشاري إضافي |
| Please choose a consultant to invite | يرجى اختيار استشاري لدعوته |
| They start once the four steps are done. | يبدأ العمل بعد إكمال الخطوات الأربع. |
| (the client chose a different consultant) | (اختار العميل استشاريًا آخر) |
| Team chat | محادثة الفريق |
| Visible to the client and every team member who is ready to start | تظهر للعميل ولكل عضو في الفريق جاهز للبدء |
| Write a message to the team | اكتب رسالة إلى الفريق |
| You are sending messages too quickly; please wait a moment | أنت ترسل الرسائل بسرعة كبيرة؛ يرجى الانتظار قليلًا |
| Administrator | المسؤول |
| Maximum team size | الحد الأقصى لحجم الفريق |
| Team forming - waiting for confirmations | جارٍ تكوين الفريق - بانتظار التأكيدات |
