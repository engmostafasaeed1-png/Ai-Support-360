# AI Interviewer Training: knowledge-based, profile-specific questions

Status: code deployed, database part **prepared, not applied** (`docs/sql/interview-knowledge.sql`, checks in
`docs/sql/interview-knowledge.test.sql`). Until it is applied **and** an administrator switches on
"Use knowledge base for interview questions" (Admin > AI Interviewer Training > Settings, OFF by default), every
interview behaves exactly as before.

## 1. Inventory (before this change)

- **Live interview** = edge function `ai-interview-chat` (called by `AIInterviewFlow`; copilot for human interviews by
  `LiveInterviewPage`). First turn is a fixed greeting; every later turn builds one system prompt from:
  `consultant_skills` (module, proficiency, years only), `certifications`, `consultants.bio`,
  `interview_training_config` (active rows for "general" + the consultant's modules: `custom_questions`,
  `training_instructions`, `difficulty_level`), `interview_question_library` (10 random active questions; best answers
  only used at evaluation) and `interview_templates` (matched by seniority from module years). Style "discussion" /
  "scenario" drops the bank. Evaluation (`action: evaluate`) scores with the library best answers and writes
  `interview_answers` rows.
- `generate-interview-questions`: admin-only drafting from pasted/uploaded text into the library (used by the Question
  library and the Training page). `ai-interview-questions` / `ai-interview-evaluate`: older functions, not called by the app.
- **Uploads today**: the Training page reads files in the browser and pastes up to 6,000 characters per file into
  `training_instructions` (so whole document text reaches the interviewer prompt). Nothing is stored as a document.
- **Profile**: modules in `consultant_skills` (`sap_module`, `proficiency_level` 1–5, `years_experience`, `certified`);
  no version per module. Version-like data only in free lists: `consultants.sap_technologies` (e.g. "ECC 6.0",
  "S/4HANA On-Premise"), `deployment_experience`, `project_types`, `seniority_level`, `total_sap_years`, and module
  names that contain a release ("SAP ECC 6.0"). CV: `consultant_cv_profiles.cv_text`, `matching_summary`,
  `expertise_keywords`. Projects: `consultant_projects.sap_modules`, `duration_months`.
- **SAP help documentation**: `sap_doc_sources` / `sap_doc_chunks` with per-source `enabled` switch, read only by
  `ai-suggest` through `search_sap_docs`. Not used by interviews (and still not: see below).
- **Knowledge**: `knowledge_solutions` (+ `knowledge_solution_meta.privacy_flags`, `reviewed_at`), `knowledge_articles`.

## 2. What was built

- **Plan before the first question** (`_shared/interviewPlan.ts`): per module weight = years 35 % + proficiency 30 % +
  project use 25 % + certified 10 %; every covered module gets the minimum, the strongest get more (up to the maximum);
  difficulty from seniority (or total years), one lower/higher for light/deep modules. Release from the new profile field,
  else from the module name, else a short **version warm-up** question first. The first question of each module with a
  release is version-specific. One soft-skill question. Kinds rotate per module (scenario, troubleshooting, design
  trade-off, technical: T-codes/tables/BAdIs) with a per-session seed and varied scenario parameters.
- **Sources, in order**: admin knowledge documents (module and version filter first, then profile keywords, full-text),
  question library, published global privacy-clean knowledge solutions, training configs/templates as guidance.
  `sap_doc_*` is never a question or answer source; when an admin has switched an SAP documentation source on, the
  admin preview shows official links only.
- **Drafting**: one call (cap per interview, default 2) to `google/gemini-3.1-flash-lite` (cheapest current model,
  zero retention), streamed, strict JSON schema. Excerpts are wrapped as data with local ids (no titles/file names),
  instruction-like excerpts are dropped, output is validated (slot, module, allowed sources, no 10-word copy of an
  excerpt, not asked before). Missing slots are filled from the library, then from profile-based templates.
- **Cache + audit**: plan and questions (with key points) in `interview_plans`, prepared in the background during the
  greeting; question hashes in `interview_question_log` (UNIQUE per consultant = never asked twice). The interviewer tags
  planned questions `[[q: N]]` (hidden on screen and stripped before saving); evaluation stores
  `interview_answers.question_source` (document/chunk ids, library id, knowledge id or "generated from profile") and
  uses the key points for scoring. Consultants cannot read that column (column privileges).
- **Admin page** (tabs): Training configs (unchanged), Knowledge documents (upload PDF/DOCX/TXT/MD ≤ 10 MB, type by
  extension and content, safe names, rights confirmation stored with who/when, personal-data warning with cancel,
  status Uploaded > Extracting > Ready / No text found / Failed with reason, enable switch, excerpt preview, re-extract,
  delete with reason, all audited), Coverage (module × version: documents, consultants, questions asked and average score
  in 30 days, "No documents for …"), Preview for a consultant (plan + 5 sample questions + sources + token use), Settings
  (switch, per-module min/max, totals, caps, release lists per product family).
- **Profile**: optional "Version / release" per module in SAP expertise (choices per product family, admin-editable,
  free text allowed). Field rules unchanged (optional).
- **Consultant**: one line before the interview while the feature is on: "Questions are based on the modules and versions
  in your profile: … Update your profile if this is not right." No consultant uploads. Arabic interviews keep SAP terms
  in English.

## 3. What the owner applies

1. `docs/sql/interview-knowledge.sql` (once; re-runnable).
2. `docs/sql/interview-knowledge.test.sql` (rolled back; ends with "ALL PASSED").
3. The private storage bucket `interview-knowledge` is created automatically on the first upload (10 MB limit).
4. When ready: Admin > AI Interviewer Training > Settings > switch on "Use knowledge base for interview questions".

## 4. How to test

- **Admin**: Knowledge documents > Upload a small MD or text-based PDF (module e.g. "SAP FI", version "S/4HANA 2023",
  tick the confirmation) > status becomes Ready with an excerpt count > Preview excerpts. Upload a scanned PDF: "No text
  found". Coverage shows the row; Preview for a consultant > pick a consultant with modules > Build preview: plan table,
  5 questions, sources "<document title> #<excerpt>".
- **Consultant** (after switching on): Profile > SAP expertise > set a version for a module > start the AI interview:
  the pre-interview line lists the modules and versions; after the introduction the questions follow the plan; a module
  without a version starts with a release warm-up. Admin > Consultant interviews > open the interview's answers:
  each question shows "Why asked (admins only)" (document title, library, knowledge base or generated from the profile).

## 5. New strings (English / Arabic)

| Key | English | Arabic |
|---|---|---|
| `ik.coverage.any_version` | any / not given | أي إصدار / غير محدد |
| `ik.coverage.asked` | Questions asked | الأسئلة المطروحة |
| `ik.coverage.consultants` | Consultants | المستشارون |
| `ik.coverage.documents` | Documents | المستندات |
| `ik.coverage.empty` | Nothing to show yet. | لا يوجد ما يُعرض بعد. |
| `ik.coverage.general_only` | Only release-independent documents | مستندات عامة فقط (بدون إصدار) |
| `ik.coverage.module` | Module | الوحدة |
| `ik.coverage.none` | No documents for {{what}} | لا توجد مستندات لـ {{what}} |
| `ik.coverage.score` | Average score | متوسط الدرجة |
| `ik.coverage.subtitle` | Modules and versions that consultants declare or documents cover. Questions and scores are from the last 30 days. | الوحدات والإصدارات التي يذكرها المستشارون أو تغطيها المستندات. الأسئلة والدرجات لآخر 30 يومًا. |
| `ik.coverage.title` | Coverage (module × version) | التغطية (الوحدة × الإصدار) |
| `ik.coverage.version` | Version | الإصدار |
| `ik.delete.body` | "{{title}}", its file and all its excerpts are deleted. Questions already asked keep their history. This is recorded in the audit log. | سيُحذف «{{title}}» وملفه وكل مقتطفاته. تبقى الأسئلة التي طُرحت سابقًا في السجل. يُسجَّل ذلك في سجل التدقيق. |
| `ik.delete.reason` | Reason (required) | السبب (مطلوب) |
| `ik.delete.title` | Delete this document? | حذف هذا المستند؟ |
| `ik.difficulty.easy` | Easy | سهل |
| `ik.difficulty.expert` | Expert | خبير |
| `ik.difficulty.hard` | Hard | صعب |
| `ik.difficulty.medium` | Medium | متوسط |
| `ik.docs.busy` | This document is being read right now. Try again in a few minutes. | تجري قراءة هذا المستند الآن. حاول مجددًا بعد بضع دقائق. |
| `ik.docs.chunks` | {{count}} excerpts | {{count}} مقتطفًا |
| `ik.docs.delete` | Delete | حذف |
| `ik.docs.deleted` | Document, file and excerpts deleted. | حُذف المستند والملف والمقتطفات. |
| `ik.docs.empty` | No documents yet. Without documents the interviewer uses the question library and general SAP knowledge. | لا توجد مستندات بعد. بدون مستندات يستخدم المحاور بنك الأسئلة والمعرفة العامة بـ SAP. |
| `ik.docs.enabled` | Enabled | مفعّل |
| `ik.docs.excerpts` | Preview excerpts | معاينة المقتطفات |
| `ik.docs.reextract` | Re-extract | إعادة الاستخراج |
| `ik.docs.reextracted` | Text read again. | أُعيدت قراءة النص. |
| `ik.docs.subtitle` | Private to administrators. Short excerpts feed the interview questions; candidates never see the documents. | خاصة بالمشرفين فقط. مقتطفات قصيرة منها تغذي أسئلة المقابلة، ولا يرى المرشحون المستندات أبدًا. |
| `ik.docs.title` | Knowledge documents | مستندات المعرفة |
| `ik.docs.types` | PDF, DOCX, TXT or MD, up to 10 MB | PDF أو DOCX أو TXT أو MD، حتى 10 ميغابايت |
| `ik.docs.upload` | Upload document | رفع مستند |
| `ik.docs.uploaded_at` | Uploaded {{date}} | رُفع في {{date}} |
| `ik.errors.ai_busy` | The AI is busy; questions were filled from the library and the profile. | الذكاء الاصطناعي مشغول؛ مُلئت الأسئلة من بنك الأسئلة والملف الشخصي. |
| `ik.errors.ai_credits` | AI credits are used up; questions were filled from the library and the profile. | نفدت أرصدة الذكاء الاصطناعي؛ مُلئت الأسئلة من بنك الأسئلة والملف الشخصي. |
| `ik.errors.ai_denied` | The AI request was refused; questions were filled from the library and the profile. | رُفض طلب الذكاء الاصطناعي؛ مُلئت الأسئلة من بنك الأسئلة والملف الشخصي. |
| `ik.errors.ai_failed` | The AI was not available; questions were filled from the library and the profile. | لم يكن الذكاء الاصطناعي متاحًا؛ مُلئت الأسئلة من بنك الأسئلة والملف الشخصي. |
| `ik.errors.duplicate` | This file is already uploaded. | هذا الملف مرفوع مسبقًا. |
| `ik.errors.failed` | Something went wrong. Please try again. | حدث خطأ ما. حاول مجددًا. |
| `ik.errors.invalid_meta` | Please check the title, module and confirmation. | يرجى التحقق من العنوان والوحدة والتأكيد. |
| `ik.errors.module_cap` | This module has reached its document limit (see Settings). | بلغت هذه الوحدة الحد الأقصى للمستندات (راجع الإعدادات). |
| `ik.errors.no_file` | Choose a file first. | اختر ملفًا أولًا. |
| `ik.errors.not_found` | Not found. | غير موجود. |
| `ik.errors.not_ready` | The database update for knowledge documents is not applied yet. | لم يُطبَّق تحديث قاعدة البيانات الخاص بمستندات المعرفة بعد. |
| `ik.errors.rate_limited` | Too many requests. Please wait a while. | طلبات كثيرة جدًا. يرجى الانتظار قليلًا. |
| `ik.errors.save_failed` | Could not save. Please try again. | تعذّر الحفظ. حاول مجددًا. |
| `ik.errors.storage_failed` | The file could not be stored. Please try again. | تعذّر تخزين الملف. حاول مجددًا. |
| `ik.errors.too_large` | The file is larger than 10 MB. | حجم الملف أكبر من 10 ميغابايت. |
| `ik.errors.total_cap` | The total size limit for documents would be exceeded (see Settings). | سيتجاوز الحجم الإجمالي حد المستندات (راجع الإعدادات). |
| `ik.errors.wrong_type` | Only PDF, DOCX, TXT and MD files are accepted, and the content must match the file type. | تُقبل ملفات PDF وDOCX وTXT وMD فقط، ويجب أن يطابق المحتوى نوع الملف. |
| `ik.kind.design` | Design trade-off | موازنة تصميمية |
| `ik.kind.scenario` | Scenario | سيناريو |
| `ik.kind.soft_skill` | Soft skill | مهارات شخصية |
| `ik.kind.technical` | Technical | تقني |
| `ik.kind.troubleshooting` | Troubleshooting | استكشاف الأخطاء |
| `ik.kind.version_warmup` | Version warm-up | سؤال تمهيدي عن الإصدار |
| `ik.lang.ar` | Arabic | العربية |
| `ik.lang.de` | German | الألمانية |
| `ik.lang.en` | English | الإنجليزية |
| `ik.lang.es` | Spanish | الإسبانية |
| `ik.lang.fr` | French | الفرنسية |
| `ik.lang.other` | Other | أخرى |
| `ik.not_applied` | Knowledge documents, coverage and the consultant preview need a database update that is prepared but not applied yet. Until then interviews work as before. | تحتاج مستندات المعرفة والتغطية ومعاينة المستشار إلى تحديث لقاعدة البيانات جاهز لكنه لم يُطبَّق بعد. حتى ذلك الحين تعمل المقابلات كما كانت. |
| `ik.notice.based_on` | Questions are based on the modules and versions in your profile: {{list}}. | الأسئلة مبنية على الوحدات والإصدارات الموجودة في ملفك الشخصي: {{list}}. |
| `ik.notice.no_modules` | Questions are based on the modules and versions in your profile, but your profile has no SAP modules yet. | الأسئلة مبنية على الوحدات والإصدارات في ملفك الشخصي، لكن ملفك لا يحتوي على وحدات SAP بعد. |
| `ik.notice.update` | Update your profile if this is not right. | حدّث ملفك الشخصي إن لم يكن هذا صحيحًا. |
| `ik.page.edit` | Edit | تعديل |
| `ik.page.new_config` | New Training Config | إعداد تدريب جديد |
| `ik.page.subtitle` | Configure custom questions, difficulty, and training instructions for the AI interviewer. | اضبط الأسئلة المخصصة ومستوى الصعوبة وتعليمات التدريب لمحاور الذكاء الاصطناعي. |
| `ik.page.title` | AI Interviewer Training | تدريب محاور الذكاء الاصطناعي |
| `ik.pii.after` | The text seems to contain {{what}}. Delete the document if it holds client data. | يبدو أن النص يحتوي على {{what}}. احذف المستند إن كان يحتوي على بيانات عملاء. |
| `ik.pii.body` | We found {{what}}. Knowledge documents must not contain confidential client data. Cancel and remove it, or upload anyway if these are public examples. | وجدنا {{what}}. يجب ألا تحتوي مستندات المعرفة على بيانات سرية للعملاء. ألغِ الرفع واحذفها، أو ارفع على أي حال إن كانت أمثلة عامة. |
| `ik.pii.cancel` | Cancel upload | إلغاء الرفع |
| `ik.pii.card` | May contain {{what}}. | قد يحتوي على {{what}}. |
| `ik.pii.continue` | Upload anyway | رفع على أي حال |
| `ik.pii.emails` | {{count}} e-mail address(es) | {{count}} من عناوين البريد الإلكتروني |
| `ik.pii.numbers` | {{count}} long number(s) | {{count}} من الأرقام الطويلة |
| `ik.pii.phones` | {{count}} phone number(s) | {{count}} من أرقام الهاتف |
| `ik.pii.title` | This document may contain personal data | قد يحتوي هذا المستند على بيانات شخصية |
| `ik.preview.ask_version` | not given: asked first | غير محدد: يُسأل عنه أولًا |
| `ik.preview.consultant` | Consultant | المستشار |
| `ik.preview.difficulty` | Difficulty | الصعوبة |
| `ik.preview.inferred` | from the module name | من اسم الوحدة |
| `ik.preview.key_points` | Key points (scoring only) | النقاط الأساسية (للتقييم فقط) |
| `ik.preview.language` | Question language | لغة الأسئلة |
| `ik.preview.no_modules` | This consultant has no SAP modules in the profile. | لا توجد وحدات SAP في ملف هذا المستشار. |
| `ik.preview.off_note` | The knowledge base is switched off: real interviews still use the current behaviour. This preview shows what would be asked once it is on. | قاعدة المعرفة متوقفة: المقابلات الحقيقية ما زالت تعمل كما هي الآن. تُظهر هذه المعاينة ما سيُسأل بعد تشغيلها. |
| `ik.preview.plan` | Plan | الخطة |
| `ik.preview.questions` | Questions | الأسئلة |
| `ik.preview.references` | Official SAP references (administrators only) | مراجع SAP الرسمية (للمشرفين فقط) |
| `ik.preview.run` | Build preview | إنشاء المعاينة |
| `ik.preview.samples` | Sample questions | أسئلة نموذجية |
| `ik.preview.search` | Search by name | ابحث بالاسم |
| `ik.preview.source` | Source | المصدر |
| `ik.preview.subtitle` | See the plan and 5 sample questions with their sources. Nothing is saved and the consultant is not told. | اطّلع على الخطة و5 أسئلة نموذجية مع مصادرها. لا يُحفظ شيء ولا يُبلَّغ المستشار. |
| `ik.preview.title` | Preview for a consultant | معاينة لمستشار |
| `ik.preview.uncovered` | Not covered (limit reached): {{list}} | غير مشمول (تم بلوغ الحد): {{list}} |
| `ik.preview.usage` | AI calls: {{calls}} · tokens in {{tin}} / out {{tout}} | استدعاءات الذكاء الاصطناعي: {{calls}} · رموز الإدخال {{tin}} / الإخراج {{tout}} |
| `ik.preview.version_specific` | Version-specific | خاص بالإصدار |
| `ik.preview.weight` | Weight | الوزن |
| `ik.profile.version_hint` | The AI interview asks about the releases you name here, for example S/4HANA 2023 or ECC 6.0 EHP8. Pick one or type your own. | تسأل مقابلة الذكاء الاصطناعي عن الإصدارات التي تذكرها هنا، مثل S/4HANA 2023 أو ECC 6.0 EHP8. اختر واحدًا أو اكتب إصدارك. |
| `ik.profile.version_placeholder` | Version / release | الإصدار / Release |
| `ik.profile.version_title` | Version / release per module (optional) | الإصدار / Release لكل وحدة (اختياري) |
| `ik.settings.enabled` | Use knowledge base for interview questions | استخدام قاعدة المعرفة لأسئلة المقابلة |
| `ik.settings.enabled_hint` | Off by default. Switch on only after the owner approves. While off, interviews keep today's behaviour. | متوقفة افتراضيًا. شغّلها فقط بعد موافقة المالك. أثناء توقفها تعمل المقابلات كما هي اليوم. |
| `ik.settings.excerpt_chars` | Characters per excerpt at most | أقصى عدد من الأحرف لكل مقتطف |
| `ik.settings.max_ai_calls` | AI drafting calls per interview at most | أقصى عدد لاستدعاءات صياغة الأسئلة في كل مقابلة |
| `ik.settings.max_docs_per_module` | Documents per module at most | أقصى عدد من المستندات لكل وحدة |
| `ik.settings.max_excerpts` | Excerpts passed to the AI at most | أقصى عدد من المقتطفات المرسلة للذكاء الاصطناعي |
| `ik.settings.max_modules` | Modules covered at most | أقصى عدد من الوحدات المشمولة |
| `ik.settings.max_per_module` | Questions per module: maximum | الأسئلة لكل وحدة: الحد الأقصى |
| `ik.settings.max_total_mb` | Total document size at most (MB) | أقصى حجم إجمالي للمستندات (ميغابايت) |
| `ik.settings.min_per_module` | Questions per module: minimum | الأسئلة لكل وحدة: الحد الأدنى |
| `ik.settings.saved` | Settings saved | حُفظت الإعدادات |
| `ik.settings.title` | Knowledge base settings | إعدادات قاعدة المعرفة |
| `ik.settings.total_questions` | Main questions per interview | الأسئلة الرئيسية في كل مقابلة |
| `ik.source.document` | Knowledge document | مستند معرفة |
| `ik.source.follow_up` | Follow-up | سؤال متابعة |
| `ik.source.generated_from_profile` | Generated from the profile | مُنشأ من الملف الشخصي |
| `ik.source.knowledge` | Knowledge base | قاعدة المعرفة |
| `ik.source.library` | Question library | بنك الأسئلة |
| `ik.state_off` | Knowledge base is OFF: interviews use the current behaviour until it is switched on in Settings. | قاعدة المعرفة متوقفة: تعمل المقابلات كما هي الآن حتى تُشغَّل من الإعدادات. |
| `ik.state_on` | Knowledge base is ON for interview questions. | قاعدة المعرفة مفعّلة لأسئلة المقابلة. |
| `ik.status.extracting` | Extracting | جارٍ الاستخراج |
| `ik.status.failed` | Failed | فشل |
| `ik.status.no_text` | No text found | لا يوجد نص |
| `ik.status.ready` | Ready | جاهز |
| `ik.status.uploaded` | Uploaded | مرفوع |
| `ik.status_reason.failed` | Text extraction failed. Try Re-extract, or upload the file again. | تعذّر استخراج النص. جرّب «إعادة الاستخراج» أو ارفع الملف من جديد. |
| `ik.status_reason.no_text` | No text found. This looks like a scanned PDF or an image-only file. | لم يُعثر على نص. يبدو أنه ملف PDF ممسوح ضوئيًا أو صورة فقط. |
| `ik.tabs.configs` | Training configs | إعدادات التدريب |
| `ik.tabs.coverage` | Coverage | التغطية |
| `ik.tabs.documents` | Knowledge documents | مستندات المعرفة |
| `ik.tabs.preview` | Preview for a consultant | معاينة لمستشار |
| `ik.tabs.settings` | Settings | الإعدادات |
| `ik.upload.doc_title` | Title | العنوان |
| `ik.upload.empty` | The file is empty. | الملف فارغ. |
| `ik.upload.failed` | The text could not be read. Use Re-extract or upload the file again. | تعذّرت قراءة النص. استخدم «إعادة الاستخراج» أو ارفع الملف من جديد. |
| `ik.upload.language` | Language | اللغة |
| `ik.upload.module` | SAP module | وحدة SAP |
| `ik.upload.notes` | Notes (only for administrators) | ملاحظات (للمشرفين فقط) |
| `ik.upload.ready` | Document ready: {{count}} excerpts. | المستند جاهز: {{count}} مقتطفًا. |
| `ik.upload.rights` | I confirm I may use this document for training the interviewer (no confidential client data, copyright respected). | أؤكد أنه يحق لي استخدام هذا المستند لتدريب المحاور (لا بيانات سرية للعملاء، مع احترام حقوق النشر). |
| `ik.upload.tags` | Tags (comma-separated) | وسوم (مفصولة بفواصل) |
| `ik.upload.title` | Upload a knowledge document | رفع مستند معرفة |
| `ik.upload.too_large` | The file is larger than 10 MB. | حجم الملف أكبر من 10 ميغابايت. |
| `ik.upload.version` | Version / release (optional) | الإصدار / Release (اختياري) |
| `ik.upload.working` | Uploading and reading… | جارٍ الرفع والقراءة… |
| `ik.upload.wrong_type` | Only PDF, DOCX, TXT and MD files are accepted. | تُقبل ملفات PDF وDOCX وTXT وMD فقط. |
| `ik.versions.add` | Add a release | إضافة إصدار |
| `ik.versions.customize` | Edit this list | تعديل هذه القائمة |
| `ik.versions.remove` | Remove {{label}} | إزالة {{label}} |
| `ik.versions.subtitle` | Consultants pick a release per module from these lists or type their own. Optional unless the owner makes it required. | يختار المستشارون إصدارًا لكل وحدة من هذه القوائم أو يكتبون إصدارهم. اختياري ما لم يجعله المالك إلزاميًا. |
| `ik.versions.title` | Version / release choices in the profile | خيارات الإصدار / Release في الملف الشخصي || `ik.sources.deleted_doc` | deleted document | مستند محذوف |
| `ik.sources.why` | Why asked (admins only) | سبب طرح السؤال (للمشرفين فقط) |
