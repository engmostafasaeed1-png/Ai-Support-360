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
| refz.badge | {{count}} إحالة موثّقة |
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
