/**
 * Why a button is dimmed, and what to do next: the one catalogue every blocked button uses.
 *
 * Owner rule (Oct 25): no button in the portal is ever silently dead. A blocked button names its FIRST blocking step in one
 * short sentence, offers the next step (a link or an action) and says how many more steps follow. Server refusals (database
 * error codes such as `sla_acceptance_required`) map to the same entries, so a toast reads exactly like the button.
 *
 * Everything here is pure (no React, no i18n instance) so it is unit tested and shared by the button, toasts and tests.
 */

export type Lang = 'en' | 'ar';
export interface Txt { en: string; ar: string }

export interface ReasonDef {
  /** one short sentence: why it is blocked ({{param}} placeholders allowed) */
  message: Txt;
  /** label of the next step, e.g. "Sign the NDA" (omit when the step is "just do it on this screen") */
  next?: Txt;
  /** default route of the next step (callers may override with `to` or `onNext`) */
  to?: string;
  /** groups reasons in the audit and the Arabic list */
  group: 'ticket' | 'nda' | 'money' | 'profile' | 'access' | 'form' | 'state' | 'admin';
}

const r = (group: ReasonDef['group'], en: string, ar: string, next?: [string, string], to?: string): ReasonDef => ({
  group,
  message: { en, ar },
  ...(next ? { next: { en: next[0], ar: next[1] } } : {}),
  ...(to ? { to } : {}),
});

/** The catalogue. Keys are stable (tests and server-code mapping refer to them). */
export const BLOCKED_REASONS = {
  // ------------------------------------------------------------------ ticket / engagement
  no_consultant_assigned: r('ticket', 'A consultant must be assigned first.', 'يجب تعيين مستشار أولًا.', ['Go to Bids', 'الانتقال إلى العروض']),
  no_consultant_selected: r('ticket', 'Choose a consultant first.', 'اختر مستشارًا أولًا.'),
  ticket_closed: r('ticket', 'This request is closed, so this is no longer possible.', 'هذا الطلب مغلق، لذلك لم يعد هذا ممكنًا.'),
  not_ticket_owner: r('ticket', 'Only the person who opened this request can do this.', 'يمكن فقط لمن فتح هذا الطلب القيام بذلك.'),
  not_assigned_to_you: r('ticket', 'You are not assigned to this request.', 'أنت غير معيّن على هذا الطلب.'),
  rate_not_approved: r('ticket', 'The hourly rate must be approved first.', 'يجب اعتماد سعر الساعة أولًا.', ['Review the rate', 'مراجعة السعر']),
  engagement_not_confirmed: r('ticket', 'The engagement must be confirmed by both sides first.', 'يجب أن يؤكد الطرفان الارتباط أولًا.', ['Open the checklist', 'فتح قائمة التحقق']),
  sla_not_accepted: r('ticket', 'Accept the SLA targets for this request first.', 'اقبل أهداف اتفاقية مستوى الخدمة لهذا الطلب أولًا.', ['Review the SLA', 'مراجعة اتفاقية مستوى الخدمة']),
  brd_not_approved: r('ticket', 'The business requirements document must be approved first.', 'يجب اعتماد مستند متطلبات العمل أولًا.', ['Open the BRD', 'فتح مستند المتطلبات']),
  brd_not_submitted: r('ticket', 'Submit a business requirements document version first.', 'أرسل نسخة من مستند متطلبات العمل أولًا.', ['Open the BRD', 'فتح مستند المتطلبات']),
  bids_closed: r('ticket', 'Bidding for this request has closed.', 'أُغلق باب العروض لهذا الطلب.'),
  no_bids_yet: r('ticket', 'No bids have arrived yet.', 'لم تصل أي عروض بعد.'),
  work_not_started: r('ticket', 'Work on this request has not started yet.', 'لم يبدأ العمل على هذا الطلب بعد.'),
  no_work_logged: r('ticket', 'Log your working hours first.', 'سجّل ساعات العمل أولًا.', ['Log hours', 'تسجيل الساعات']),
  timesheet_not_submitted: r('ticket', 'The timesheet has not been submitted yet.', 'لم يُرسل سجل الساعات بعد.'),
  csat_not_ready: r('ticket', 'A satisfaction survey can be requested once the work is resolved.', 'يمكن طلب استبيان الرضا بعد حل المشكلة.'),
  outside_availability: r('ticket', 'This time is outside the consultant\'s working hours.', 'هذا الوقت خارج ساعات عمل المستشار.', ['Pick another time', 'اختر وقتًا آخر']),
  team_full: r('ticket', 'The team is already full.', 'اكتمل الفريق بالفعل.'),
  agreement_not_active: r('ticket', 'The support agreement must be active first.', 'يجب أن تكون اتفاقية الدعم نشطة أولًا.', ['Open the agreement', 'فتح الاتفاقية']),
  crew_not_confirmed: r('ticket', 'Every crew member must accept their place first.', 'يجب أن يقبل كل أعضاء الفريق أماكنهم أولًا.', ['Open the team checklist', 'فتح قائمة الفريق']),
  terms_not_accepted: r('ticket', 'Both sides must accept the agreement terms first.', 'يجب أن يقبل الطرفان شروط الاتفاقية أولًا.', ['Review the terms', 'مراجعة الشروط']),
  start_date_not_reached: r('ticket', 'The start date has not been reached yet.', 'لم يحن تاريخ البدء بعد.'),
  meeting_not_started: r('ticket', 'The meeting has not started yet.', 'لم يبدأ الاجتماع بعد.'),

  // ------------------------------------------------------------------ NDA
  nda_not_signed_by_you: r('nda', 'You must sign the NDA first.', 'يجب أن توقّع اتفاقية عدم الإفصاح أولًا.', ['Sign the NDA', 'توقيع اتفاقية عدم الإفصاح']),
  nda_waiting_other_party: r('nda', 'Waiting for the {{party}} to sign the NDA.', 'بانتظار توقيع {{party}} على اتفاقية عدم الإفصاح.', ['Send a reminder', 'إرسال تذكير']),
  nda_not_signed: r('nda', 'An NDA signed by both sides is needed first.', 'يلزم أولًا اتفاقية عدم إفصاح موقّعة من الطرفين.', ['Open the NDA', 'فتح اتفاقية عدم الإفصاح']),
  nda_revoked: r('nda', 'The NDA was revoked. A new NDA is needed.', 'أُلغيت اتفاقية عدم الإفصاح. يلزم توقيع اتفاقية جديدة.', ['Open the NDA', 'فتح اتفاقية عدم الإفصاح']),
  signature_incomplete: r('nda', 'Complete every signing item first.', 'أكمل كل بنود التوقيع أولًا.'),

  // ------------------------------------------------------------------ money
  payment_not_confirmed: r('money', 'The payment must be confirmed first.', 'يجب تأكيد الدفع أولًا.', ['Open invoices', 'فتح الفواتير']),
  invoice_not_approved: r('money', 'The invoice must be approved first.', 'يجب اعتماد الفاتورة أولًا.'),
  missing_payout_details: r('money', 'Add your payout details first.', 'أضف بيانات صرف المستحقات أولًا.', ['Add payout details', 'إضافة بيانات الصرف'], '/consultant/earnings'),
  no_bank_account: r('money', 'Add a bank account first.', 'أضف حسابًا بنكيًا أولًا.', ['Add a bank account', 'إضافة حساب بنكي'], '/consultant/earnings'),
  minimum_payout_not_reached: r('money', 'Your balance is below the minimum payout of {{amount}}.', 'رصيدك أقل من الحد الأدنى للصرف وهو {{amount}}.'),
  nothing_to_pay: r('money', 'There is nothing to pay yet.', 'لا يوجد شيء للدفع بعد.'),
  payment_reference_missing: r('money', 'Enter the payment reference first.', 'أدخل مرجع الدفع أولًا.'),

  // ------------------------------------------------------------------ profile / consultant status
  profile_incomplete: r('profile', 'Complete your profile first.', 'أكمل ملفك الشخصي أولًا.', ['Complete your profile', 'إكمال الملف الشخصي'], '/consultant/profile'),
  profile_missing_fields: r('profile', 'Complete your profile first: {{fields}}.', 'أكمل ملفك الشخصي أولًا: {{fields}}.', ['Complete your profile', 'إكمال الملف الشخصي'], '/consultant/profile'),
  location_missing: r('profile', 'Add your country and city first.', 'أضف بلدك ومدينتك أولًا.', ['Add your location', 'إضافة موقعك'], '/consultant/profile'),
  ai_interview_not_passed: r('profile', 'You need to pass the AI interview first.', 'يجب أن تجتاز المقابلة بالذكاء الاصطناعي أولًا.', ['Start the interview', 'بدء المقابلة'], '/consultant/profile'),
  verification_pending: r('profile', 'Your profile is waiting for verification.', 'ملفك الشخصي بانتظار التحقق.', ['See verification status', 'عرض حالة التحقق'], '/consultant/verification'),
  policy_not_accepted: r('profile', 'Accept the consultant policy first.', 'اقبل سياسة المستشارين أولًا.', ['Read the policy', 'قراءة السياسة'], '/consultant/consultant-policy'),
  availability_not_set: r('profile', 'Set your weekly availability first.', 'حدّد أوقات توفرك الأسبوعية أولًا.', ['Set availability', 'تحديد التوفر'], '/consultant/availability'),
  on_hold: r('profile', 'Your account is on hold right now.', 'حسابك في وضع الإيقاف المؤقت حاليًا.', ['Manage availability', 'إدارة التوفر'], '/consultant/availability'),
  email_not_confirmed: r('profile', 'Confirm your e-mail address first.', 'أكّد بريدك الإلكتروني أولًا.'),

  // ------------------------------------------------------------------ access / platform
  feature_disabled_by_admin: r('access', 'Not available yet.', 'غير متاح بعد.'),
  feature_not_ready: r('access', 'This part is still being prepared.', 'هذا الجزء قيد التجهيز.'),
  permission_missing: r('access', 'Your role ({{role}}) cannot do this.', 'دورك ({{role}}) لا يسمح بذلك.'),
  admin_only: r('access', 'Only administrators can do this.', 'يمكن للمسؤولين فقط القيام بذلك.'),
  rate_limit: r('access', 'Please try again in {{minutes}} min.', 'يرجى المحاولة مرة أخرى بعد {{minutes}} دقيقة.'),
  rate_limit_soon: r('access', 'Too many tries. Please wait a moment and try again.', 'محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.'),
  pending_admin_review: r('access', 'Waiting for an administrator to review this.', 'بانتظار مراجعة أحد المسؤولين.'),
  already_done: r('state', 'Already done.', 'تمّ بالفعل.'),
  offline: r('access', 'You are offline. Reconnect to continue.', 'أنت غير متصل. أعد الاتصال للمتابعة.'),
  sign_in_required: r('access', 'Sign in first.', 'سجّل الدخول أولًا.', ['Sign in', 'تسجيل الدخول'], '/login'),

  // ------------------------------------------------------------------ forms (the step is on this screen)
  fill_required_fields: r('form', 'Fill in the required fields first.', 'املأ الحقول المطلوبة أولًا.'),
  field_required: r('form', 'Enter {{field}} first.', 'أدخل {{field}} أولًا.'),
  type_message_first: r('form', 'Type a message first.', 'اكتب رسالة أولًا.'),
  text_too_short: r('form', 'Write at least {{min}} characters.', 'اكتب {{min}} أحرف على الأقل.'),
  text_too_long: r('form', 'The text is too long (maximum {{max}} characters).', 'النص طويل جدًا (الحد الأقصى {{max}} حرفًا).'),
  reason_required: r('form', 'Give a reason first (at least {{min}} characters).', 'اذكر سببًا أولًا ({{min}} أحرف على الأقل).'),
  choose_option_first: r('form', 'Choose an option first.', 'اختر خيارًا أولًا.'),
  select_items_first: r('form', 'Select at least one item first.', 'حدّد عنصرًا واحدًا على الأقل أولًا.'),
  choose_date_first: r('form', 'Choose a date first.', 'اختر تاريخًا أولًا.'),
  choose_time_first: r('form', 'Choose a date and time first.', 'اختر التاريخ والوقت أولًا.'),
  date_in_past: r('form', 'This time is in the past. Choose a later time.', 'هذا الوقت في الماضي. اختر وقتًا لاحقًا.'),
  upload_file_first: r('form', 'Choose a file first.', 'اختر ملفًا أولًا.'),
  tick_confirmation_first: r('form', 'Tick the confirmation box first.', 'ضع علامة في مربع التأكيد أولًا.'),
  give_rating_first: r('form', 'Choose a rating first.', 'اختر تقييمًا أولًا.'),
  fix_errors_first: r('form', 'Fix the highlighted problems first.', 'أصلح المشكلات المميّزة أولًا.'),
  invalid_value: r('form', 'Check the value you entered.', 'تحقق من القيمة التي أدخلتها.'),
  invalid_email: r('form', 'Enter a valid e-mail address.', 'أدخل بريدًا إلكترونيًا صحيحًا.'),
  nothing_changed: r('form', 'No changes to save yet.', 'لا توجد تغييرات للحفظ بعد.'),
  save_changes_first: r('form', 'Save your changes first.', 'احفظ تغييراتك أولًا.'),
  limit_reached: r('form', 'The limit of {{max}} is reached.', 'تم الوصول إلى الحد الأقصى وهو {{max}}.'),
  minimum_items: r('form', 'At least {{min}} must remain.', 'يجب أن يبقى {{min}} على الأقل.'),
  type_to_confirm: r('form', 'Type {{word}} to confirm.', 'اكتب {{word}} للتأكيد.'),
  same_as_current: r('form', 'This is already the current value.', 'هذه هي القيمة الحالية بالفعل.'),
  not_in_list: r('form', 'This is not in the list.', 'هذا ليس ضمن القائمة.'),
  already_added: r('form', 'Already added.', 'تمت الإضافة بالفعل.'),
  answer_required: r('form', 'Answer this question first.', 'أجب عن هذا السؤال أولًا.'),
  previous_step_incomplete: r('form', 'Finish this step first.', 'أكمل هذه الخطوة أولًا.'),

  // ------------------------------------------------------------------ list state
  nothing_to_export: r('state', 'There is nothing to export yet.', 'لا يوجد شيء للتصدير بعد.'),
  no_data_yet: r('state', 'There is nothing here yet.', 'لا يوجد شيء هنا بعد.'),
  first_page: r('state', 'This is the first page.', 'هذه هي الصفحة الأولى.'),
  last_page: r('state', 'This is the last page.', 'هذه هي الصفحة الأخيرة.'),
  already_first: r('state', 'This is already at the top.', 'هذا في الأعلى بالفعل.'),
  already_last: r('state', 'This is already at the bottom.', 'هذا في الأسفل بالفعل.'),
  loading_data: r('state', 'Still loading. Please wait a moment.', 'جارٍ التحميل. يرجى الانتظار قليلًا.'),
  another_action_running: r('state', 'Please wait until the current action finishes.', 'يرجى الانتظار حتى ينتهي الإجراء الحالي.'),
  recording_in_progress: r('state', 'Stop the recording first.', 'أوقف التسجيل أولًا.'),
  ai_answering: r('state', 'Wait until the assistant has finished answering.', 'انتظر حتى ينتهي المساعد من الإجابة.'),
  in_use: r('state', 'This is still in use, so it cannot be removed.', 'هذا ما زال قيد الاستخدام، لذلك لا يمكن حذفه.'),
  is_default: r('state', 'This is the default and cannot be removed.', 'هذا هو الخيار الافتراضي ولا يمكن حذفه.'),
  is_yourself: r('state', 'You cannot do this to your own account.', 'لا يمكنك القيام بذلك على حسابك.'),
  expired: r('state', 'This has expired.', 'انتهت صلاحية هذا.'),
  not_editable_now: r('state', 'This can no longer be changed.', 'لم يعد بالإمكان تغيير هذا.'),
  no_recipients: r('admin', 'Choose at least one recipient first.', 'اختر مستلمًا واحدًا على الأقل أولًا.'),
  too_many_recipients: r('admin', 'Too many recipients selected (maximum {{max}}).', 'تم اختيار عدد كبير من المستلمين (الحد الأقصى {{max}}).'),
  preview_first: r('admin', 'Preview the message first.', 'اعرض معاينة الرسالة أولًا.'),
} satisfies Record<string, ReasonDef>;

export type ReasonKey = keyof typeof BLOCKED_REASONS;
export type ReasonParams = Record<string, string | number | null | undefined>;

/** One blocking step. Callers can override the next step (`to` route, `onNext` action, `nextLabel`) or the text. */
export interface BlockedReason {
  key: ReasonKey;
  params?: ReasonParams;
  /** route of the next step (overrides the catalogue default) */
  to?: string;
  /** action of the next step (opens a dialog, scrolls to a box, ...) */
  onNext?: () => void;
  /** label of the next step when the caller's step differs from the catalogue's */
  nextLabel?: string;
  /** an already translated sentence that replaces the catalogue sentence (e.g. a server message) */
  message?: string;
}

export type ReasonSpec = ReasonKey | BlockedReason;
type Falsy = null | undefined | false | '' | 0;
/** What a button accepts: one reason, or a list in step order (falsy entries are steps already done). */
export type BlockedInput = ReasonSpec | Falsy | ReadonlyArray<ReasonSpec | Falsy>;

export interface ResolvedReason {
  key: ReasonKey;
  message: string;
  nextLabel?: string;
  to?: string;
  onNext?: () => void;
}

export interface ResolvedBlock {
  first: ResolvedReason;
  /** further blocking steps after the first ("N more steps") */
  more: ResolvedReason[];
  /** optional "2 of 4 steps done" */
  progress?: { done: number; total: number };
}

const isKey = (k: unknown): k is ReasonKey => typeof k === 'string' && Object.prototype.hasOwnProperty.call(BLOCKED_REASONS, k);

export function isReasonKey(k: unknown): k is ReasonKey {
  return isKey(k);
}

/** The blocking steps in order (falsy entries and unknown keys are dropped). */
export function blockingReasons(input: BlockedInput): BlockedReason[] {
  const list = Array.isArray(input) ? input : [input];
  const out: BlockedReason[] = [];
  for (const item of list as ReadonlyArray<ReasonSpec | Falsy>) {
    if (!item) continue;
    if (typeof item === 'string') { if (isKey(item)) out.push({ key: item }); continue; }
    if (typeof item === 'object' && isKey(item.key)) out.push(item);
  }
  return out;
}

export function isBlocked(input: BlockedInput): boolean {
  return blockingReasons(input).length > 0;
}

export function interpolate(text: string, params?: ReasonParams): string {
  if (!params) return text.replace(/\s*\{\{\w+\}\}/g, '').trim();
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = params[name];
    return v === null || v === undefined ? '' : String(v);
  });
}

export function resolveReason(reason: BlockedReason, lang: Lang = 'en'): ResolvedReason {
  const def: ReasonDef = BLOCKED_REASONS[reason.key];
  const message = reason.message?.trim() || interpolate(def.message[lang], reason.params);
  const nextLabel = reason.nextLabel ?? def.next?.[lang];
  const to = reason.to ?? def.to;
  const hasStep = !!(reason.onNext || to);
  return {
    key: reason.key,
    message,
    ...(hasStep && nextLabel ? { nextLabel } : {}),
    ...(reason.to || (!reason.onNext && def.to) ? { to } : {}),
    ...(reason.onNext ? { onNext: reason.onNext } : {}),
  };
}

/** The first blocking step, the rest, and the optional progress; null when nothing blocks. */
export function describeBlocked(
  input: BlockedInput,
  lang: Lang = 'en',
  progress?: { done: number; total: number },
): ResolvedBlock | null {
  const list = blockingReasons(input);
  if (!list.length) return null;
  const [first, ...rest] = list.map((x) => resolveReason(x, lang));
  const p = progress && progress.total > 0
    ? { done: Math.max(0, Math.min(progress.done, progress.total)), total: progress.total }
    : undefined;
  return { first, more: rest, ...(p ? { progress: p } : {}) };
}

/** "2 more steps" / "خطوتان أخريان" */
export function moreStepsText(n: number, lang: Lang = 'en'): string {
  if (n <= 0) return '';
  if (lang === 'ar') {
    if (n === 1) return 'وخطوة أخرى';
    if (n === 2) return 'وخطوتان أخريان';
    if (n <= 10) return `و${n} خطوات أخرى`;
    return `و${n} خطوة أخرى`;
  }
  return n === 1 ? '1 more step' : `${n} more steps`;
}

export function progressText(p: { done: number; total: number }, lang: Lang = 'en'): string {
  return lang === 'ar' ? `تم إنجاز ${p.done} من ${p.total} خطوات` : `${p.done} of ${p.total} steps done`;
}

/** One sentence for screen readers and inline hints: reason + next step + "N more steps". */
export function blockedSentence(block: ResolvedBlock, lang: Lang = 'en'): string {
  const parts = [block.first.message];
  if (block.first.nextLabel) parts.push(lang === 'ar' ? `الخطوة التالية: ${block.first.nextLabel}.` : `Next step: ${block.first.nextLabel}.`);
  if (block.more.length) parts.push(`(${moreStepsText(block.more.length, lang)})`);
  if (block.progress) parts.push(`${progressText(block.progress, lang)}.`);
  return parts.join(' ');
}

export const BUSY_LABEL: Txt = { en: 'Please wait…', ar: 'يرجى الانتظار…' };
export const SAVING_LABEL: Txt = { en: 'Saving…', ar: 'جارٍ الحفظ…' };

// ====================================================================================== prerequisite checks (pure)

const CLOSED_STATUSES = ['closed', 'cancelled', 'canceled', 'rejected', 'archived'];

export function ticketClosedReason(status: string | null | undefined): ReasonKey | null {
  return CLOSED_STATUSES.includes(String(status ?? '').toLowerCase()) ? 'ticket_closed' : null;
}

export function consultantAssignedReason(consultantId: string | null | undefined): ReasonKey | null {
  return consultantId ? null : 'no_consultant_assigned';
}

export type NdaParty = 'client' | 'consultant';

/** Who still has to sign: me first, then the other party. */
export function ndaReason(s: { revoked?: boolean; signedByMe: boolean; signedByOther: boolean; otherParty: NdaParty; lang?: Lang }): BlockedReason | null {
  if (s.revoked) return { key: 'nda_revoked' };
  if (!s.signedByMe) return { key: 'nda_not_signed_by_you' };
  if (!s.signedByOther) {
    const party = s.lang === 'ar' ? (s.otherParty === 'client' ? 'العميل' : 'المستشار') : (s.otherParty === 'client' ? 'client' : 'consultant');
    return { key: 'nda_waiting_other_party', params: { party } };
  }
  return null;
}

export function profileReason(missing: ReadonlyArray<string>, max = 3): BlockedReason | null {
  const list = missing.filter(Boolean);
  if (!list.length) return null;
  const shown = list.slice(0, max).join(', ');
  const fields = list.length > max ? `${shown} +${list.length - max}` : shown;
  return { key: 'profile_missing_fields', params: { fields } };
}

/** Minutes until a rate limit lifts (rounded up, at least 1). */
export function rateLimitReason(retryAt: Date | string | number | null | undefined, now: Date = new Date()): BlockedReason | null {
  if (retryAt === null || retryAt === undefined) return null;
  const at = new Date(retryAt).getTime();
  if (!Number.isFinite(at)) return null;
  const ms = at - now.getTime();
  if (ms <= 0) return null;
  return { key: 'rate_limit', params: { minutes: Math.max(1, Math.ceil(ms / 60000)) } };
}

/** Payout request: details, bank account, minimum, in that order. */
export function payoutReasons(s: { hasPayoutDetails: boolean; hasBankAccount: boolean; balance: number; minimum: number; formatAmount?: (n: number) => string }): BlockedReason[] {
  const out: BlockedReason[] = [];
  if (!s.hasPayoutDetails) out.push({ key: 'missing_payout_details' });
  if (!s.hasBankAccount) out.push({ key: 'no_bank_account' });
  if (s.balance < s.minimum) out.push({ key: 'minimum_payout_not_reached', params: { amount: s.formatAmount ? s.formatAmount(s.minimum) : String(s.minimum) } });
  return out;
}

export function textReason(value: string | null | undefined, opts: { min?: number; max?: number; key?: 'reason_required' | 'text_too_short' | 'type_message_first' | 'fill_required_fields' } = {}): BlockedReason | null {
  const v = String(value ?? '').trim();
  const min = opts.min ?? 1;
  if (v.length < min) {
    const key = opts.key ?? (min > 1 ? 'text_too_short' : 'fill_required_fields');
    return { key, params: { min } };
  }
  if (opts.max && v.length > opts.max) return { key: 'text_too_long', params: { max: opts.max } };
  return null;
}

export function pageReasons(page: number, pages: number, firstPage = 1): { prev: ReasonKey | null; next: ReasonKey | null } {
  return { prev: page <= firstPage ? 'first_page' : null, next: page >= pages - (firstPage === 0 ? 1 : 0) ? 'last_page' : null };
}

// ====================================================================================== server error codes

/**
 * Server refusal codes (database RAISE EXCEPTION texts and edge function `error` codes) mapped to the catalogue.
 * Only refusals a person can act on belong here; technical errors keep going through friendlyErrorMessage.
 */
export const ERROR_CODE_REASONS: Record<string, ReasonKey> = {
  sla_acceptance_required: 'sla_not_accepted',
  sa_sla_acceptance_required: 'sla_not_accepted',
  brd_gate: 'brd_not_approved',
  brd_approval_required: 'brd_not_approved',
  brd_gate_block: 'brd_not_approved',
  gate_block: 'engagement_not_confirmed',
  nda_required: 'nda_not_signed',
  nda_not_signed_yet: 'nda_not_signed',
  nda_revoked: 'nda_revoked',
  nda_already_signed: 'already_done',
  nda_reminder_too_soon: 'rate_limit_soon',
  nda_rate_limited: 'rate_limit_soon',
  nda_consultant_not_verified: 'verification_pending',
  nda_confirmation_required: 'tick_confirmation_first',
  nda_signature_too_small: 'signature_incomplete',
  rate_limited: 'rate_limit_soon',
  sa_rate_limited: 'rate_limit_soon',
  sla_rate_limited: 'rate_limit_soon',
  too_many_requests: 'rate_limit_soon',
  sa_disabled: 'feature_disabled_by_admin',
  feature_disabled: 'feature_disabled_by_admin',
  feedback_disabled: 'feature_disabled_by_admin',
  sa_reason_required: 'reason_required',
  sla_reason_required: 'reason_required',
  brd_reason_required: 'reason_required',
  nda_reason_required: 'reason_required',
  sa_team_full: 'team_full',
  sa_deadline_passed: 'expired',
  sa_too_late: 'expired',
  sa_name_locked: 'not_editable_now',
  sa_locked: 'not_editable_now',
  sla_immutable: 'not_editable_now',
  sa_immutable: 'not_editable_now',
  client_approval_required: 'pending_admin_review',
  not_verified: 'verification_pending',
  on_hold: 'on_hold',
  location_required: 'location_missing',
  policy_required: 'policy_not_accepted',
  profile_incomplete: 'profile_incomplete',
  interview_required: 'ai_interview_not_passed',
  rate_not_approved: 'rate_not_approved',
  payment_not_confirmed: 'payment_not_confirmed',
  missing_payout_details: 'missing_payout_details',
  no_bank_account: 'no_bank_account',
  minimum_payout_not_reached: 'minimum_payout_not_reached',
  ticket_closed: 'ticket_closed',
  no_consultant: 'no_consultant_assigned',
  no_consultant_assigned: 'no_consultant_assigned',
};

function rawErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; error?: unknown; details?: unknown };
    return [e.error, e.message, e.details].filter((x) => typeof x === 'string').join(' ');
  }
  return '';
}

/** The catalogue reason for a server refusal, or null when the error is not a known, actionable refusal. */
export function reasonFromError(error: unknown): BlockedReason | null {
  const raw = rawErrorText(error);
  if (!raw) return null;
  // codes are lower-case identifiers, usually the first word of the message ("sla_acceptance_required: ...")
  const tokens = raw.match(/[a-z][a-z0-9_]{2,60}/g) ?? [];
  for (const t of tokens) {
    const key = ERROR_CODE_REASONS[t];
    if (key) {
      const minutes = raw.match(/(?:retry|try again)[^0-9]{0,20}(\d{1,4})\s*(?:min|minute)/i)?.[1];
      if (key === 'rate_limit_soon' && minutes) return { key: 'rate_limit', params: { minutes: Number(minutes) } };
      return { key };
    }
  }
  if (/too many requests/i.test(raw)) return { key: 'rate_limit_soon' };
  return null;
}

/** Human text for a server refusal in the catalogue's words (null when it is not a catalogue refusal). */
export function blockedErrorText(error: unknown, lang: Lang = 'en'): string | null {
  const reason = reasonFromError(error);
  return reason ? resolveReason(reason, lang).message : null;
}

/** Every catalogue sentence and step label, for the Arabic strings list in docs and the completeness test. */
export function catalogueStrings(): Array<{ key: string; part: 'message' | 'next'; en: string; ar: string }> {
  const out: Array<{ key: string; part: 'message' | 'next'; en: string; ar: string }> = [];
  for (const [key, def] of Object.entries(BLOCKED_REASONS) as Array<[string, ReasonDef]>) {
    out.push({ key, part: 'message', ...def.message });
    if (def.next) out.push({ key, part: 'next', ...def.next });
  }
  return out;
}
