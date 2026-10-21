# Feature Y — weekly availability required, urgent reminders, "On hold"

Prepared SQL: `docs/sql/availability-hold.sql` (not applied). Scratch checks: `docs/sql/availability-hold.test.sql` (all pass).
Already live without the SQL: the new weekly editor on the profile, the urgent banner/pop-up (no deadline shown), the
"Available Sun-Thu 09-17" line on cards and the summary on the public profile. Holds, the grace rule, reminders and the
admin page switch on when the SQL is applied; the e-mail function (availability-run) and the reminder mail are deployed.

## Rules
- Weekly availability = at least one recurring weekly slot. One-date slots (calendar) do not count. The profile has no
  separate "hours" field, so "working week + hours + time zone" is entered as recurring slots by the editor (it also
  sets the time zone and the matching "Working week" value).
- Rule `availability`: required and hard-required by default; the admin switch "Weekly availability is required" turns it off.
- Grace `availability_grace_days` = 7, counted from the moment the SQL is applied (or the sign-up, if later). After it:
  left out of new matching, critical alerts and the directory. Sign-in, existing work and accepting what they already
  have are never blocked.
- Urgent notice once (in-app + e-mail, essential, never paused), sent when the SQL is applied; later sign-ups get it 24 h
  after signing up. Then the "Urgent" block inside the daily profile mail every 2 days (8 times), then weekly; never a
  second mail on the same day; stops at once when filled, when not required or while on hold; follows pause rules.
- Hold: start (default now, up to 180 days ahead), end required, max `hold_max_days` = 90, private reason (no contact
  details, 500 characters). Overlapping/touching holds merge. During a hold: no new requests, invitations, team
  invitations or critical alerts; directory "On hold until …" (not selectable) or hidden (`hold_directory_mode`); the
  period is a Feature M unavailable period; clients of active tickets get a short notice; profile/availability reminders
  pause. Auto resume by the 15-minute sweep (in-app + e-mail), "Resume now", change end, cancel a future hold,
  administrator set/clear with reason (audited).
- Admin page: Admin console → Availability (counts, settings, missing list with CSV and "Send reminder now" — 50 per
  click, 10 clicks per hour, once per consultant per 24 h, audited — and all current/upcoming holds). Weekly digest line
  for administrators on Monday after 07:00 Riyadh time.

## Migration note
Existing consultants: 22 of 32 have no recurring slot today. On apply they get the urgent notice; their 7 days start then.
Their availability status is unchanged; `on_hold` is a new status value set only by holds.

## Arabic strings (new UI and messages)
| English | Arabic |
|---|---|
| Weekly availability | التوفر الأسبوعي |
| Choose your working days and hours. Clients and matching use them; requests outside them are not counted against you. | اختر أيام وساعات عملك. يعتمد عليها العملاء والمطابقة، والطلبات خارجها لا تُحتسب ضدك. |
| Quick start / Working days / Time zone | بداية سريعة / أيام العمل / المنطقة الزمنية |
| Sun-Thu 9-17 / Mon-Fri 9-17 | الأحد-الخميس 9-17 / الاثنين-الجمعة 9-17 |
| Add time / Remove time / Copy to all working days | أضف وقتًا / احذف الوقت / انسخ إلى كل أيام العمل |
| From / To | من / إلى |
| Save availability / Undo changes / Weekly availability saved. | احفظ التوفر / تراجع عن التغييرات / تم حفظ التوفر الأسبوعي. |
| The end time must be after the start time. | يجب أن يكون وقت الانتهاء بعد وقت البدء. |
| Two times on the same day overlap. | يوجد وقتان متداخلان في اليوم نفسه. |
| Sun-Thu, 09:00-17:00 Riyadh time, 40 h/week | الأحد-الخميس، 09:00-17:00 بتوقيت الرياض، 40 ساعة/أسبوع |
| Available Sun-Thu 09-17 | متاح الأحد-الخميس 09-17 |
| Please add your weekly availability - needed for requests | يرجى إضافة توفرك الأسبوعي - مطلوب لاستقبال الطلبات |
| Clients and matching rely on it. Requests outside your availability are not counted against you. | يعتمد عليه العملاء والمطابقة. الطلبات خارج أوقات توفرك لا تُحتسب ضدك. |
| Add my availability / Later | أضف توفري / لاحقًا |
| Urgent: add your weekly availability | عاجل: أضف توفرك الأسبوعي |
| On hold / On hold until 15 Nov 2026 | التوقف المؤقت / متوقف مؤقتًا حتى 2026-11-15 |
| Set on hold / Resume now / Change end / Cancel this hold | تفعيل التوقف المؤقت / استئناف الآن / تغيير النهاية / إلغاء هذا التوقف |
| Start now / Starts / Ends (required) / Reason (optional, private) | ابدأ الآن / يبدأ / ينتهي (مطلوب) / السبب (اختياري، خاص) |
| Only you and the administrators see it. No contact details. | تراه أنت والمسؤولون فقط. بدون بيانات تواصل. |
| Please confirm / Confirm hold | يرجى التأكيد / تأكيد التوقف المؤقت |
| Your consultant is on hold from X to Y, current work continues as agreed. | مستشارك متوقف مؤقتًا من X إلى Y، ويستمر العمل الحالي كما هو متفق عليه. |
| Your hold has started / Welcome back | بدأ التوقف المؤقت / مرحبًا بعودتك |
| Welcome back - your hold has ended | مرحبًا بعودتك - انتهى التوقف المؤقت |
| A hold can last at most N days. | يمكن أن يستمر التوقف المؤقت N يومًا كحد أقصى. |
| A hold can start at most 180 days ahead. | يمكن أن يبدأ التوقف المؤقت خلال 180 يومًا كحد أقصى. |
| Please remove contact details (e-mail, phone, links) from the reason. | يرجى إزالة بيانات التواصل (البريد أو الهاتف أو الروابط) من السبب. |

Admin page strings use the existing `t(key, English fallback)` pattern under `admin.availability.*`.
