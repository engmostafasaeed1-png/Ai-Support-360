/**
 * Feature N: the versioned Consultant Service Policy.
 * The live text comes from the consultant_policy_versions table; DRAFT_POLICY_V1 is the first version (seeded by
 * docs/sql/consultant-policy.sql with exactly this text) and the fallback shown before that file is applied.
 * The rules below mirror the database functions in that file; the database is what enforces them.
 */

export type PolicyLang = 'en' | 'ar';

export interface PolicyText {
  title: string;
  summary: string;
  /** Plain text: "## " starts a section, "- " a list item, other lines are paragraphs. */
  body: string;
}

export interface PolicyVersion {
  version: number;
  effectiveAt: string | null;
  en: PolicyText;
  ar: PolicyText;
}

export const DEFAULT_POLICY_GRACE_DAYS = 7;
export const MAX_POLICY_GRACE_DAYS = 90;
export const POLICY_REMINDER_DAYS = 3;
export const DAY_MS = 86_400_000;

export const POLICY_DRAFT_NOTE_EN = 'Draft - have your lawyer review this text before relying on it.';
export const POLICY_DRAFT_NOTE_AR = 'مسودة - اطلب من محاميك مراجعة هذا النص قبل الاعتماد عليه.';

const BODY_EN = `${POLICY_DRAFT_NOTE_EN}

## 1. Answering assignment requests
- When a client or an administrator sends you an assignment request or invitation, please accept or decline within 24 hours. For Critical requests the limit is 30 minutes.
- If you have not answered, we remind you after 2 hours, 4 hours and 1 day (Critical requests: after 10, 20 and 30 minutes) by in-app notification, pop-up and e-mail.
- If there is no reply within the limit, the request is marked "No response". The client is told and may invite another consultant, open the request for bids or wait longer. The no-response is recorded for your response rate.
- Declining within the time limit counts as a response and never counts against you.
- For bid invitations, the bid deadline shown on the ticket applies instead.
- Accepting a request does not replace the agreed rate, the confidentiality agreement (NDA) or the other steps required before work starts.

## 2. Responsiveness statistics
- What we measure: requests received, answered and not answered, your response rate, and your median, average and slower (90th percentile) response times, for the last 30 days, the last 90 days and all time. Critical requests and replies to client messages are measured separately.
- Fairness: a request counts only if it arrived while you were available - inside your declared working hours and time zone, outside any period you marked as unavailable or busy, and while you were below your stated capacity. Other requests are shown to you as "not counted - outside your availability".
- Nothing about your responsiveness is shown to clients before you have at least 5 counted requests, and only when the platform has switched responsiveness display on.
- Warnings: after your 1st and your 2nd counted no-response within 30 days you receive "Warning 1 of 2" and "Warning 2 of 2". From the 3rd counted no-response within 30 days, or when your response rate is below 60 % after at least 5 counted requests, a Responsiveness indicator may be shown on your card.
- Clients see only your level (Excellent, Good, Fair, Needs improvement or New), your median response time and your response rate - never individual tickets, names or the requests you declined.
- Rating and ranking: once there is enough data, your overall displayed rating combines client reviews (85 %) with an automatically calculated responsiveness score (15 %), and the breakdown is always shown. Client star ratings are never changed. Responsiveness also has a modest weight in matching, and consultants at "Needs improvement" do not get automatic priority for Critical alerts.
- Disputes and recovery: you can dispute a counted no-response within 7 days, for example after a technical failure or a request sent outside your hours. An administrator reviews it and can void it. Statistics use a rolling 90-day window, so your indicator recovers automatically as new good responses replace old ones. There is no permanent penalty.
- The numbers above are the current platform settings. If they change materially, we publish a new version of this policy.

## 3. Working through the platform (no bypass)
- Clients you meet on AI Support 360 are introduced through the platform. Do not move a client, a ticket or follow-up work off the platform to avoid it, and do not ask clients to pay you directly. Clients pay the platform, and the platform pays you.
- Contact details (yours and the client's) are shared only after you are assigned to a ticket. Before that, do not share or ask for phone numbers, e-mail addresses, messaging accounts or links that get around this rule. Messages containing contact details may be hidden or flagged.
- Keep ticket messages, files, sessions, time records and invoices on the platform. The confidentiality agreement (NDA) you sign for each client continues to apply.

## 4. Keeping your availability up to date
- Keep your working hours, time zone, capacity and availability status current, and mark holidays and other unavailable periods in advance.
- Requests that arrive while you are marked unavailable are not counted against you. Clients and matching rely on this information, so out-of-date availability leads to requests you cannot take.

## 5. Accurate profile and honest AI interview
- Everything in your profile must be true and your own: experience, projects, certificates, education, skills, location and rate. Upload only documents you are entitled to share.
- Take the AI interview yourself. Do not get help from other people, AI tools, search engines or notes during the interview, unless the interview screen says that a specific aid is allowed.
- We may ask for proof, ask you to repeat the interview, remove a badge or suspend an account when information is found to be false or an interview was not taken honestly.

## 6. Changes to this policy
- When we publish a new version, you are asked to confirm it. If you have not confirmed it by the end of the grace period shown to you (currently 7 days from the first time we show it), you cannot accept new assignments or place new bids, and you are not shown in search, matching or Critical alerts until you confirm. Work on tickets you already have continues.
- You can always sign in, read this policy and confirm it.`;

const BODY_AR = `${POLICY_DRAFT_NOTE_AR}

## 1. الرد على طلبات الإسناد
- عندما يرسل إليك عميل أو مسؤول طلب إسناد أو دعوة، يُرجى القبول أو الرفض خلال 24 ساعة. وفي الطلبات الحرجة تكون المهلة 30 دقيقة.
- إذا لم ترد، نذكّرك بعد ساعتين و4 ساعات ويوم واحد (الطلبات الحرجة: بعد 10 و20 و30 دقيقة) عبر إشعار داخل المنصة ونافذة منبثقة وبريد إلكتروني.
- إذا لم يصل رد خلال المهلة، يُوسم الطلب بأنه "بلا رد". ويُبلَّغ العميل، ويجوز له دعوة مستشار آخر أو فتح الطلب للعروض أو الانتظار مدة أطول. ويُسجَّل عدم الرد في معدل استجابتك.
- الرفض خلال المهلة يُعد ردًا ولا يُحتسب ضدك أبدًا.
- في دعوات تقديم العروض، يسري الموعد النهائي للعروض الظاهر في التذكرة بدلًا من ذلك.
- قبول الطلب لا يغني عن السعر المتفق عليه ولا عن اتفاقية السرية (NDA) ولا عن الخطوات الأخرى اللازمة قبل بدء العمل.

## 2. إحصاءات سرعة الاستجابة
- ما نقيسه: الطلبات المستلمة، وما تم الرد عليه وما لم يُرد عليه، ومعدل استجابتك، والوسيط والمتوسط والزمن الأبطأ (المئين التسعين) لزمن الاستجابة، لآخر 30 يومًا وآخر 90 يومًا وكامل المدة. وتُقاس الطلبات الحرجة والردود على رسائل العملاء كلٌّ على حدة.
- العدالة: لا يُحتسب الطلب إلا إذا وصل وأنت متاح - ضمن ساعات العمل والمنطقة الزمنية التي حددتها، وخارج أي فترة وسمتها بأنك غير متاح أو مشغول، وقبل بلوغ الطاقة التي حددتها. وتظهر لك الطلبات الأخرى بعبارة "غير محتسب - خارج أوقات إتاحتك".
- لا يظهر للعملاء أي شيء عن سرعة استجابتك قبل أن يكون لديك 5 طلبات محتسبة على الأقل، ولا يظهر إلا إذا فعّلت المنصة عرض سرعة الاستجابة.
- التحذيرات: بعد أول وثاني حالة عدم رد محتسبة خلال 30 يومًا تتلقى "تحذير 1 من 2" و"تحذير 2 من 2". وابتداءً من الحالة الثالثة خلال 30 يومًا، أو عندما يقل معدل استجابتك عن 60 % بعد 5 طلبات محتسبة على الأقل، قد يظهر مؤشر سرعة الاستجابة على بطاقتك.
- لا يرى العملاء إلا مستواك (ممتاز أو جيد أو مقبول أو يحتاج إلى تحسين أو جديد) ووسيط زمن استجابتك ومعدل استجابتك - ولا يرون أبدًا تذاكر بعينها أو أسماء أو الطلبات التي رفضتها.
- التقييم والترتيب: عند توفر بيانات كافية، يجمع تقييمك العام المعروض بين تقييمات العملاء (85 %) ودرجة سرعة استجابة تُحسب تلقائيًا (15 %)، ويظهر التفصيل دائمًا. ولا تُغيَّر تقييمات النجوم التي يمنحها العملاء أبدًا. ولسرعة الاستجابة وزن معتدل في المطابقة، ولا يحصل المستشارون في مستوى "يحتاج إلى تحسين" على أولوية تلقائية في التنبيهات الحرجة.
- الاعتراض والتعافي: يمكنك الاعتراض على حالة عدم رد محتسبة خلال 7 أيام، مثلًا بسبب عطل تقني أو طلب أُرسل خارج ساعاتك. ويراجعه أحد المسؤولين ويمكنه إلغاؤه. وتعتمد الإحصاءات على نافذة متحركة مدتها 90 يومًا، فيتعافى مؤشرك تلقائيًا مع حلول ردود جيدة جديدة محل القديمة. ولا توجد عقوبة دائمة.
- الأرقام أعلاه هي إعدادات المنصة الحالية. وإذا تغيرت تغيرًا جوهريًا، ننشر نسخة جديدة من هذه السياسة.

## 3. العمل عبر المنصة (دون تجاوزها)
- العملاء الذين تتعرف عليهم في AI Support 360 يصلون إليك عبر المنصة. لا تنقل عميلًا أو تذكرة أو عملًا لاحقًا إلى خارج المنصة لتتجاوزها، ولا تطلب من العملاء أن يدفعوا لك مباشرة. يدفع العملاء للمنصة، والمنصة تدفع لك.
- لا تُشارك بيانات التواصل (بياناتك وبيانات العميل) إلا بعد إسنادك إلى التذكرة. وقبل ذلك لا تشارك ولا تطلب أرقام هواتف أو عناوين بريد إلكتروني أو حسابات مراسلة أو روابط تلتف على هذه القاعدة. وقد تُخفى الرسائل التي تحتوي على بيانات تواصل أو يُشار إليها.
- احتفظ برسائل التذاكر والملفات والجلسات وسجلات الوقت والفواتير على المنصة. وتظل اتفاقية السرية (NDA) التي توقعها لكل عميل سارية.

## 4. تحديث أوقات إتاحتك
- حافظ على تحديث ساعات عملك ومنطقتك الزمنية وطاقتك وحالة إتاحتك، وسجّل الإجازات وفترات عدم الإتاحة الأخرى مسبقًا.
- الطلبات التي تصل وأنت موسوم بأنك غير متاح لا تُحتسب ضدك. ويعتمد العملاء والمطابقة على هذه المعلومات، لذا فإن عدم تحديثها يؤدي إلى وصول طلبات لا تستطيع تنفيذها.

## 5. دقة الملف الشخصي ونزاهة مقابلة الذكاء الاصطناعي
- يجب أن يكون كل ما في ملفك صحيحًا ويخصك أنت: الخبرة والمشاريع والشهادات والتعليم والمهارات والموقع والسعر. ولا ترفع إلا مستندات يحق لك مشاركتها.
- أجرِ مقابلة الذكاء الاصطناعي بنفسك. ولا تستعن بأشخاص آخرين أو بأدوات ذكاء اصطناعي أو محركات بحث أو ملاحظات أثناء المقابلة، إلا إذا ذكرت شاشة المقابلة أن وسيلة معينة مسموح بها.
- يجوز لنا طلب إثبات، أو طلب إعادة المقابلة، أو سحب شارة، أو إيقاف الحساب إذا تبين أن معلومات غير صحيحة أو أن المقابلة لم تُجرَ بنزاهة.

## 6. التغييرات على هذه السياسة
- عندما ننشر نسخة جديدة، يُطلب منك تأكيدها. وإذا لم تؤكدها حتى نهاية فترة السماح المعروضة لك (حاليًا 7 أيام من أول مرة نعرضها فيها)، فلن تتمكن من قبول إسنادات جديدة أو تقديم عروض جديدة، ولن تظهر في البحث أو المطابقة أو التنبيهات الحرجة حتى تؤكدها. ويستمر العمل في التذاكر المسندة إليك حاليًا.
- يمكنك دائمًا تسجيل الدخول وقراءة هذه السياسة وتأكيدها.`;

export const DRAFT_POLICY_V1: PolicyVersion = {
  version: 1,
  effectiveAt: null,
  en: {
    title: 'Consultant Service Policy',
    summary: 'This policy explains what we expect from consultants on AI Support 360 and what you can expect from us. Please accept or decline every assignment request within 24 hours (30 minutes for Critical requests); we send reminders, and if you do not reply the client is told and may choose another consultant. We measure how quickly you respond, but only for requests that arrive while you are available; any effect on your card, rating or ranking starts only after enough data and two warnings, can be disputed within 7 days and recovers over time. Keep all client work, contact and payment on the platform, keep your availability up to date, keep your profile accurate and take the AI interview yourself, without outside help.',
    body: BODY_EN,
  },
  ar: {
    title: 'سياسة خدمة المستشار',
    summary: 'توضح هذه السياسة ما نتوقعه من المستشارين في AI Support 360 وما يمكنك أن تتوقعه منا. يُرجى قبول كل طلب إسناد أو رفضه خلال 24 ساعة (30 دقيقة للطلبات الحرجة)؛ نرسل تذكيرات، وإذا لم ترد يُبلَّغ العميل ويجوز له اختيار مستشار آخر. نقيس سرعة ردك، ولكن فقط للطلبات التي تصل وأنت متاح؛ ولا يبدأ أي أثر على بطاقتك أو تقييمك أو ترتيبك إلا بعد توفر بيانات كافية وتحذيرين، ويمكن الاعتراض خلال 7 أيام، ويتعافى المؤشر مع الوقت. احتفظ بكل عمل العملاء والتواصل والدفع على المنصة، وحدّث أوقات إتاحتك، وحافظ على دقة ملفك، وأجرِ مقابلة الذكاء الاصطناعي بنفسك دون مساعدة خارجية.',
    body: BODY_AR,
  },
};

export interface PolicyBlock { kind: 'p' | 'li' | 'note'; text: string }
export interface PolicySection { heading: string | null; blocks: PolicyBlock[] }

/** Splits a policy body into sections for display; never produces HTML. */
export function parsePolicyBody(body: string): PolicySection[] {
  const sections: PolicySection[] = [];
  let cur: PolicySection = { heading: null, blocks: [] };
  for (const raw of (body || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      if (cur.heading !== null || cur.blocks.length) sections.push(cur);
      cur = { heading: line.slice(3).trim(), blocks: [] };
    } else if (line.startsWith('- ')) cur.blocks.push({ kind: 'li', text: line.slice(2).trim() });
    else if (cur.heading === null && (line === POLICY_DRAFT_NOTE_EN || line === POLICY_DRAFT_NOTE_AR)) cur.blocks.push({ kind: 'note', text: line });
    else cur.blocks.push({ kind: 'p', text: line });
  }
  if (cur.heading !== null || cur.blocks.length) sections.push(cur);
  return sections;
}

export function policyText(v: PolicyVersion, lang: string | undefined): PolicyText {
  return lang?.startsWith('ar') ? v.ar : v.en;
}

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgement state (mirrors public.consultant_policy_state in docs/sql/consultant-policy.sql).

export type PolicyState = 'none' | 'accepted' | 'pending' | 'grace' | 'blocked';

export interface PolicyStateInput {
  currentVersion: number | null;
  acceptedVersion: number | null;
  /** First time this version was shown to the consultant (pop-up, registration step or e-mail). */
  firstShownAt: string | null;
  graceDays: number | null;
  now: number;
}

export interface PolicyStatus {
  state: PolicyState;
  deadline: string | null;
  /** "Remind me later" is offered only inside the grace period. */
  canSnooze: boolean;
}

export function clampGraceDays(days: number | null | undefined): number {
  if (days === null || days === undefined) return DEFAULT_POLICY_GRACE_DAYS;
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_POLICY_GRACE_DAYS;
  return Math.min(MAX_POLICY_GRACE_DAYS, Math.max(0, Math.trunc(n)));
}

export function policyState(i: PolicyStateInput): PolicyStatus {
  if (!i.currentVersion) return { state: 'none', deadline: null, canSnooze: false };
  if (i.acceptedVersion != null && i.acceptedVersion >= i.currentVersion) return { state: 'accepted', deadline: null, canSnooze: false };
  const first = i.firstShownAt ? Date.parse(i.firstShownAt) : NaN;
  if (!Number.isFinite(first)) return { state: 'pending', deadline: null, canSnooze: true };
  const deadline = first + clampGraceDays(i.graceDays) * DAY_MS;
  const iso = new Date(deadline).toISOString();
  return i.now < deadline ? { state: 'grace', deadline: iso, canSnooze: true } : { state: 'blocked', deadline: iso, canSnooze: false };
}

export function needsAcknowledgement(state: PolicyState): boolean {
  return state === 'pending' || state === 'grace' || state === 'blocked';
}

/**
 * The pop-up opens once per sign-in session while an acknowledgement is outstanding. "Remind me later" (or closing it)
 * hides it until the next sign-in; it never opens on the profile page, where the same step is shown inline.
 */
export function shouldShowPolicyPopup(i: { state: PolicyState; handledThisSession: boolean; onInlinePage: boolean }): boolean {
  return needsAcknowledgement(i.state) && !i.handledThisSession && !i.onInlinePage;
}

export function policyPopupKey(sessionId: string | null, version: number): string | null {
  return sessionId ? `consultant-policy-popup:${sessionId}:v${version}` : null;
}

/** A consultant who signed up after the version took effect meets it at registration ("new"), others by pop-up ("updated"). */
export function isNewConsultant(signedUpAt: string | null | undefined, effectiveAt: string | null | undefined): boolean {
  if (!signedUpAt || !effectiveAt) return false;
  return Date.parse(signedUpAt) >= Date.parse(effectiveAt);
}
