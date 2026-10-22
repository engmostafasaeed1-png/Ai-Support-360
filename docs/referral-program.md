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
