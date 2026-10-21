# Feature W — Requests and success statistics

Prepared SQL: `docs/sql/success-stats.sql` (not applied). Scratch checks: `docs/sql/success-stats.test.sql`.
Until the owner applies the SQL, every success surface stays hidden (the public RPC is missing, so the hooks report "not available").

## What counts
- **Counted request**: an engagement the consultant actually worked (team status ready/active, a legacy active assignment, or the ticket's consultant) that reached an end state.
- **Solved**: ticket ended resolved/closed and the client confirmed it (client rating, review, satisfaction answer, or the ticket closed by the client), and the client did not mark it "not solved".
- **Not solved**: ended badly after work started — removed/withdrawn/replaced after start, client marked "not solved", cancelled or expired after start.
- **Excluded**: never started (declined, expired invitations, withdrawn before ready, bids not chosen), admin-voided engagements (audited, with reason), merged duplicate tickets, and test accounts (admin tag `test` / `test data`).
- Resolved/closed without any client confirmation stays "awaiting confirmation" (not counted) — no invented numbers.

## Display
The photo ring keeps two arcs (outer client reviews, inner responsiveness). Success is shown as level stars beside the name: rosette + 4 slots (Bronze 1 copper, Silver 2 steel, Gold 3 yellow with shine, Platinum 4 cool white-blue with shine; other slots faint), the label "Success: Gold" and a counts pill. Small places show only the stars, percentage on hover.

## Levels (admin setting `success_levels`, default `{bronze:60, silver:80, gold:85, platinum:100, min_requests:5}`)
| Level | Rate |
|---|---|
| Success: Bronze | 60 % – 79 % |
| Success: Silver | 80 % – 84 % |
| Success: Gold | 85 % – 99 % |
| Success: Platinum | 100 % (every request solved) |

Below the minimum (`success_min_requests`, default 5, takes precedence): "New" and plain counts. Below 60 %: plain counts only. Public display switch `success_public` (default ON). Whole-number maths (`solved * 100 >= threshold * total`), so 99.9 % is Gold, not Platinum.

## Recompute, disputes, overrides
- Nightly recompute (cron) plus admin "Recompute now"; recompute-all is service-role only, same style as responsiveness.
- Consultant: "Ask for a review" on a "not solved" request (within 30 days, one pending at a time); admin accepts (counts as solved) or rejects, audited.
- Admin: void an engagement from the stats with a reason (audited), or undo the void.
- Client: "Not actually solved?" on a resolved/closed request (owner of the request), with Undo.

## Migration note
Existing consultants start with no stored numbers; the first recompute (run at the end of the SQL file) fills them from finished tickets. Consultants with fewer than 5 counted requests show "New".

## Arabic strings (new UI)
| English | Arabic |
|---|---|
| Bronze / Silver / Gold / Platinum | برونزي / فضي / ذهبي / بلاتيني |
| Success: {level} | النجاح: {level} |
| AI Interview: {tier} | مقابلة الذكاء الاصطناعي: {tier} |
| Success level: {level} ({stars} of 4 stars) - {solved} of {total} requests solved ({pct} %) - last 12 months {pct12} | مستوى النجاح: {level} ({stars} من 4 نجوم) - تم حل {solved} من {total} طلبًا ({pct} ٪) - آخر 12 شهرًا {pct12} |
| Success level {level}, {stars} of 4 stars, {solved} of {total} requests solved | مستوى النجاح {level}، {stars} من 4 نجوم، تم حل {solved} من {total} طلبًا |
| One outlined star with a number = client reviews; rosette with 4 level stars = Success level | نجمة واحدة مفرغة مع رقم = تقييمات العملاء؛ وردة مع 4 نجوم مستوى = مستوى النجاح |
| Success: New / Success | النجاح: جديد / النجاح |
| {solved} of {total} solved | تم حل {solved} من {total} |
| Success: New - {solved} of {total} requests solved | النجاح: جديد - تم حل {solved} من {total} طلبًا |
| Success: New - no finished requests yet | النجاح: جديد - لا توجد طلبات منتهية بعد |
| Success: {solved} of {total} requests solved | النجاح: تم حل {solved} من {total} طلبًا |
| A Success level shows after {n} finished requests. | يظهر مستوى النجاح بعد {n} طلبات منتهية. |
| A Success level shows from {pct} % solved. | يظهر مستوى النجاح ابتداءً من {pct} ٪ من الطلبات المحلولة. |
| {total} requests · {solved} solved · {pct} % | الطلبات: {total} · المحلولة: {solved} · {pct} ٪ |
| {total} requests · {solved} solved | الطلبات: {total} · المحلولة: {solved} |
| New | جديد |
| {n} more finished requests until a Success level shows | {n} طلبات منتهية أخرى حتى يظهر مستوى النجاح |
| {n} more solved requests in a row to reach Success: {level} | {n} طلبات محلولة أخرى على التوالي للوصول إلى النجاح: {level} |
| Success: {level} needs every request solved | النجاح: {level} يتطلب حل جميع الطلبات |
| Highest Success level reached | تم الوصول إلى أعلى مستوى نجاح |
| Requests and success | الطلبات والنجاح |
| Requests / Solved / Not solved / Success rate / Level | الطلبات / المحلولة / غير المحلولة / نسبة النجاح / المستوى |
| Ask for a review | اطلب مراجعة |
| Review requested | قيد المراجعة |
| Not actually solved? | لم يُحل الطلب فعليًا؟ |
| Mark as not solved | سجّل: لم يُحل |
| You marked this request as not solved | سجّلتَ أن هذا الطلب لم يُحل |
| Rosette with 4 level stars next to the name: Success level | وردة مع 4 نجوم مستوى بجانب الاسم: مستوى النجاح |
| One outlined yellow star with a number: client reviews | نجمة صفراء واحدة مفرغة مع رقم: تقييمات العملاء |
| Success: Gold (3 stars) or better | النجاح: ذهبي (3 نجوم) أو أعلى |
| Shield chip: AI interview level | شارة الدرع: مستوى مقابلة الذكاء الاصطناعي |

Admin screen strings (Success tab, breakdown, void/override dialogs) are inline in `src/components/admin/SuccessAdmin.tsx`.
