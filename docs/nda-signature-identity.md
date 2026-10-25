# Strict NDA signing with signer identity

Status: live since 2026-10-25 (applied as migration 0108, byte-identical to `docs/sql/nda-signature-identity.sql`; secret `NDA_ID_ENCRYPTION_KEY` set; app published).

## How signing works today (inventory)

- `nda_agreements`: one active row per consultant–client pair (partial unique index). The consultant signs first by inserting the row (`signature_data` drawn or typed, `signer` name inside the content, `signed_at`); the client countersigns with the SECURITY DEFINER `client_sign_nda` (migration 0020: `client_signature_data/type`, `client_signer_name`, `client_signed_at`). `revoked_at/revoked_by` end it; 0021 adds `client_profiles.use_custom_nda`.
- Template v2 (16 clauses) or the client's own NDA (PDF in the private `nda-documents` bucket, 10 MB) is the content; the PDF was built in the browser (`ndaPdfExport.ts`).
- Who sees what: admins all; clients their own rows (and may revoke); consultants their own rows; insert only by a verified consultant related to the client.
- Triggers: audit log, `notify_nda_signed` (client in-app notice), `sla_touch` (signed_at / client_signed_at / revoked_at), insert + revocation guards, revoke notice, `team_sync_nda`.
- Gates that read it: `has_active_nda` (both signed, not revoked) for remote access, team engagement, BRD (`brd_role_for`), support agreements (`sa_member_nda_ok`), SLA snapshots via `sla_touch`. **None of these change**: they still read `signed_at` / `client_signed_at` / `revoked_at` only.
- Gap: no ID, no authorisation tick, typed signatures always allowed, no evidence hashes, no reminders, no e-mail when the consultant signs.

## What the new file adds

- `nda_signatures` (append-only evidence per party and NDA: method, printed name, job title/company for clients, ID type/country/**masked** number, SHA-256 of the NDA text and of the PNG, image path/size, stroke metrics, user-agent hash, IP only if the admin setting is on, server time). Kind `signature` or `supplement` (details added later to a legacy signature, original signing time kept).
- `nda_signatory_identity` (separate; encrypted number `id_cipher`, masked form). RLS: signer + admins only; the `id_cipher` column is not granted to anyone in the browser.
- `nda_identity_access_log` (append-only: who read a full number, when, why) and `nda_signature_events` (sign, supplement, remind, download, admin read, settings, erase).
- RPCs (fixed `search_path`): `nda_sign_record` (service only, called by the `nda-signature` function with the verified user id; one signature per party per NDA, idempotent, rate limited, all checks again in SQL), `nda_signature_status`, `nda_signing_settings`, `nda_reminder_record` (1 per 24 h), `nda_log_download`, `nda_identity_cipher_for` (logs first), `nda_admin_signatures`, `nda_admin_access_log`, `nda_admin_set_signing_settings`, `nda_identity_retention_sweep`, `nda_identity_erase_user`.
- The legacy `client_sign_nda` is withdrawn from the browser and the consultant insert policy is replaced, so nobody can sign without the new checks; admins cannot sign for users; a person can never sign on both sides.

## Secret

`NDA_ID_ENCRYPTION_KEY` — a random value of at least 32 characters, added as a backend secret (never pasted in chat). Without it signing refuses with "being set up". The key encrypts with AES-256-GCM (key derived per signer with HKDF); rotating it makes older numbers unreadable, so keep it.

## Settings and defaults (`platform_settings` key `nda_signature`, Admin › NDA › NDA signatures)

| Setting | Default |
|---|---|
| `allow_typed_signature` (`nda_allow_typed_signature`) | OFF |
| `store_ip` | OFF (privacy trade-off: IP helps prove origin but is extra personal data) |
| `id_retention_years` (after the NDA is revoked/ends; 1–30) | 5 |
| `reminder_hours` (never below 24) | 24 |
| Signature: minimum on a 600 × 200 pad | 10 points, 150 px of ink, 60 px wide and 15 px tall (empty, dot and tiny signatures are refused) |
| PNG | real PNG only (magic bytes + IHDR), ≤ 300 KB, no SVG |

## Lawyer: privacy policy wording suggestion

> **Signer identification for NDAs.** When you sign a Non-Disclosure Agreement in the portal we collect your full legal name, your drawn signature and the type, issuing country and number of a national ID card or passport, to identify the person who signed. The ID number is stored encrypted and is visible only to you and to platform administrators, who must give a reason each time; every such view is logged and visible to you. The other party sees only your name and a masked number (first 2 and last 3 characters). We keep the ID number while the NDA is valid and for [5] years after it ends, then delete it; the signature evidence (name, masked number, fingerprints and times) is kept as legal evidence of the agreement. We do not store your IP address unless stated otherwise. Signatures in the portal are electronic signatures, not qualified electronic signatures.

## Test plan

- **Client signer:** open Contracts → an NDA signed by the consultant shows "Review and sign" (also on the ticket NDA box and the agreement team checklist). Sign stays disabled with inline messages until signature, two-word name, ID type/country/number, job title, company and both ticks are valid. After signing: "Fully signed" + download; PDF shows both signature images, printed names, masked IDs, hashes and the footer.
- **Consultant signer:** from a request, ticket, agreement crew or *NDA agreements* page, draw, enter name and passport → "You signed on …", "Waiting for the client", "Send a reminder" (second press within 24 h refused). Client receives in-app + e-mail "<name> signed the NDA, your signature is needed".
- **Other party:** sees name + masked ID only; the ID table and full number are not readable (SQL checks ND09, ND11).
- **Admin:** Admin › NDA → NDA signatures: masked list, "Show full ID" needs a reason, is logged and hides after 60 s; settings (typed signature, IP, retention, reminder hours) saved with a reason.
- **Legacy NDA:** shows "Signed (legacy signature, no ID collected)" and an optional "Add my signature details"; ticket access, BRD, team engagement, SLA and support-agreement gates keep treating it as signed (SQL check ND12); double submits are idempotent (ND06); reminders once per 24 h (ND13).
- Automated: `src/lib/ndaSignature.test.ts` (signature/ID/name/masking/PNG/state/encryption/PDF/e-mail), `src/test/ndaSigningScreens.test.tsx`, `docs/sql/nda-signature-identity.test.sql` (22 rolled-back checks).

## Limitations

- Electronic signature in the portal (drawn image + typed name + ID + tick + hashes), **not a qualified electronic signature**; no third-party e-signature provider.
- The ID number is checked for format and length only; it is not verified against a government register.
- In-app links to `/consultant/ndas` work once the front end is published; e-mails fall back to the consultant home page until the published site serves `/consultant-ndas-ready.json`.

## Arabic strings (ndaSign, 162 keys)

| Key | English | Arabic |
|---|---|---|
| `ndaSign.loading` | Loading… | جارٍ التحميل… |
| `ndaSign.signButton` | Sign NDA | توقيع الاتفاقية |
| `ndaSign.signing` | Signing… | جارٍ التوقيع… |
| `ndaSign.addDetailsButton` | Add my signature details | إضافة بيانات توقيعي |
| `ndaSign.notQualified` | Electronic signature in the AI Support 360 portal. It is not a qualified electronic signature. | توقيع إلكتروني في بوابة AI Support 360، وهو ليس توقيعًا إلكترونيًا مؤهلًا. |
| `ndaSign.stillNeeded` | Still needed before you can sign: {{items}} | ما زال مطلوبًا قبل التوقيع: {{items}} |
| `ndaSign.field.signature` | your drawn signature | توقيعك بخط اليد |
| `ndaSign.field.name` | full legal name | الاسم القانوني الكامل |
| `ndaSign.field.idType` | ID document type | نوع وثيقة الهوية |
| `ndaSign.field.country` | issuing country | دولة الإصدار |
| `ndaSign.field.idNumber` | ID number | رقم الوثيقة |
| `ndaSign.field.title` | job title | المسمى الوظيفي |
| `ndaSign.field.company` | company name | اسم الشركة |
| `ndaSign.field.authorised` | authorisation tick | تأكيد الصلاحية |
| `ndaSign.field.agreed` | agreement tick | تأكيد الموافقة |
| `ndaSign.f.signature` | Your signature | توقيعك |
| `ndaSign.f.draw` | Draw | رسم |
| `ndaSign.f.typeMine` | Type my signature | كتابة توقيعي |
| `ndaSign.f.padLabel` | Signature pad. Draw your signature with a mouse, finger or stylus. | لوحة التوقيع. ارسم توقيعك بالفأرة أو بإصبعك أو بالقلم. |
| `ndaSign.f.padHint` | Sign here | وقّع هنا |
| `ndaSign.f.clear` | Clear | مسح |
| `ndaSign.f.undo` | Undo | تراجع |
| `ndaSign.f.typedLabel` | Type your signature | اكتب توقيعك |
| `ndaSign.f.cannotDraw` | Can't draw a signature? Ask the platform administrator about a typed signature. | لا تستطيع رسم التوقيع؟ اسأل مسؤول المنصة عن التوقيع المكتوب. |
| `ndaSign.f.name` | Full legal name (as on your ID document) | الاسم القانوني الكامل (كما في وثيقة الهوية) |
| `ndaSign.f.nameFromProfile` | Filled in from your profile. Correct it if it differs from your ID document. | أُخذ من ملفك الشخصي. صحّحه إن كان مختلفًا عن وثيقة هويتك. |
| `ndaSign.f.nameHint` | At least two words, letters only. | كلمتان على الأقل، بالحروف فقط. |
| `ndaSign.f.idDoc` | ID document | وثيقة الهوية |
| `ndaSign.f.idType` | Document type | نوع الوثيقة |
| `ndaSign.f.country` | Issuing country | دولة الإصدار |
| `ndaSign.f.choose` | Choose… | اختر… |
| `ndaSign.f.idNumber` | Document number | رقم الوثيقة |
| `ndaSign.f.maskedPreview` | The other party will only see: {{masked}} | سيرى الطرف الآخر فقط: {{masked}} |
| `ndaSign.f.consent` | We collect this only to identify the signer of this NDA; see the | نجمع هذه البيانات فقط للتعرف على موقّع هذه الاتفاقية؛ راجع |
| `ndaSign.f.privacyLink` | Privacy Policy | سياسة الخصوصية |
| `ndaSign.f.jobTitle` | Your job title | مسماك الوظيفي |
| `ndaSign.f.company` | Company you sign for | الشركة التي توقّع عنها |
| `ndaSign.f.authorised` | I am authorised to sign this NDA and the details are true. | أنا مخوّل بتوقيع هذه الاتفاقية والبيانات صحيحة. |
| `ndaSign.f.authorisedClient` | I am authorised to sign this NDA on behalf of the company and the details are true. | أنا مخوّل بتوقيع هذه الاتفاقية نيابةً عن الشركة والبيانات صحيحة. |
| `ndaSign.f.agreed` | I have read and agree to the terms of this Non-Disclosure Agreement. | قرأت شروط اتفاقية عدم الإفصاح هذه وأوافق عليها. |
| `ndaSign.problem.signature_empty` | Draw your signature in the box. | ارسم توقيعك داخل المربع. |
| `ndaSign.problem.signature_too_short` | The signature is too short. Draw your full signature. | التوقيع قصير جدًا. ارسم توقيعك كاملًا. |
| `ndaSign.problem.signature_too_small` | The signature is too small. Use more of the box. | التوقيع صغير جدًا. استخدم مساحة أكبر من المربع. |
| `ndaSign.problem.signature_too_complex` | The signature is too long. Clear it and sign again. | التوقيع طويل جدًا. امسحه ووقّع من جديد. |
| `ndaSign.problem.typed_not_allowed` | Typed signatures are not allowed. Please draw your signature. | التوقيع المكتوب غير مسموح. يرجى رسم توقيعك. |
| `ndaSign.problem.typed_required` | Type your full name as your signature. | اكتب اسمك الكامل كتوقيع. |
| `ndaSign.problem.name_required` | Enter your full legal name. | أدخل اسمك القانوني الكامل. |
| `ndaSign.problem.name_too_long` | The name is too long. | الاسم طويل جدًا. |
| `ndaSign.problem.name_letters_only` | Use letters only (hyphens and apostrophes are fine). | استخدم الحروف فقط (الشرطة والفاصلة العليا مقبولتان). |
| `ndaSign.problem.name_two_words` | Enter at least your first and last name. | أدخل اسمك الأول واسم العائلة على الأقل. |
| `ndaSign.problem.id_type_required` | Choose National ID or Passport. | اختر الهوية الوطنية أو جواز السفر. |
| `ndaSign.problem.id_country_required` | Choose the issuing country. | اختر دولة الإصدار. |
| `ndaSign.problem.id_country_invalid` | Choose a country from the list. | اختر دولة من القائمة. |
| `ndaSign.problem.id_required` | Enter the document number. | أدخل رقم الوثيقة. |
| `ndaSign.problem.id_format` | Use letters and digits only. | استخدم الحروف والأرقام فقط. |
| `ndaSign.problem.id_length` | Passport numbers have 6–12 characters, national ID numbers 5–20. | رقم جواز السفر من 6 إلى 12 خانة، ورقم الهوية الوطنية من 5 إلى 20. |
| `ndaSign.problem.id_needs_digit` | The number must contain at least one digit. | يجب أن يحتوي الرقم على رقم واحد على الأقل. |
| `ndaSign.problem.id_repeated` | This does not look like a real document number. | لا يبدو هذا رقم وثيقة حقيقيًا. |
| `ndaSign.problem.title_required` | Enter your job title. | أدخل مسماك الوظيفي. |
| `ndaSign.problem.title_too_long` | The job title is too long. | المسمى الوظيفي طويل جدًا. |
| `ndaSign.problem.title_contact` | Contact details are not allowed here. | لا يُسمح ببيانات الاتصال هنا. |
| `ndaSign.problem.company_required` | Enter the company name. | أدخل اسم الشركة. |
| `ndaSign.problem.company_too_long` | The company name is too long. | اسم الشركة طويل جدًا. |
| `ndaSign.problem.company_contact` | Contact details are not allowed here. | لا يُسمح ببيانات الاتصال هنا. |
| `ndaSign.problem.not_authorised` | Confirm that you are authorised to sign. | أكّد أنك مخوّل بالتوقيع. |
| `ndaSign.problem.not_agreed` | Confirm that you agree to the NDA. | أكّد موافقتك على الاتفاقية. |
| `ndaSign.idType.national_id` | National ID | هوية وطنية |
| `ndaSign.idType.passport` | Passport | جواز سفر |
| `ndaSign.role.client` | client | العميل |
| `ndaSign.role.consultant` | consultant | الاستشاري |
| `ndaSign.toast.signed` | NDA signed. The other party has been told. | تم توقيع الاتفاقية وإبلاغ الطرف الآخر. |
| `ndaSign.toast.detailsAdded` | Your signature details were added. | تمت إضافة بيانات توقيعك. |
| `ndaSign.dialog.signTitle` | Review and sign the NDA | مراجعة الاتفاقية وتوقيعها |
| `ndaSign.dialog.signIntro` | Read the agreement, then sign it below. | اقرأ الاتفاقية ثم وقّعها بالأسفل. |
| `ndaSign.dialog.signIntroNamed` | {{name}} has signed. Read the agreement, then add your signature below. | وقّع {{name}}. اقرأ الاتفاقية ثم أضف توقيعك بالأسفل. |
| `ndaSign.dialog.supplementTitle` | Add my signature details | إضافة بيانات توقيعي |
| `ndaSign.dialog.supplementIntro` | Your NDA stays valid as it is. This adds a drawn signature and your ID details to the record; your original signing date does not change. | تبقى اتفاقيتك سارية كما هي. يضيف هذا توقيعًا بخط اليد وبيانات هويتك إلى السجل، ولا يتغير تاريخ توقيعك الأصلي. |
| `ndaSign.card.title` | Non-Disclosure Agreement | اتفاقية عدم الإفصاح |
| `ndaSign.card.yourTurn` | Your signature is needed | توقيعك مطلوب |
| `ndaSign.card.otherSigned` | {{name}} signed on {{date}}. Review the NDA and add your signature. | وقّع {{name}} في {{date}}. راجع الاتفاقية وأضف توقيعك. |
| `ndaSign.card.signFirst` | Sign the NDA to continue. The other party is told as soon as you sign. | وقّع الاتفاقية للمتابعة. يُبلَّغ الطرف الآخر فور توقيعك. |
| `ndaSign.card.reviewAndSign` | Review and sign | المراجعة والتوقيع |
| `ndaSign.card.youSigned` | You signed on {{date}} | وقّعت في {{date}} |
| `ndaSign.card.downloadMine` | View / download my signed NDA | عرض / تنزيل نسختي الموقعة |
| `ndaSign.card.waiting` | Waiting for the {{role}} to sign | بانتظار توقيع {{role}} |
| `ndaSign.card.waitingNamed` | Waiting for the {{role}} ({{name}}) to sign | بانتظار توقيع {{role}} ({{name}}) |
| `ndaSign.card.remind` | Send a reminder | إرسال تذكير |
| `ndaSign.card.reminderSent` | Reminder sent to the {{role}}. | تم إرسال التذكير إلى {{role}}. |
| `ndaSign.card.nextReminder` | You can send the next reminder after {{date}}. | يمكنك إرسال التذكير التالي بعد {{date}}. |
| `ndaSign.card.fully` | Fully signed | موقعة بالكامل |
| `ndaSign.card.downloadFull` | Download the fully signed NDA | تنزيل الاتفاقية الموقعة بالكامل |
| `ndaSign.card.revoked` | Revoked on {{date}} | أُلغيت في {{date}} |
| `ndaSign.card.signNew` | Sign a new NDA | توقيع اتفاقية جديدة |
| `ndaSign.card.legacy` | Signed (legacy signature, no ID collected) | موقّعة (توقيع سابق، دون بيانات هوية) |
| `ndaSign.card.addDetails` | Add my signature details | إضافة بيانات توقيعي |
| `ndaSign.card.detailsAddedLater` | details added later | أضيفت البيانات لاحقًا |
| `ndaSign.card.maskedId` | Masked ID | رقم الهوية المخفي جزئيًا |
| `ndaSign.card.notSigned` | Not signed yet | لم يوقّع بعد |
| `ndaSign.step.title` | Your NDA signature is the next step | توقيعك على اتفاقية عدم الإفصاح هو الخطوة التالية |
| `ndaSign.step.body` | Draw your signature, type your full legal name and add your ID document details. | ارسم توقيعك واكتب اسمك القانوني الكامل وأضف بيانات وثيقة الهوية. |
| `ndaSign.page.title` | NDA agreements | اتفاقيات عدم الإفصاح |
| `ndaSign.page.subtitle` | Your Non-Disclosure Agreements with clients: status, downloads and reminders. | اتفاقيات عدم الإفصاح مع العملاء: الحالة والتنزيلات والتذكيرات. |
| `ndaSign.page.empty` | You have not signed an NDA yet. | لم توقّع أي اتفاقية عدم إفصاح بعد. |
| `ndaSign.page.noProfile` | Your consultant profile was not found. | لم يتم العثور على ملفك كاستشاري. |
| `ndaSign.page.with` | NDA with {{name}} | اتفاقية مع {{name}} |
| `ndaSign.page.signedOn` | You signed on {{date}} | وقّعت في {{date}} |
| `ndaSign.page.revoked` | Revoked | ملغاة |
| `ndaSign.admin.notInstalled` | NDA signatures with ID details appear here once the prepared database update for strict NDA signing is applied. | تظهر هنا توقيعات اتفاقيات عدم الإفصاح مع بيانات الهوية بعد تطبيق تحديث قاعدة البيانات المُعدّ للتوقيع الصارم. |
| `ndaSign.admin.title` | NDA signatures | توقيعات اتفاقيات عدم الإفصاح |
| `ndaSign.admin.subtitle` | Who signed, with which document (masked), and when. Showing a full ID number needs a reason and is logged. | من وقّع، وبأي وثيقة (مخفية جزئيًا)، ومتى. عرض رقم الهوية كاملًا يتطلب سببًا ويُسجَّل. |
| `ndaSign.admin.search` | Search by consultant, client, company or signer… | ابحث بالاستشاري أو العميل أو الشركة أو الموقّع… |
| `ndaSign.admin.empty` | No NDAs found. | لا توجد اتفاقيات. |
| `ndaSign.admin.drawn` | drawn | بخط اليد |
| `ndaSign.admin.typed` | typed | مكتوب |
| `ndaSign.admin.anonymised` | ID removed | أُزيل الرقم |
| `ndaSign.admin.showFull` | Show full ID | عرض الرقم كاملًا |
| `ndaSign.admin.views` | Full ID viewed {{count}}× | عُرض الرقم كاملًا {{count}} مرة |
| `ndaSign.admin.settings` | NDA signing settings | إعدادات توقيع الاتفاقيات |
| `ndaSign.admin.allowTyped` | Allow a typed signature | السماح بالتوقيع المكتوب |
| `ndaSign.admin.allowTypedHint` | Off by default. When on, people who cannot draw may type their signature instead. | مغلق افتراضيًا. عند تشغيله يمكن لمن لا يستطيع الرسم أن يكتب توقيعه. |
| `ndaSign.admin.storeIp` | Store the signer's IP address | حفظ عنوان IP للموقّع |
| `ndaSign.admin.storeIpHint` | Off by default. An IP address helps prove where a signature came from, but it is extra personal data to protect and disclose in the privacy policy. | مغلق افتراضيًا. يساعد عنوان IP في إثبات مصدر التوقيع، لكنه بيانات شخصية إضافية يجب حمايتها وذكرها في سياسة الخصوصية. |
| `ndaSign.admin.retention` | Keep ID numbers for (years after the NDA ends) | مدة الاحتفاظ بأرقام الهوية (سنوات بعد انتهاء الاتفاقية) |
| `ndaSign.admin.retentionHint` | Afterwards the ID number is removed; name, masked ID, fingerprints and times stay as evidence. | بعدها يُزال رقم الهوية، ويبقى الاسم والرقم المخفي والبصمات والأوقات كدليل. |
| `ndaSign.admin.reminderHours` | Hours between reminders (at least 24) | الساعات بين التذكيرات (24 على الأقل) |
| `ndaSign.admin.reason` | Reason for the change | سبب التغيير |
| `ndaSign.admin.save` | Save settings | حفظ الإعدادات |
| `ndaSign.admin.saved` | Settings saved. | تم حفظ الإعدادات. |
| `ndaSign.admin.revealTitle` | Show the full ID number | عرض رقم الهوية كاملًا |
| `ndaSign.admin.revealIntro` | The full ID number of {{name}} is personal data. Your view is logged with your name, the time and your reason. | رقم هوية {{name}} الكامل بيانات شخصية. يُسجَّل عرضك مع اسمك والوقت والسبب. |
| `ndaSign.admin.revealReason` | Reason (at least 10 characters) | السبب (10 أحرف على الأقل) |
| `ndaSign.admin.revealLogged` | The signer can see who viewed their ID number and why. | يستطيع الموقّع رؤية من اطّلع على رقم هويته ولماذا. |
| `ndaSign.admin.revealHides` | Hidden again automatically after 60 seconds. | يُخفى تلقائيًا بعد 60 ثانية. |
| `ndaSign.admin.hide` | Hide | إخفاء |
| `ndaSign.admin.logTitle` | Full ID views | سجل عرض الرقم كاملًا |
| `ndaSign.admin.logEmpty` | Nobody has viewed the full ID number. | لم يطّلع أحد على الرقم كاملًا. |
| `ndaSign.admin.logRole.admin` | administrator | مسؤول |
| `ndaSign.admin.logRole.self` | the signer | الموقّع نفسه |
| `ndaSign.err.generic` | Something went wrong. Please try again. | حدث خطأ. يرجى المحاولة مرة أخرى. |
| `ndaSign.err.download` | The PDF could not be created. Please try again. | تعذر إنشاء ملف PDF. يرجى المحاولة مرة أخرى. |
| `ndaSign.err.nda_rate_limited` | Too many attempts. Please wait a while and try again. | محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة. |
| `ndaSign.err.nda_reminder_too_soon` | A reminder was sent recently. You can send one every 24 hours. | أُرسل تذكير مؤخرًا. يمكنك إرسال تذكير كل 24 ساعة. |
| `ndaSign.err.nda_not_your_party` | You can only sign for yourself as a party of this NDA. | يمكنك التوقيع عن نفسك فقط بصفتك طرفًا في هذه الاتفاقية. |
| `ndaSign.err.nda_no_relation` | You are not working with this client yet, so you cannot sign their NDA. | لا تعمل مع هذا العميل بعد، لذلك لا يمكنك توقيع اتفاقيته. |
| `ndaSign.err.nda_consultant_not_verified` | Your profile must be verified before you can sign an NDA. | يجب توثيق ملفك قبل توقيع اتفاقية عدم الإفصاح. |
| `ndaSign.err.nda_already_signed` | This NDA is already signed. Use "Add my signature details" instead. | هذه الاتفاقية موقعة بالفعل. استخدم "إضافة بيانات توقيعي" بدلًا من ذلك. |
| `ndaSign.err.nda_revoked` | This NDA was revoked and can no longer be signed. | أُلغيت هذه الاتفاقية ولا يمكن توقيعها. |
| `ndaSign.err.nda_signature_too_small` | The signature is too small or too short. Please sign again. | التوقيع صغير أو قصير جدًا. يرجى التوقيع من جديد. |
| `ndaSign.err.nda_signature_image_invalid` | The signature image could not be read. Clear the box and sign again. | تعذرت قراءة صورة التوقيع. امسح المربع ووقّع من جديد. |
| `ndaSign.err.nda_name_invalid` | Check your full legal name. | تحقق من اسمك القانوني الكامل. |
| `ndaSign.err.nda_id_invalid` | Check the ID document number. | تحقق من رقم وثيقة الهوية. |
| `ndaSign.err.nda_id_country_invalid` | Choose the issuing country from the list. | اختر دولة الإصدار من القائمة. |
| `ndaSign.err.nda_company_details_required` | Enter your job title and the company name. | أدخل مسماك الوظيفي واسم الشركة. |
| `ndaSign.err.nda_contact_details` | Contact details are not allowed in the job title or company name. | لا يُسمح ببيانات الاتصال في المسمى الوظيفي أو اسم الشركة. |
| `ndaSign.err.nda_typed_not_allowed` | Typed signatures are not allowed. Please draw your signature. | التوقيع المكتوب غير مسموح. يرجى رسم توقيعك. |
| `ndaSign.err.nda_id_key_missing` | Signing is being set up and is not available yet. Please try again later. | التوقيع قيد الإعداد وغير متاح بعد. يرجى المحاولة لاحقًا. |
| `ndaSign.err.nda_reason_required` | Give a reason of at least 10 characters. | اكتب سببًا من 10 أحرف على الأقل. |
| `ndaSign.err.nda_forbidden` | You are not allowed to do this. | غير مسموح لك بهذا الإجراء. |
| `ndaSign.err.nda_identity_anonymised` | This ID number was removed under the retention rules. | أُزيل رقم الهوية هذا وفق قواعد الاحتفاظ. |
| `ndaSign.err.nda_nothing_to_remind` | There is nothing to remind about: the signature is already there. | لا داعي للتذكير: التوقيع موجود بالفعل. |
| `ndaSign.err.nda_content_invalid` | The NDA text is missing. Please ask the platform administrator. | نص الاتفاقية غير موجود. يرجى مراجعة مسؤول المنصة. |
| `ndaSign.err.nda_invalid_input` | Some details are missing or invalid. Please check the form. | بعض البيانات ناقصة أو غير صحيحة. يرجى مراجعة النموذج. |
