# Feature Z - consultant referral programme ("Refer & earn")

Status: prepared. Nothing is live until the owner applies `docs/sql/referral-program.sql` (then optionally runs
`docs/sql/referral-program.test.sql` on a scratch copy). Until then the consultant menu keeps the old member referral page,
the sign-up form shows no referral field, and the admin page says the programme is not switched on.

## Inventory (before the change)
- Member programme: `profiles.referral_code` (8 characters, automatic, immutable), tables `referrals` and `referral_rewards`
  (both empty), an `auth.users` trigger that records `?ref=` from sign-up metadata, and a $25 credit / $15 discount after
  a first paid invoice (max 20). No percentage rewards, no link to payouts. It stays for clients; consultant-to-consultant
  referrals now skip it (never paid twice).
- Money: `payments` = client invoice (v2: `base_amount` is the consultant fee; service fee, processing fee and VAT are
  separate). `admin_confirm_payment` creates a `payouts` row (`gross_amount` = fee, `due_by` = 15 business days). Payout
  status pending -> processing -> completed via `admin_set_payout_status`.

## Design as built
- Codes: `consultant_referral_codes` (e.g. SAP-MOSTAFA-7K2, case-insensitive, editable once, the previous code keeps
  working, profanity list mirrored in `src/lib/referrals.ts`). Links `/join?ref=`, `/signup?ref=`, `/for-consultants?ref=`
  keep the code 30 days (first-party localStorage + cookie).
- Attribution: `consultant_referrals` (one row per referred consultant, no browser write access). Recorded from the sign-up
  metadata, or by `referral_claim` within `referral_claim_days` (7) of the account and before the first paid ticket.
  Self-referral (same user or same e-mail ignoring +tags/Gmail dots) and loops are refused; same device, same network and
  same bank account are flagged ("review": rewards held until an administrator approves).
- ACTIVATION RULE: a pair is "pending" until BOTH passed the AI interview (completed AI session with
  `overall_score >= referral_min_interview_score`, default 50; 49 fails, 50 passes) and BOTH accepted the current version of
  the referral terms (`referral_terms_versions`, append-only `referral_acknowledgements` with time, language, browser and
  hashed IP). Only payouts created after the activation moment earn. Pending pairs expire after `referral_activation_days`
  (90) from sign-up; only an administrator can revive. Reminders after 14 and 45 days (once each). Activation never lifts a
  fraud review/hold.
- Rewards: on each payouts row of the referred consultant (= the client has paid): `round(gross_amount x 0.5 %, 2)`, one
  line per payout (`unique_key`), only inside the 12-month window from the first paid ticket, only while both are
  verified, the referrer is not suspended and has accepted the Consultant Service Policy. Pending until that payout is
  completed, then available. Refund -> reversal line; dispute -> held, released if settled. Optional caps per referred
  consultant and per referrer per month.
- Payment: nightly, available lines >= `referral_min_payout` ($25) per currency become one normal `payouts` row with
  reference `referral:<id>` (shown as "Referral reward" on Earnings and Admin Payments), paid with the existing bank
  details and the 15-business-day due date.
- Notices (in-app + one e-mail each through `referral-run`, also shown as a pop-up at the next sign-in): registered with
  your code, you were invited, each side passed, active, 14/45-day reminders, expired, acknowledgement request (admin
  resend), verified, first reward. Names always use the masked public format (Feature X).
- Admin `/admin/referrals`: totals (incl. pending/active/expired), by referred / by referrer, reward lines, settings,
  audit trail, audited CSV, actions approve / hold / reverse / adjust / change referrer / disable code / resend / revive /
  run payouts. Weekly digest line on Mondays.

## Referral calculations (Refer & earn > Referral calculations)
- All numbers come from `referral_calc_summary`, `referral_calc_referrals`, `referral_calc_lines`, `referral_calc_monthly`,
  `referral_calc_forecast` and `referral_calc_statements`, computed on every read from the reward lines, payouts, payments and
  approved timesheets, so they change as soon as an invoice is paid, released or reversed ("Last change" time shown).
- Man-days = approved hours / 8. Each reward line shows "Fee $400.00 x 0.5 % = $2.00". Net = reward earned + reversed.
- Forecast only from timesheets the client already approved (signed) but has not paid, after activation and inside the
  window; labelled "Expected, not guaranteed".
- Monthly statements are saved on the 1st (job `referral-monthly-statements`) with an in-app notice; CSV/PDF export of the
  consultant's own lines (Arabic statements print through the browser so the letters stay joined).
- The estimate box is an illustration with the real rate and window (assumed hourly rate typed by the consultant).
- Administrators: Referrals > Calculations (any consultant, read-only) and Reconciliation (reward = fee x rate, reversal =
  minus reward, referral payout = its lines, paid lines = completed referral payouts, one reward per payout).

## Onboarding step "Refer & earn"
- Shown once on the consultant Profile (the consolidated onboarding editor) after the profile sections, and as a step of the
  first-sign-in tour (only while the programme is live). Optional: "Maybe later" hides it and shows a dashboard card that
  reopens it; it is never a required item. Numbers (rate, months, minimum, pass mark) come from the live settings.
- The consultant's code is created by the database when the step opens. Share buttons follow the activation rule: before
  the AI interview is passed they explain that sharing starts after passing; after it, the terms acknowledgement is asked
  on the first Share (never at registration). "Who invited you?" uses the one-time claim (locked once linked).
- Not done on purpose: no line in the welcome / confirmation e-mail. Adding programme promotion to a transactional
  e-mail is not allowed (it is marketing content and harms deliverability); the dashboard card and tour cover it.

## Existing consultants (registered before the launch)
- Backfill: `referral_backfill_codes()` gives every consultant except rejected/suspended exactly one code (idempotent,
  collision-safe, no other column touched); everyone else gets one lazily when they open Refer & earn, and new consultants
  at registration. Dry run before applying (read-only):
  `SELECT count(*) AS consultants, count(*) FILTER (WHERE verification_status::text NOT IN ('rejected','suspended')) AS will_get_a_code, count(*) FILTER (WHERE verification_status::text IN ('rejected','suspended')) AS excluded FROM public.consultants;`
  On 22 Oct 2026 this returned 32 consultants, 31 will get a code, 1 excluded. After applying, `SELECT public.referral_backfill_preview();` shows will_create = 0.
- Nobody gets a referrer retroactively; administrators can set one (Referrals > Announcement > "Set a referrer", reason, audited).
  Existing consultants are referrers immediately under the same rules (verified, not suspended, policy accepted, AI interview).
- "Who invited you?" for consultants registered before the launch: until `referral_claim_until` (launch + 14 days,
  editable in Referrals > Settings) and only without a paid ticket; afterwards administrators only.
- Discovery: menu item and dashboard card for all consultants; a one-time introduction pop-up on the next sign-in (stored per
  account in tour progress, re-openable from the Refer & earn page and the help sheet); a bell entry sent by an administrator
  (Referrals > Announcement: preview, test to yourself, then once per consultant in batches of 200, log of who received it;
  rejected/suspended accounts and people who paused in-app notices are left out).
- The announcement is NOT e-mailed: a programme introduction sent to every consultant is promotional bulk e-mail, which the
  app's e-mail service must not carry (it hurts delivery for every other app e-mail). Use a dedicated marketing e-mail
  service if an e-mail campaign is wanted; the in-app announcement and pop-up cover everyone in the portal.

## Not done / notes
- No announcement e-mail to all consultants: app e-mails must be one-recipient and event-triggered (promotional bulk e-mail
  is not allowed). Announce through Admin > Messages (in-app / Telegram) instead; the dashboard banner and the pop-up cover it.
- Terms text and the tax note are drafts for the lawyer.

## Migration note for existing consultants
Every existing consultant gets a code when the file is applied. Nobody gets a referrer retroactively, and no reward is
created for payouts that already exist.

## Arabic strings (src/i18n/locales/ar.json, namespace `refz`)
| Key | Arabic |
|---|---|
| refz.ack_1 | تصبح الإحالة نشطة فقط عندما تجتازان كلاكما المقابلة الذكية (بدرجة {{pass}} على الأقل) ويوافق كلاكما على هذه الشروط. |
| refz.ack_2 | يجب إجراء المقابلة الذكية بأمانة، بنفسك فقط، ودون أي مساعدة خارجية. |
| refz.ack_3 | يحصل المُحيل على {{rate}} % من أتعاب المستشار المُحال لمدة {{months}} شهرًا من أول تذكرة مدفوعة له، وفقط عن الأعمال المفوترة بعد التفعيل. تدفعها AI Support 360 ولا تُخصم من أحد. |
| refz.ack_4 | يحق لـ AI Support 360 مراجعة المكافآت أو تعليقها أو عكسها أو إسقاطها في حالات الاحتيال أو إحالة النفس أو الحسابات المشتركة أو المقابلة غير الأمينة. |
| refz.ack_5 | المكافآت حافز إحالة وليست أجرًا أو راتبًا، وقد تخضع للضريبة. |
| refz.ack_full | النص الكامل (الإصدار {{v}}) |
| refz.active_since | نشطة منذ {{date}} |
| refz.admin_title | الإحالات |
| refz.available | متاح |
| refz.available_hint | تُدفع مع دورة الدفعات التالية عندما تبلغ {{min}} |
| refz.badge | إحالات موثّقة: {{n}} |
| refz.badge_earned | تم الحصول عليها |
| refz.badge_not_yet | ليس بعد |
| refz.badges | شارات المُحيل |
| refz.banner | أحِل واربح: {{rate}} % من أتعاب كل مستشار تجلبه لمدة {{months}} شهرًا - تدفعها AI Support 360 ولا تُخصم منه أبدًا. |
| refz.banner_open | افتح أحِل واربح |
| refz.best_score | أفضل درجة لك حتى الآن: {{score}}. يمكنك إعادة المقابلة وفق قواعد المقابلات المعتادة. |
| refz.c_activation | التفعيل |
| refz.c_earned | المكتسب |
| refz.c_ends | المكافآت حتى |
| refz.c_first | أول تذكرة مدفوعة |
| refz.c_joined | تاريخ التسجيل |
| refz.c_name | المستشار |
| refz.c_status | الحالة |
| refz.cancel | إلغاء |
| refz.checking | جارٍ التحقق... |
| refz.claimed | تم ربط رمز الإحالة. أحالك {{name}}. |
| refz.code_belongs | الرمز يخص {{name}} |
| refz.code_blocked | يرجى اختيار رمز آخر. |
| refz.code_disabled | رمز الإحالة الخاص بك موقوف. يرجى التواصل مع الدعم. |
| refz.code_failed | تعذّر تغيير الرمز. |
| refz.code_format | استخدم من 4 إلى 24 حرفًا ورقمًا، مجموعات تفصلها شرطة (مثل SAP-MOSTAFA-7K2). |
| refz.code_limited | عمليات تحقق كثيرة. يمكنك التسجيل، وسيُتحقق من الرمز عند إنشاء حسابك. |
| refz.code_ok | يبدو جيدًا. ستظل الروابط برمزك الحالي تعمل. |
| refz.code_saved | تم حفظ رمزك الجديد. ستظل الروابط برمزك القديم تعمل. |
| refz.code_unknown | لم يُعثر على هذا الرمز. تحقق منه أو اترك الحقل فارغًا. |
| refz.copied | تم النسخ |
| refz.copy | نسخ |
| refz.copy_code | نسخ الرمز |
| refz.copy_failed | لم ينجح النسخ. حدّد النص وانسخه بنفسك. |
| refz.copy_link | نسخ الرابط |
| refz.copy_text | نسخ النص |
| refz.deadline | الموعد النهائي: {{date}} |
| refz.draft | مسودة |
| refz.earnings | أرباحك |
| refz.edit_once | تغيير مرة واحدة |
| refz.email | البريد الإلكتروني |
| refz.example | مثال: مستشار سعره {{hourly}} في الساعة يعمل يوم عمل واحدًا (8 ساعات معتمدة). تحصل على {{reward}}. |
| refz.f_clicks | زيارات الرابط |
| refz.f_note | تُحتسب زيارات الرابط دون حفظ أي معلومات عن الزائر. |
| refz.f_paying | أول تذكرة مدفوعة |
| refz.f_signups | سجّلوا |
| refz.f_verified | موثّقون |
| refz.funnel | إحالاتك حتى الآن |
| refz.got_it | حسنًا |
| refz.h_amount | مكافأتك |
| refz.h_date | التاريخ |
| refz.h_fee | أتعابهم |
| refz.h_status | الحالة |
| refz.h_what | البيان |
| refz.history | سجل المكافآت |
| refz.history_empty | لا توجد مكافآت بعد. تظهر عندما يتقاضى مستشار أحلته أتعاب عمله. |
| refz.honest | لا يوجد وعد بدخل: تربح فقط عندما يتقاضى مستشار أحلته أتعاب عمل حقيقي. |
| refz.how | كيف يعمل البرنامج |
| refz.how_1 | شارك رابطك أو رمزك مع مستشاري SAP الذين تعرفهم. |
| refz.how_2 | يسجّلون به ويتم توثيقهم. |
| refz.how_2b | تصبح الإحالة نشطة عندما تجتازان كلاكما المقابلة الذكية (بدرجة {{pass}} على الأقل) وتوافقان على الشروط، خلال {{days}} يومًا من تسجيلهم. |
| refz.how_3 | لمدة {{months}} شهرًا من أول تذكرة مدفوعة لهم تحصل على {{rate}} % من أتعابهم عن كل ساعة معتمدة مفوترة بعد التفعيل. تدفعها AI Support 360 من رسومها. |
| refz.how_4 | تكون المكافأة قيد الانتظار حتى تكتمل دفعتهم، ثم تصبح متاحة. ابتداءً من {{min}} تُدفع مع دورة الدفعات المعتادة إلى بياناتك البنكية. |
| refz.invite_active | إحالتك نشطة منذ {{date}}. |
| refz.invite_expired | انتهت صلاحية هذه الإحالة. يمكن للمسؤول إعادة تفعيلها. |
| refz.invite_pending | يصبح برنامج الإحالة نشطًا بعد أن تجتاز أنت ومن دعاك المقابلة الذكية. الموعد النهائي: {{date}}. |
| refz.invite_title | دعاك {{name}} |
| refz.invited_by_short | دعاك {{name}} |
| refz.k_adjust | تعديل من AI Support 360 |
| refz.k_reversal | عكس (استرداد أو تصحيح) |
| refz.k_reward | مكافأة ({{rate}} %) من {{name}} |
| refz.lifetime | الإجمالي |
| refz.lifetime_hint | كل ما ربحته بعد أي عمليات عكس |
| refz.list | المستشارون الذين أحلتهم |
| refz.list_empty | لم يسجّل أحد برمزك بعد. |
| refz.load_failed | تعذّر تحميل صفحة الإحالة. |
| refz.locked_sub | رمزك جاهز، لكن المشاركة والربح يبدآن فقط بعد هذه الخطوات. |
| refz.locked_title | اجتز المقابلة الذكية لتفعيل برنامج الإحالة |
| refz.msg_lang | لغة الرسالة |
| refz.need_active | حسابك موقوف. |
| refz.need_bank | أضف بياناتك البنكية (الأرباح، بيانات البنك) لاستلام الدفعات. |
| refz.need_policy | يرجى الموافقة على سياسة خدمة المستشارين. |
| refz.need_verified | يجب توثيق ملفك الشخصي. |
| refz.new_code | رمز جديد (يمكنك تغييره مرة واحدة فقط) |
| refz.next_ack | وافق على شروط الإحالة في صفحة "أحِل واربح". |
| refz.next_none | لا شيء مطلوب. |
| refz.next_pass | اجتز المقابلة الذكية (بدرجة {{pass}} على الأقل). |
| refz.next_wait | بانتظار أن يجتاز {{name}} المقابلة الذكية ويوافق على الشروط. |
| refz.paid | مدفوع |
| refz.paid_hint | تم تحويله إلى حسابك البنكي |
| refz.paused | برنامج الإحالة متوقف مؤقتًا. المكافآت المكتسبة تبقى لك. |
| refz.payout_label | مكافأة إحالة |
| refz.pending | قيد الانتظار |
| refz.pending_hint | بانتظار اكتمال دفعة المستشار المُحال |
| refz.pitch | اربح {{rate}} % من أتعاب كل مستشار تجلبه لمدة {{months}} شهرًا - تدفعها AI Support 360 ولا تُخصم منه أبدًا. |
| refz.popup_desc | تحديثات برنامج الإحالة |
| refz.popup_title | إحالتك |
| refz.prev_code | رمزك السابق {{code}} ما زال يعمل. |
| refz.qr | رمز QR |
| refz.qr_alt | رمز QR لرابط الإحالة الخاص بك |
| refz.qr_download | تنزيل رمز QR |
| refz.qr_hint | امسح لفتح رابط الإحالة |
| refz.retry | حاول مرة أخرى |
| refz.save | حفظ |
| refz.share_link | رابط المشاركة |
| refz.share_locked | تُفتح المشاركة عندما تجتاز المقابلة الذكية وتوافق على شروط الإحالة (انظر الخطوات أعلاه). |
| refz.share_with | شارك برسالة جاهزة |
| refz.signup_ack | أوافق على شروط الإحالة: يجب أن يجتاز كلانا المقابلة الذكية بأمانة (بدرجة {{pass}} على الأقل)، ويمكن مراجعة المكافآت أو إسقاطها عند الاحتيال، وهي ليست أجرًا. |
| refz.signup_ack_later | اختياري الآن - يمكنك الموافقة لاحقًا. بدونها لا يمكن أن تصبح الإحالة نشطة. |
| refz.signup_invited | دعاك {{name}}. يصبح برنامج الإحالة نشطًا بعد أن تجتاز أنت ومن دعاك المقابلة الذكية. |
| refz.signup_label | رمز الإحالة (اختياري) |
| refz.start_interview | ابدأ المقابلة الذكية |
| refz.starts_first_paid | تبدأ مع أول تذكرة مدفوعة |
| refz.step_ack | تمت الموافقة على شروط الإحالة |
| refz.step_active | برنامج الإحالة نشط: شارك رابطك |
| refz.step_interview | اجتياز المقابلة الذكية (بدرجة {{pass}} على الأقل) |
| refz.t_active | الإحالة نشطة |
| refz.t_they_acked | وافقوا على الشروط |
| refz.t_they_passed | اجتازوا المقابلة الذكية |
| refz.t_they_ready | اجتاز {{name}} المقابلة الذكية ووافق على الشروط |
| refz.t_you_acked | وافقت على شروط الإحالة |
| refz.t_you_passed | اجتزت المقابلة الذكية |
| refz.tax | قد تخضع مكافآت الإحالة للضريبة، وأنت مسؤول عن الإقرار بها في بلد إقامتك. |
| refz.terms_accept | قرأت وأوافق على |
| refz.terms_continue | موافقة ومتابعة |
| refz.terms_failed | تعذّر حفظ موافقتك. يرجى المحاولة مرة أخرى. |
| refz.terms_link | شروط برنامج الإحالة |
| refz.terms_saved | شكرًا لك. تم حفظ موافقتك. |
| refz.their_next | خطوتهم التالية: |
| refz.title | أحِل واربح |
| refz.to_earn | لكي تربح وتستلم المكافآت: |
| refz.your_code | رمزك ورابطك |
| refz.your_next | خطوتك التالية: |
| refz.chip_waiting_you | قيد الانتظار: بانتظارك |
| refz.chip_waiting_them | قيد الانتظار: بانتظارهم |
| refz.chip_active | نشطة |
| refz.chip_expired | منتهية |
| refz.chip_under_review | قيد المراجعة |
| refz.st_signed_up | سجّل |
| refz.st_verified | موثّق |
| refz.st_paying | يربح |
| refz.st_ended | انتهت الـ 12 شهرًا |
| refz.st_on_review | قيد المراجعة |
| refz.ls_pending | قيد الانتظار |
| refz.ls_available | متاح |
| refz.ls_held | معلّق |
| refz.ls_in_payout | ضمن دفعة |
| refz.ls_paid | مدفوع |
| refz.ls_reversed | معكوس |
| refz.calc_all_referred | كل المستشارين المُحالين |
| refz.calc_all_states | كل الحالات |
| refz.calc_auto | تُحسب تلقائيًا من الفواتير المدفوعة - لا يُكتب أي رقم يدويًا. |
| refz.calc_chart | الأرباح الشهرية |
| refz.calc_chart_aria | رسم بياني بالأعمدة لمكافآت الإحالة المكتسبة والمدفوعة شهريًا |
| refz.calc_details | التفاصيل |
| refz.calc_earned | المكافأة المكتسبة |
| refz.calc_estimated | تقديري |
| refz.calc_failed | تعذّر تحميل الحسابات. |
| refz.calc_fee | أساس الأتعاب |
| refz.calc_forecast_note | * متوقع وغير مضمون: من سجلات ساعات اعتمدها العملاء ولم يدفعوها بعد ({{n}} سجل). لا تُحتسب إلا بعد دفع العميل. |
| refz.calc_formula | طريقة الحساب |
| refz.calc_hourly | السعر بالساعة |
| refz.calc_hours | الساعات المعتمدة |
| refz.calc_invoice | فاتورة العميل |
| refz.calc_mandays | أيام العمل |
| refz.calc_months | {{n}} شهرًا |
| refz.calc_net | الصافي |
| refz.calc_next | الدفعة التالية |
| refz.calc_next_none | عندما تبلغ مكافآتك المتاحة {{min}} |
| refz.calc_no_forecast | لا يوجد توقع: لا توجد حاليًا سجلات ساعات معتمدة وغير مدفوعة. |
| refz.calc_no_lines | لا توجد بنود فواتير لهذا المستشار في الفترة المختارة. |
| refz.calc_period | الفترة |
| refz.calc_rate | النسبة |
| refz.calc_referred | المستشارون المُحالون |
| refz.calc_referred_hint | الإجمالي / الموثّقون / الذين يربحون |
| refz.calc_release | صرف الدفعة |
| refz.calc_reversed | المعكوس |
| refz.calc_rule | قاعدة مكافأتك |
| refz.calc_rule_hint | من أتعاب المستشار المُحال، من أول تذكرة مدفوعة له |
| refz.calc_series_earned | المكتسب |
| refz.calc_series_expected | متوقع وغير مضمون |
| refz.calc_series_paid | المدفوع |
| refz.calc_show_lines | عرض بنود الفواتير لـ {{name}} |
| refz.calc_state | الحالة |
| refz.calc_statement | كشف الإحالة |
| refz.calc_statement_meta | {{n}} بند · أُنشئ في {{date}} |
| refz.calc_statements | الكشوف الشهرية |
| refz.calc_statements_empty | يُنشأ كشفك الأول تلقائيًا في اليوم الأول من الشهر القادم، وستصلك إشعار بذلك. |
| refz.calc_table | الحساب لكل مستشار مُحال |
| refz.calc_threshold | {{have}} من {{min}} متاح |
| refz.calc_threshold_aria | التقدم نحو الحد الأدنى للدفع |
| refz.calc_ticket | التذكرة |
| refz.calc_total | الإجمالي |
| refz.calc_updated | آخر تغيير: {{date}} |
| refz.calc_window | نهاية المدة |
| refz.est_days | أيام العمل شهريًا لكل مستشار |
| refz.est_hourly | السعر المفترض بالساعة ($) |
| refz.est_month | حوالي {{v}} شهريًا |
| refz.est_n | عدد المستشارين المُحالين |
| refz.est_note | توضيح فقط وليس وعدًا بدخل. يستخدم النسبة الفعلية ({{rate}} %) والمدة ({{m}} شهرًا)؛ المكافآت الحقيقية تعتمد على الساعات المعتمدة التي يدفعها العملاء فعلًا. |
| refz.est_title | تقدير (للتوضيح فقط) |
| refz.est_window | حوالي {{v}} خلال {{m}} شهرًا |
| refz.refresh | تحديث |
| refz.tab_calc | حسابات الإحالة |
| refz.tab_overview | نظرة عامة |
| refz.period_all | كل الفترات |
| refz.period_month | هذا الشهر |
| refz.period_3m | آخر 3 أشهر |
| refz.period_year | هذه السنة |
| refz.act_pending | قيد الانتظار |
| refz.act_active | نشطة |
| refz.act_expired | منتهية |
| refz.pay_completed | مدفوعة |
| refz.pay_pending | قيد الانتظار |
| refz.pay_refunded | مستردة |
| refz.pay_disputed | محل نزاع |
| refz.step_headline | اجلب زملاءك واربحوا معًا |
| refz.step_optional | اختياري - لا يؤثر على ملفك الشخصي |
| refz.step_how_1 | شارك رمزك أو رابطك الشخصي |
| refz.step_how_2 | يسجّل زميلك به ويتم توثيقه |
| refz.step_how_3 | تحصل على {{rate}} % من أتعابه عن كل يوم عمل لمدة {{months}} شهرًا - تدفعها AI Support 360 ولا تُخصم منه أبدًا |
| refz.step_activation | تصبح إحالتك نشطة عندما تجتازان كلاكما المقابلة الذكية (بدرجة {{pass}} على الأقل). |
| refz.step_example_title | ما الذي يمكن أن تربحه |
| refz.step_illustrative | مثال توضيحي |
| refz.step_example_one | زميل واحد يفوتر {{days}} أيام عمل في شهر بسعر {{hourly}}/ساعة: {{days}} × {{hours}} ساعات × {{hourly}} = أتعاب {{fee}} ← مكافأتك {{reward}}. |
| refz.step_example_many | {{n}} زملاء مثله ← {{reward}} في ذلك الشهر. |
| refz.step_example_note | مثال فقط وليس وعدًا؛ المكافآت تعتمد على أعمال زملائك المعتمدة والمدفوعة. |
| refz.step_paid_title | كيف تُدفع لك |
| refz.step_paid_1 | يظهر بند المكافأة بعد أن يدفع العميل. |
| refz.step_paid_2 | يصبح متاحًا عند صرف دفعة زميلك. |
| refz.step_paid_3 | يُدفع مع دفعتك المعتادة عندما يبلغ رصيدك المتاح {{min}}. |
| refz.step_paid_4 | ترى كل بند في صفحتي الأرباح وحسابات الإحالة. |
| refz.step_rules_title | القواعد |
| refz.step_rule_1 | الزملاء الموثّقون فقط. |
| refz.step_rule_2 | لا إحالة للنفس. |
| refz.step_rule_3 | تُعكس المكافآت إذا استُردّت الدفعة. |
| refz.step_rule_tax | الضريبة على المكافآت مسؤوليتك. |
| refz.step_code_title | رمزك الشخصي |
| refz.share_needs_interview | تبدأ المشاركة بعد اجتيازك المقابلة الذكية (بدرجة {{pass}} على الأقل). رمزك محفوظ بالفعل. |
| refz.step_later | لاحقًا |
| refz.step_done | فهمت |
| refz.who_title | من دعاك؟ أدخل رمز الإحالة |
| refz.who_hint | اختياري. بعد ربطه لا يمكن تغييره. |
| refz.who_link | ربط هذا الرمز |
| refz.claim_failed | تعذّر إضافة الرمز. |
| refz.claim_too_late | يمكن إضافة الرمز فقط في الأيام الأولى بعد التسجيل وقبل أول تذكرة مدفوعة. |
| refz.claim_self | لا يمكنك استخدام رمزك الخاص. |
| refz.claim_loop | لا يمكن استخدام هذا الرمز (أنت من أحال هذا المستشار). |
| refz.claim_already | يوجد رمز إحالة مرتبط بحسابك بالفعل. |
| refz.later_title | أحِل واربح: اجلب زملاءك واربحوا معًا |
| refz.later_body | رمزك الشخصي جاهز. اطّلع على طريقة العمل عندما يتوفر لديك دقيقة. |
| refz.later_open | اعرف كيف يعمل |
| tour.c.refer_title | أحِل واربح |
| tour.c.refer | اجلب زملاءك واربحوا معًا: شارك رمزك؛ عندما يعمل زميل أحلته تحصل على {{rate}} % من أتعابه لمدة {{months}} شهرًا، تدفعها AI Support 360 ولا تُخصم منه أبدًا. يبدأ ذلك بعد اجتيازكما كليكما المقابلة الذكية. |
| refz.help_intro | أحِل واربح: كيف يعمل |
| refz.who_until | متاح حتى {{date}}. |

## Reward tiers (owner rule)

The rate depends on the referrer's number of referred consultants who are **verified and not suspended** (rejected, suspended,
removed and never-verified sign-ups do not count), checked when each new reward line is created:

| Verified referred | Default rate |
|---|---|
| 0-10 | 0.5 % |
| 11-20 | 0.6 % |
| 21-30 | 0.7 % |
| 31-40 | 0.8 % |
| 41+ | 1.0 % |

- Each reward line stores `rate_percent`, `tier_name` and `tier_count`; old lines never change. Reversals copy the original rate and amount.
- A lower count later means later lines use the lower rate.
- Admins edit tiers in Settings (1-5 tiers, first starts at 0, counts and rates strictly ascending, every rate <= `referral_max_rate`, default 2 %). Invalid stored tiers fall back to the defaults. Changes are audited (`admin_referral_rate_history`).
- Forecast and the illustration calculator use the tier reached today / after the assumed referrals; reconciliation checks `rate_within_tiers_cap`.
- Mirrors for screens and tests: `tierFor`, `tiersProblem`, `parseTiers`, `rateRangeText` in `src/lib/referrals.ts`.

### Arabic strings (tiers)

| refz.pitch | اربح {{rate}} % من أتعاب كل مستشار تجلبه لمدة {{months}} شهرًا - كلما زاد عدد المستشارين الموثّقين الذين تحيلهم ارتفعت نسبتك. تدفعها AI Support 360 ولا تُخصم منهم أبدًا. |
| refz.how_3 | لمدة {{months}} شهرًا من أول تذكرة مدفوعة تحصل على نسبة شريحتك ({{rate}} %) من أتعابهم عن كل ساعة معتمدة تُفوتر بعد التفعيل. تدفعها AI Support 360 من رسومها. |
| refz.example | مثال بنسبتك الحالية ({{rate}} %): مستشار بسعر {{hourly}} للساعة يعمل يوم عمل واحدًا (8 ساعات معتمدة). تحصل على {{reward}}. |
| refz.step_how_3 | تحصل على {{rate}} % من أتعابهم عن كل يوم عمل لمدة {{months}} شهرًا - ترتفع النسبة مع عدد المستشارين الموثّقين الذين أحلتهم؛ تدفعها AI Support 360 ولا تُخصم منهم أبدًا |
| refz.ack_3 | يحصل المُحيل على {{rate}} % من أتعاب المستشار المُحال (حسب الشريحة: ترتفع النسبة مع عدد المستشارين الموثّقين الذين أحالهم، وتحتفظ كل مكافأة بنسبة لحظة إنشائها) لمدة {{months}} شهرًا من أول تذكرة مدفوعة، فقط على العمل المُفوتر بعد التفعيل. تدفعها AI Support 360 ولا تُخصم من أحد أبدًا. |
| refz.est_note | للتوضيح فقط وليس وعدًا بدخل. يفترض أن جميعهم سيصبحون موثّقين فتكون نسبتك {{rate}} %، ويستخدم المدة الفعلية ({{m}} شهرًا)؛ المكافآت الحقيقية تعتمد على الساعات المعتمدة التي يدفعها العملاء فعلًا وعلى شريحتك عند إنشاء كل مكافأة. |
| refz.calc_tier | {{name}} ({{n}} موثّقين). {{needed}} آخرين للوصول إلى {{next}} ({{rate}} %). |
| refz.calc_tier_top | {{name}} ({{n}} موثّقين)، أعلى شريحة. |
| refz.tier_title | نسبتك ترتفع مع إحالاتك |
| refz.tier_current | شريحتك: {{name}} - {{rate}} % ({{n}} مستشارين موثّقين أحلتهم) |
| refz.tier_progress | التقدّم نحو الشريحة التالية |
| refz.tier_next | {{needed}} مستشارين موثّقين آخرين للوصول إلى {{name}} ({{rate}} %) للمكافآت الجديدة. |
| refz.tier_top | أنت في أعلى شريحة. |
| refz.tier_table | نسبة المكافأة حسب عدد المستشارين الموثّقين الذين أحلتهم |
| refz.tier_col_tier | الشريحة |
| refz.tier_col_count | المستشارون الموثّقون المُحالون |
| refz.tier_col_rate | النسبة |
| refz.tier_rule | يُحتسب فقط المستشارون المُحالون الموثّقون وغير الموقوفين. تُحدَّد شريحتك عند إنشاء كل مكافأة جديدة؛ تنطبق النسبة الجديدة على المكافآت اللاحقة فقط ولا تتغيّر المكافآت المُنشأة سابقًا. إذا انخفض عددك تُحسب المكافآت اللاحقة بالنسبة الأدنى. |
| tour.c.refer | اجلب زملاءك واربحوا معًا: شارك رمزك؛ عندما يعمل زميل أحلته تحصل على {{rate}} % من أتعابه (ترتفع النسبة مع عدد المستشارين الموثّقين الذين أحلتهم) لمدة {{months}} شهرًا، تدفعها AI Support 360 ولا تُخصم منه أبدًا. يبدأ ذلك بعد أن يجتاز كلاكما المقابلة الذكية. |

## Security and fraud controls

See `docs/referral-security.md` (threat table, RPC review, open limits) and `docs/sql/referral.test.sql` (adversarial tests).

### Arabic strings (security)

| key | Arabic |
|---|---|
| refz.st_title | القواعد باختصار |
| refz.st_1 | تأتي المكافآت فقط من دفعات العملاء المحصّلة والدفعات المصروفة، وعلى بنود فواتير لا تقل عن {{min}}. |
| refz.st_2 | تبقى كل مكافأة قيد الانتظار لفترة مراجعة مدتها {{days}} يومًا لتغطية الاسترداد والاعتراض على الدفع. |
| refz.st_3 | يؤدي الاسترداد والاعتراض على الدفع إلى عكس المكافأة، وتُعلَّق النزاعات والمكافآت التي تتجاوز الحدود الشهرية للمراجعة. |
| refz.st_4 | لا يُسمح بإحالة النفس أو الحسابات المرتبطة أو الوهمية أو العمل لعميل مرتبط. وفي حالات الاحتيال يجوز لـ AI Support 360 تعليق المكافآت أو عكسها أو إلغاؤها أو إسقاطها وإزالة الإحالة. |
| refz.st_5 | المكافآت حافز إحالة تدفعه AI Support 360، وليست أجرًا أو راتبًا، وقد تخضع للضريبة. |
| refz.st_full | اقرأ شروط برنامج الإحالة كاملة |
| refz.calc_engagement | التكليف |

## Programme rules hub (Refer & earn)

Sticky scroll-spy navigation, seven sections, live prerequisites, tier ladder, payment timeline, rules and a simulator (`src/lib/referralRules.ts`, unit tested). Every number comes from `my_referral_overview().settings`; administrators add plain-text notes per section (`rules_texts`, no `<` or `>`, 600 characters, EN/AR).

### Arabic strings (rules hub)

| key | Arabic |
|---|---|
| refr.title | قواعد البرنامج |
| refr.version | إصدار الشروط {{v}} بتاريخ {{date}} |
| refr.pdf | تنزيل القواعد (PDF) |
| refr.full_terms | اقرأ الشروط كاملة |
| refr.nav | أقسام قواعد البرنامج |
| refr.learn_more | اعرف المزيد |
| refr.list_sep | ،  |
| refr.s_overview | نظرة عامة |
| refr.s_prereq | المتطلبات |
| refr.s_earn | كيف تربح |
| refr.s_rates | النسب |
| refr.s_payment | الدفع |
| refr.s_rules | القواعد والعدالة |
| refr.s_sim | المحاكي |
| refr.promise | أحِل مستشاري SAP الذين تثق بهم - عندما يربحون تربح {{rate}} % من أتعابهم لمدة {{months}} شهرًا، تدفعها AI Support 360. |
| refr.journey | رحلتك |
| refr.j_share | شارك رمزك |
| refr.j_register | يسجّل زميلك |
| refr.j_activate | تجتازان المقابلة الذكية وتوافقان |
| refr.j_paid | يعمل زميلك ويدفع العميل |
| refr.j_earn | تربح |
| refr.ov_1 | أحِل مستشاري SAP الذين تعرفهم. عندما يعملون ويدفع العميل، تدفع لك AI Support 360 نسبة {{rate}} % من أتعابهم لمدة {{months}} شهرًا. |
| refr.ov_2 | لا يكلّف زميلك شيئًا: تأتي المكافأة من رسوم المنصة نفسها، وليس من دفعته أو من سعر العميل. |
| refr.ov_3 | تصبح الإحالة نشطة عندما تجتازان كلاكما المقابلة الذكية (بدرجة {{pass}} على الأقل) وتوافقان على الشروط خلال {{days}} يومًا من تسجيله. |
| refr.ov_more | لا تُحتسب المكافأة إلا عن العمل المفوتر بعد تفعيل الإحالة. وإذا لم تُفعَّل في الوقت المحدد تنتهي، ولا يعيدها إلا مسؤول. |
| refr.pre_1 | أنت: ملف مُرسل، واجتياز المقابلة الذكية (بدرجة {{pass}} على الأقل)، والموافقة على شروط البرنامج، وحساب موثّق، والموافقة على سياسة خدمة المستشارين. |
| refr.pre_2 | يحتاج زميلك إلى الشيء نفسه تمامًا: ملف مُرسل، واجتياز المقابلة الذكية (بدرجة {{pass}} على الأقل)، والموافقة على الشروط، وحساب موثّق، والموافقة على السياسة. |
| refr.pre_3 | البيانات البنكية مطلوبة لاستلام الدفعات، وليست شرطًا لمشاركة رمزك. |
| refr.pre_more | يجب إجراء المقابلة الذكية بأمانة وبمفردك ودون أي مساعدة خارجية. وإذا كانت الدرجة منخفضة يمكنك إعادتها وفق قواعد المقابلات المعتادة. |
| refr.state_active | برنامجك نشط |
| refr.state_locked | برنامجك مقفل - بقيت {{count}} خطوات |
| refr.state_suspended | حسابك موقوف - البرنامج مقفل. |
| refr.st_done | مكتمل |
| refr.st_todo | مطلوب |
| refr.st_locked | مقفل |
| refr.c_done | مكتمل |
| refr.c_optional | لاستلام الدفعات |
| refr.c_profile | إرسال الملف |
| refr.c_profile_todo | أكمل ملفك وأرسله. |
| refr.c_profile_btn | افتح الملف |
| refr.c_interview | اجتياز المقابلة الذكية |
| refr.c_interview_done | تم الاجتياز (درجة النجاح {{pass}}). |
| refr.c_interview_score | أفضل درجة {{score}} من {{pass}} المطلوبة. |
| refr.c_interview_none | احصل على {{pass}} على الأقل للمشاركة. |
| refr.c_interview_btn | ابدأ المقابلة الذكية |
| refr.c_terms | الموافقة على شروط البرنامج |
| refr.c_terms_done | تمت الموافقة (الإصدار {{v}}). |
| refr.c_terms_todo | اقرأ الشروط ووافق عليها. |
| refr.c_terms_locked | تُفتح بعد اجتياز المقابلة الذكية. |
| refr.c_terms_btn | الموافقة على الشروط |
| refr.c_verified | حساب مستشار موثّق |
| refr.c_verified_todo | بانتظار التوثيق من فريقنا. |
| refr.c_policy | الموافقة على سياسة خدمة المستشارين |
| refr.c_policy_todo | وافق على السياسة الحالية. |
| refr.c_policy_btn | افتح السياسة |
| refr.c_payout | إضافة بيانات الدفع |
| refr.c_payout_todo | مطلوبة لاستلام الدفعات، وليست شرطًا للمشاركة. |
| refr.c_payout_btn | أضف البيانات البنكية |
| refr.formula | {{rate}} % من أتعاب المستشار عن كل يوم عمل: الأتعاب = السعر المعتمد بالساعة × الساعات المعتمدة؛ يوم العمل = {{h}} ساعات. |
| refr.earn_1 | المكافأة = نسبة شريحتك × أتعاب المستشار. الأتعاب = السعر المعتمد بالساعة × الساعات المعتمدة؛ يوم العمل = {{h}} ساعات. |
| refr.earn_2 | مثال بنسبتك ({{rate}} %): أتعاب بقيمة {{fee}} تمنحك {{reward}}. |
| refr.earn_3 | تدفعها AI Support 360 - لا تُخصم أبدًا من زميلك ولا تُضاف إلى سعر العميل. |
| refr.earn_4 | تُنشأ المكافأة فقط بعد أن يدفع العميل وتُصرف دفعة زميلك؛ وبنود الفواتير الأقل من {{min}} لا تمنح مكافأة. |
| refr.earn_5 | {{months}} شهرًا لكل مستشار مُحال، تبدأ من أول تذكرة مدفوعة له. |
| refr.earn_6 | يؤدي الاسترداد والاعتراض على الدفع إلى عكس المكافأة بالنسبة التي أُنشئت بها. |
| refr.earn_more | لا تُحتسب أبدًا على ضريبة القيمة المضافة أو رسوم خدمة المنصة أو رسوم الدفع أو على عملك أنت. |
| refr.rate_row | {{name}}: {{range}} مستشارين مُحالين - {{rate}} % |
| refr.rate_count_paid | يُحتسب: المستشارون المُحالون الموثّقون الذين لديهم تذكرة مدفوعة واحدة على الأقل خلال {{days}} يومًا من التوثيق وغير الموقوفين. |
| refr.rate_count | يُحتسب: المستشارون المُحالون الموثّقون وغير الموقوفين. |
| refr.rate_future | تنطبق الشريحة الجديدة على المكافآت المُنشأة بعدها فقط - ولا تتغير المكافآت السابقة. |
| refr.rate_more | إذا انخفض عددك (مثلًا عند إيقاف مستشار مُحال)، تُحتسب المكافآت اللاحقة بالنسبة الأدنى. |
| refr.pay_1 | تبقى كل مكافأة قيد الانتظار {{days}} يومًا بعد الدفعة (للاسترداد والاعتراض على الدفع)، ثم تصبح متاحة. |
| refr.pay_2 | عند بلوغ {{min}} متاحة بالعملة نفسها، تُدفع مع دورة الدفعات المعتادة إلى بياناتك البنكية الموثّقة. |
| refr.pay_3 | تبقى المكافآت بعملة الفاتورة. |
| refr.pay_4 | بعد تغيير البيانات البنكية تنتظر دفعات الإحالة {{days}} أيام. |
| refr.pay_5 | تجدها في الأرباح وفي حسابات الإحالة. |
| refr.timeline | من المكافأة إلى الدفع |
| refr.t_created | إنشاء المكافأة |
| refr.t_hold | انتظار {{d}} يومًا |
| refr.t_available | متاحة |
| refr.t_min | الحد الأدنى {{v}} |
| refr.t_paid | تُدفع مع الدفعات المعتادة |
| refr.see_earnings | الأرباح |
| refr.rule_1 | لا إحالة للنفس: لا بحساب آخر أو بريد أو جهاز أو هاتف أو حساب بنكي أو شركة تخصك. |
| refr.rule_2 | مُحيل واحد لكل مستشار: أول رمز صالح هو المعتمد ولا يمكن تغييره. |
| refr.rule_3 | تُجرى المقابلة الذكية بأمانة وبمفردك ودون مساعدة خارجية. |
| refr.rule_caps | تُعلَّق المكافآت التي تتجاوز {{caps}} للمراجعة. |
| refr.cap_ref | {{v}} شهريًا لك |
| refr.cap_one | {{v}} شهريًا لكل مستشار مُحال |
| refr.cap_total | {{v}} إجمالًا لكل مستشار مُحال |
| refr.rule_4 | في حالات الاحتيال أو الاشتباه فيه قد تُعلَّق المكافآت أو تُعكس أو تُلغى أو تُسقط، وقد تُزال الإحالة. |
| refr.rule_5 | المكافآت حافز إحالة وليست أجرًا أو راتبًا، وأنت مسؤول عن الإقرار بها ضريبيًا. |
| refr.rule_terms | إصدار الشروط {{v}} بتاريخ {{date}}. |
| refr.rej_title | ما الذي يؤدي إلى رفض الإحالة |
| refr.rej_short | تُراجع الإحالات والمكافآت التي تظهر عليها مؤشرات احتيال أولًا، ولا يُدفع شيء حتى تتم تبرئتها. |
| refr.rej_1 | إحالة النفس أو حسابان لشخص واحد |
| refr.rej_2 | إحالة دائرية (أ يُحيل ب الذي يُحيل أ) |
| refr.rej_3 | حسابات وهمية أو مكررة |
| refr.rej_4 | تذاكر صغيرة أو وهمية لعميل مرتبط أو متواطئ |
| refr.rej_5 | حساب بنكي أو هاتف أو جهاز مشترك |
| refr.rej_6 | مقابلة ذكية غير أمينة |
| refr.sim_intro | جرّب أرقامك. تُختار الشريحة تلقائيًا من عدد الإحالات. لا يُحفظ شيء. |
| refr.sim_banner | للتوضيح فقط - ليس وعدًا أو ضمانًا؛ تعتمد المكافآت الفعلية على العمل المعتمد والمدفوع والمراجعات وفترات الانتظار. |
| refr.sim_in_n | المستشارون المُحالون (موثّقون ويعملون بأجر) |
| refr.sim_in_d | متوسط أيام العمل لكل مستشار شهريًا |
| refr.sim_in_h | متوسط السعر بالساعة |
| refr.sim_in_h_hint | أدخل سعرًا بالساعة لرؤية المبالغ. |
| refr.sim_in_m | عدد الأشهر في الفترة |
| refr.sim_in_hours | ساعات يوم العمل: {{h}} (ثابتة). |
| refr.sim_in_ramp | انضمام تدريجي: ينضم الزملاء تدريجيًا |
| refr.sim_real | استخدم أرقامي الفعلية |
| refr.sim_reset | إعادة الضبط |
| refr.sim_real_failed | تعذّر تحميل أرقام إحالاتك. |
| refr.sim_real_done | تمت التعبئة بإحالاتك الفعلية: {{n}} يعملون بأجر، و{{d}} يوم عمل شهريًا في المتوسط. |
| refr.sim_tier | {{name}}: تُطبَّق {{rate}} % |
| refr.sim_out_month | المكافأة الشهرية |
| refr.sim_out_window | مكافأة {{m}} شهرًا |
| refr.sim_out_per | لكل إحالة (طوال الفترة) |
| refr.sim_out_fee | إجمالي قاعدة الأتعاب |
| refr.sim_next | تحتاج {{n}} إحالات إضافية للوصول إلى {{name}} ({{rate}} %). مع {{min}} إحالة ستربح {{monthly}} شهريًا - منها {{extra}} بفضل النسبة الأعلى. |
| refr.sim_top | هذه أعلى شريحة. |
| refr.sim_chart | المكافأة التراكمية حسب الشهر، حتى {{v}} |
| refr.sim_month | الشهر |
| refr.sim_cum | التراكمي |
| refr.sim_n_min | كل بند فاتورة هنا أقل من الحد الأدنى {{v}} ولن يمنح مكافأة. |
| refr.sim_n_cap | فوق {{v}} شهريًا تُعلَّق المكافأة للمراجعة ولا تُدفع تلقائيًا. |
| refr.sim_n_cap_one | فوق {{v}} شهريًا لكل مستشار مُحال تُعلَّق المكافأة للمراجعة. |
| refr.sim_n_max | فوق {{v}} إجمالًا لكل مستشار مُحال تُعلَّق المكافأة للمراجعة. |
| refr.sim_assume | الافتراضات |
| refr.sim_a1 | الأتعاب لكل مستشار شهريًا = {{d}} يوم عمل × {{h}} ساعات × {{rate}} = {{fee}}. |
| refr.sim_a2 | كل مستشار مُحال موثّق ونشط ويُدفع له كل شهر؛ بند فاتورة واحد شهريًا. |
| refr.sim_a3 | يعمل جميع الزملاء من الشهر الأول. |
| refr.sim_a3r | انضمام تدريجي: ينضم الزملاء بالتساوي على مدى الأشهر، وتتبع الشريحة عدد النشطين في ذلك الشهر. |
| refr.sim_a4 | تبقى المكافآت قيد الانتظار طوال فترة الانتظار قبل أن تصبح متاحة؛ ولا يشمل ذلك الاسترداد والمراجعات والحدود. |
| refr.pdf_disclaimer | مسودة للمراجعة القانونية. تسري الشروط الكاملة المنشورة على aisupport360.com/referral-terms. |
| refz.tier_rule | يُحتسب فقط المستشارون المُحالون الموثّقون الذين لديهم تذكرة مدفوعة واحدة على الأقل وغير الموقوفين. تُحدَّد شريحتك عند إنشاء كل مكافأة جديدة؛ تنطبق النسبة الجديدة على المكافآت اللاحقة فقط ولا تتغيّر المكافآت المُنشأة سابقًا. إذا انخفض عددك تُحسب المكافآت اللاحقة بالنسبة الأدنى. |
| refr.adm_title | ملاحظات أقسام قواعد البرنامج (نص عادي) |

## Refer & earn page upgrade

- Menu: "Refer & earn" is a gradient pill (violet to teal, `--refer-*` tokens) with an "Earn" badge in the header tabs and the first sidebar group (also the phone menu). It pulses (motion-safe) for 14 days or until the page is opened; a dot shows a new reward since the last visit or referrals still waiting (`my_referral_nav_state`).
- Page tabs: Overview (journey with own counts + one next step, code card, how the reward is calculated, badges), Programme & policy (rules hub with 15 numbered policy cards, terms version/date, "accept again"), My referrals (plain status per referral incl. Rejected with a plain reason and Expired), Earnings & payouts (6 summary cards, month comparison, tier progress, monthly bars + running total, reward lines with filters/sort/search/pages/CSV, payouts and history with reference numbers, notification settings link), Referral calculations (unchanged; the duplicate estimate box was removed in favour of the simulator).
- Ticket titles are not shown (privacy rule A7): lines show `Engagement #XXXX`, approved hours and the fee, never the colleague's hourly rate.
- Not sent yet: notices for "reward released", "paid", "reversed" and "referral rejected" (existing notices: sign-up, verified, active, expired, first reward).
- SQL: `docs/sql/referral-tracking.sql` (after referral-program.sql), checks `docs/sql/referral-tracking.test.sql`. Until applied, the Earnings tab uses the older history rows and says detailed lines come soon.

### Arabic strings (namespace `reft`, plus `sidebar.earn_badge`, `sidebar.new_activity`, `refr.s_policy`)

| Key | Arabic |
|---|---|
| `reft.p_join` | من يمكنه الانضمام |
| `reft.p_join_1` | الاستشاريون الموثَّقون الذين اجتازوا مقابلة الذكاء الاصطناعي (بدرجة {{pass}} على الأقل) ووافقوا على شروط البرنامج. |
| `reft.p_join_2` | يجب ألا يكون حسابك موقوفًا، ويجب قبول سياسة خدمة الاستشاريين. |
| `reft.p_code` | كيف يعمل رمزك |
| `reft.p_code_1` | شارك رمزك الشخصي أو رابطك. يُستخدم فقط عند تسجيل زميلك. |
| `reft.p_code_2` | أول رمز صالح هو المعتمد ولا يُستبدل أبدًا. يُحفَظ الرابط 30 يومًا على الجهاز الذي فتحه. |
| `reft.p_code_3` | يمكنك تغيير رمزك مرة واحدة، وتبقى الروابط القديمة صالحة. |
| `reft.p_counts` | متى تُحتسب الإحالة |
| `reft.p_counts_1` | يسجّل زميلك برمزك ويجتاز مقابلة الذكاء الاصطناعي (بدرجة {{pass}} على الأقل). |
| `reft.p_counts_2` | توافقان كلاكما على شروط البرنامج خلال {{days}} يومًا من تسجيله، وإلا تنتهي الإحالة. |
| `reft.p_counts_3` | لا يُكافأ إلا العمل الذي يُفوتَر بعد تفعيل الإحالة. |
| `reft.p_earn` | ما الذي تكسبه |
| `reft.p_earn_1` | {{rate}} % (حسب مستواك) من الأتعاب المعتمدة للاستشاري المُحال، لمدة {{months}} شهرًا من أول تذكرة مدفوعة له. |
| `reft.p_earn_2` | الأتعاب = الساعات المعتمدة × السعر المعتمد للساعة. تدفع AI Support 360 المكافأة من رسومها الخاصة؛ لا يُخصم شيء من زميلك ولا يُضاف شيء على العميل. |
| `reft.p_tiers` | المستويات |
| `reft.p_tiers_1` | يُطبَّق المستوى الجديد فقط على المكافآت التي تُنشأ بعد ذلك. |
| `reft.p_reversals` | الاسترداد والنزاعات |
| `reft.p_rev_1` | يؤدي الاسترداد أو رد المبلغ إلى عكس المكافأة بالنسبة نفسها التي أُنشئت بها. |
| `reft.p_rev_2` | أثناء نزاع العميل على دفعة، تُعلَّق المكافأة، وتُفرَج إذا ثبتت الدفعة. |
| `reft.p_rev_3` | المكافأة المعكوسة التي دُفعت سابقًا تُخصم من المكافآت اللاحقة. |
| `reft.p_hold` | فترة الانتظار وموعد الدفع |
| `reft.p_hold_1` | تُنشأ المكافأة بعد أن يدفع العميل ويُصرف مستحق زميلك. |
| `reft.p_hold_2` | تبقى قيد الانتظار {{days}} يومًا، ثم تصبح متاحة وتُدفع مع دورة الدفع العادية. |
| `reft.p_hold_3` | بعد تغيير بياناتك المصرفية، تنتظر دفعات الإحالة {{days}} يومًا. |
| `reft.p_min` | الحد الأدنى للدفع |
| `reft.p_min_1` | تُدفع عندما يتوفر {{min}} على الأقل بعملة واحدة، إلى بياناتك المصرفية الموثَّقة. |
| `reft.p_min_2` | بنود الفواتير الأقل من {{v}} لا تُكسب مكافأة. |
| `reft.p_fraud` | قواعد الاحتيال - ما الذي يؤدي إلى رفض الإحالة |
| `reft.p_fraud_1` | تُراجَع الإحالات التي تظهر فيها مؤشرات كهذه أولًا ولا تُكسب شيئًا حتى تُعتمد. الاحتيال يعني المصادرة والعكس. |
| `reft.p_self` | لا إحالة ذاتية ولا حسابات مكررة |
| `reft.p_self_1` | لا يمكنك إحالة نفسك بحساب أو بريد أو هاتف أو جهاز أو حساب مصرفي أو شركة أخرى تخصك. |
| `reft.p_self_2` | شخص واحد، حساب واحد. تُغلق الحسابات المكررة وتُلغى مكافآتها. |
| `reft.p_susp` | إذا أُوقف أحد الحسابين |
| `reft.p_susp_1` | إذا أُوقف حسابك، لا تُنشأ مكافآت جديدة طوال فترة الإيقاف، وقد تُعلَّق المكافآت الحالية للمراجعة. |
| `reft.p_susp_2` | إذا أُوقف حساب زميلك، يتوقف احتسابه في مستواك، ولا تأتي مكافآت من عمل لم يُدفع له. |
| `reft.p_tax` | الضرائب |
| `reft.p_changes` | تغيير الشروط |
| `reft.p_changes_1` | يجوز لـ AI Support 360 تغيير البرنامج أو إنهاؤه للمكافآت المستقبلية مع إشعار مسبق. يجب قبول كل إصدار جديد من الشروط من جديد. |
| `reft.p_dispute` | كيف تعترض على إحالة |
| `reft.p_dispute_1` | إذا رأيت أن قرار إحالة أو مكافأة غير صحيح، راسل {{email}} مع الاسم الظاهر هنا ورقم البند أو الدفعة (L-… أو RP-…). |
| `reft.p_dispute_2` | يراجعه أحد المشرفين ويرد عليك كتابيًا. |
| `reft.p_contact` | التواصل |
| `reft.p_contact_1` | للأسئلة عن البرنامج: {{email}}. |
| `reft.terms_version` | الشروط - الإصدار {{v}}، آخر تحديث {{date}} |
| `reft.draft_legal` | مسودة بانتظار المراجعة القانونية |
| `reft.accepted_on` | وافقت على الإصدار {{v}} بتاريخ {{date}}. |
| `reft.accepted` | وافقت على الإصدار {{v}}. |
| `reft.accepted_old` | وافقت على الإصدار {{old}}{{when}}. الإصدار {{v}} جديد - يُرجى قراءته والموافقة عليه مجددًا. |
| `reft.not_accepted` | لم توافق على شروط البرنامج بعد. |
| `reft.reaccept` | الموافقة على الإصدار الجديد |
| `reft.j_share` | شارك رمزك |
| `reft.j_share_n` | زيارات للرابط |
| `reft.j_register` | تسجيل الزميل |
| `reft.j_register_n` | مسجَّلون |
| `reft.j_interview` | اجتياز مقابلة الذكاء الاصطناعي |
| `reft.j_interview_n` | اجتازوا المقابلة |
| `reft.j_paid` | أول تذكرة مدفوعة |
| `reft.j_paid_n` | بدأت تذاكرهم المدفوعة |
| `reft.j_earn` | أنت تكسب |
| `reft.j_earn_n` | يُدِرّون مكافآت |
| `reft.na_support` | تواصل مع الدعم بشأن حسابك |
| `reft.na_profile` | أكمل ملفك الشخصي وأرسله |
| `reft.na_interview` | ابدأ مقابلة الذكاء الاصطناعي |
| `reft.na_terms` | وافق على شروط البرنامج |
| `reft.na_policy` | وافق على سياسة خدمة الاستشاريين |
| `reft.na_verify` | تحقق من حالة التوثيق |
| `reft.na_share` | شارك رمزك مع زميل |
| `reft.na_follow` | اطّلع على ما تبقى على زملائك |
| `reft.na_payout` | أضف بياناتك المصرفية لتحصل على المبالغ |
| `reft.na_earnings` | اطّلع على مكافآتك المتاحة |
| `reft.na_verify_hint` | يوثّق فريقنا ملفك؛ تُفتح المشاركة فور الانتهاء. |
| `reft.na_follow_hint` | {{n}} إحالة بانتظار مقابلة الذكاء الاصطناعي أو الموافقة على الشروط. |
| `reft.journey_title` | رحلة الإحالة الخاصة بك |
| `reft.next` | خطوتك التالية |
| `reft.journey_note` | تُحصى زيارات الرابط دون حفظ أي شيء عن الزائر. لا تُتتبَّع الدعوات لكل شخص. |
| `reft.rej_account` | أُغلق الحساب أو أُوقف. |
| `reft.rej_review` | لم تجتز مراجعة الاحتيال لدينا (انظر «قواعد الاحتيال» في سياسة البرنامج). |
| `reft.rej_rules` | لم تستوفِ قواعد البرنامج. |
| `reft.list_empty` | لم يسجّل أحد برمزك بعد. شاركه من تبويب «نظرة عامة» - يظهر زملاؤك هنا فور تسجيلهم. |
| `reft.signed_up_on` | سجّل في {{date}} |
| `reft.window_until` | المكافآت حتى {{date}} |
| `reft.expired_hint` | لم تُفعَّل في الوقت المحدد. لا يمكن إعادة تفعيلها إلا من قِبل مشرف. |
| `reft.review_hint` | يراجع فريقنا هذه الإحالة. لا يُدفع شيء حتى تُعتمد. |
| `reft.rejected_on` | سجّل في {{a}} · القرار في {{b}} |
| `reft.calc_title` | كيف تُحتسب مكافأتك |
| `reft.calc_formula` | المكافأة = الساعات المعتمدة × السعر المعتمد للساعة (= الأتعاب) × نسبة مستواك ({{rate}} %). |
| `reft.calc_step1` | 1. يوم عمل واحد = {{h}} ساعات معتمدة بسعر {{hourly}} للساعة |
| `reft.calc_step2` | 2. الأتعاب = {{h}} × {{hourly}} = {{fee}} |
| `reft.calc_step3` | 3. مكافأتك = {{fee}} × {{rate}} % = {{reward}} |
| `reft.calc_basis_own` | يستخدم المثال سعرك المعتمد للساعة؛ السعر الحقيقي لزميلك هو ما يحدد الأتعاب الفعلية. |
| `reft.calc_basis_platform` | يستخدم المثال متوسط سعر الساعة على المنصة. |
| `reft.calc_basis_example` | سعر توضيحي فقط. |
| `reft.calc_paid_by` | تدفعها AI Support 360، ولا تُخصم أبدًا من زميلك. |
| `reft.calc_try` | جرّب أرقامك في المحاكي |
| `reft.until` | متاحة في {{date}} |
| `reft.fee` | الأتعاب |
| `reft.hours_n` | {{n}} ساعة معتمدة |
| `reft.sort_by` | ترتيب حسب {{col}} |
| `reft.next_release` | أقرب إتاحة {{date}} |
| `reft.pending_hint` | بانتظار انتهاء فترة الانتظار |
| `reft.held` | معلّقة |
| `reft.held_hint` | تُفرَج بعد المراجعة أو عند انتهاء النزاع |
| `reft.reversed` | معكوسة |
| `reft.reversed_hint` | الاسترداد ورد المبالغ والتصحيحات |
| `reft.basic_mode` | ستظهر هنا قريبًا البنود المفصلة (الساعات والأرقام المرجعية وتواريخ الإتاحة). الإجماليات أدناه صحيحة بالفعل. |
| `reft.other_cur` | عملات أخرى |
| `reft.month_vs` | هذا الشهر مقارنة بالشهر الماضي |
| `reft.month_none` | لا يوجد ما يُقارن بعد |
| `reft.month_change` | {{sign}}{{n}} % مقارنة بالشهر الماضي |
| `reft.tier_now` | المستوى الحالي |
| `reft.chart` | المكافآت لكل شهر والإجمالي التراكمي |
| `reft.chart_aria` | رسم بياني بالأعمدة لصافي المكافآت لكل شهر مع خط للإجمالي التراكمي |
| `reft.s_month` | الصافي لكل شهر |
| `reft.s_total` | الإجمالي التراكمي |
| `reft.month` | الشهر |
| `reft.lines` | بنود المكافآت |
| `reft.search` | بحث |
| `reft.search_ph` | الاسم أو الرقم المرجعي |
| `reft.csv` | CSV ({{n}} صف) |
| `reft.lines_empty` | لا توجد مكافآت بعد. تظهر المكافأة عندما يُدفع لزميل أحلته مقابل عمل معتمد بعد تفعيل الإحالة. |
| `reft.lines_none` | لا توجد بنود تطابق هذه المرشحات. |
| `reft.payout_col` | الدفعة |
| `reft.pages` | الصفحات |
| `reft.page_of` | الصفحة {{p}} من {{n}} · {{total}} بندًا |
| `reft.prev` | السابق |
| `reft.next_page` | التالي |
| `reft.privacy` | حفاظًا على الخصوصية ترى أتعاب كل بند فقط، ولا ترى أبدًا سعر ساعة زميلك أو العميل أو التذكرة. يبقى «Engagement #» ثابتًا للعمل نفسه. |
| `reft.payouts` | الدفعات |
| `reft.next_run` | مع دورة الدفع القادمة |
| `reft.avail_now` | المتاح الآن |
| `reft.min_payout` | الحد الأدنى للدفع |
| `reft.method` | طريقة الدفع |
| `reft.method_ok` | أُضيفت البيانات المصرفية |
| `reft.method_missing` | البيانات المصرفية غير مضافة |
| `reft.method_view` | عرض بيانات الدفع |
| `reft.payout_history` | سجل الدفعات |
| `reft.payouts_soon` | سيظهر سجل دفعات الإحالة هنا قريبًا. المبالغ المدفوعة مشمولة بالفعل في الإجماليات أعلاه. |
| `reft.payouts_empty` | لا توجد دفعات إحالة بعد. تتم أول دفعة عندما تبلغ مكافآتك المتاحة الحد الأدنى. |
| `reft.ref_no` | الرقم المرجعي |
| `reft.amount` | المبلغ |
| `reft.paid_on` | تاريخ الدفع |
| `reft.notices` | يصلك إشعار عند تسجيل زميل وعند توثيقه، وعند تفعيل الإحالة أو انتهائها، وعند أول مكافأة. |
| `reft.notice_settings` | إعدادات الإشعارات |
| `reft.tab_programme` | البرنامج والسياسة |
| `reft.tab_referrals` | إحالاتي |
| `reft.tab_earnings` | الأرباح والدفعات |
| `reft.see_earnings` | عرض الأرباح والدفعات |
| `reft.chip_registered` | مسجَّل |
| `reft.chip_interview_pending` | المقابلة قيد الانتظار |
| `reft.chip_active` | نشطة |
| `reft.chip_earning` | تُدِرّ مكافآت |
| `reft.chip_ended` | انتهت المدة |
| `reft.chip_on_review` | قيد المراجعة |
| `reft.chip_expired` | منتهية |
| `reft.chip_rejected` | مرفوضة |
| `reft.hold_review` | قيد المراجعة |
| `reft.hold_dispute` | نزاع من العميل |
| `reft.hold_cap` | فوق الحد الشهري |
| `reft.period_all` | كل الفترات |
| `reft.period_month` | هذا الشهر |
| `reft.period_last_month` | الشهر الماضي |
| `reft.period_3m` | آخر 3 أشهر |
| `reft.period_year` | هذا العام |
| `reft.fs_all` | كل الحالات |
| `reft.fs_pending` | قيد الانتظار |
| `reft.fs_held` | معلّقة |
| `reft.fs_available` | متاحة |
| `reft.fs_paid` | مدفوعة |
| `reft.fs_reversed` | معكوسة |
| `reft.po_pending` | مجدولة |
| `reft.po_processing` | قيد المعالجة |
| `reft.po_completed` | مدفوعة |
| `reft.po_failed` | فشلت |
| `sidebar.new_activity` | نشاط جديد |
| `sidebar.earn_badge` | اربح |
| `refr.s_policy` | سياسة البرنامج |
