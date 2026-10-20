/**
 * Feature M: wording of the consultant notices (popup and e-mail share it), EN/AR.
 * Pure TypeScript so the portal popup and the e-mail template say the same thing.
 */
export interface NoticeProps {
  lang?: 'en' | 'ar'
  kind?: string
  ticketTitle?: string
  count30?: number
  warningsTotal?: number
  disputeDays?: number
  pageUrl?: string
}

export const NOTICE_STR = {
  en: {
    // Owner rule: polite notifications, never the word "warning".
    warningTitle: (k: number, n: number) => `Friendly notice ${k} of ${n}: a request was not answered in time`,
    warningBody: (t: string, k: number, n: number) => `We noticed that "${t}" was not answered within the time limit, so it is included in your response rate. This is friendly notice ${k} of ${n}. If more requests go unanswered, a Responsiveness indicator may appear on your card and your ranking may be affected. Thank you for accepting or declining each request in time.`,
    badgeTitle: 'Your Responsiveness indicator is now shown',
    badgeBody: (t: string, c: number) => `We noticed that "${t}" was not answered within the time limit. As this is unanswered request number ${c} in 30 days, your card may now show "Needs improvement" for responsiveness and your ranking may be affected. It improves automatically as you answer new requests in time, and we are happy to help.`,
    countedTitle: 'A request was not answered in time',
    countedBody: (t: string, c: number) => `We noticed that "${t}" was not answered within the time limit, so it is included in your response rate (${c} in the last 30 days).`,
    notCountedTitle: 'A request was not answered (not counted)',
    notCountedBody: (t: string) => `"${t}" was not answered within the time limit, but it arrived outside your availability, so it is not included in your response rate. No action is needed.`,
    upheldTitle: 'Dispute accepted',
    upheldBody: (t: string) => `The no-response on "${t}" was removed from your statistics.`,
    rejectedTitle: 'Dispute not accepted',
    rejectedBody: (t: string) => `After review, the no-response on "${t}" still counts. Thank you for your understanding.`,
    dispute: (d: number) => `If it was not your fault (for example a technical failure, or the request came outside your stated hours), you are welcome to dispute it within ${d} days on your My responsiveness page.`,
    improve: 'How to keep a good responsiveness: accept or decline every request within the time limit (a decline counts as a response), keep your availability up to date and mark vacations in advance.',
    button: 'Open My responsiveness',
    fallbackTitle: 'a request',
  },
  ar: {
    warningTitle: (k: number, n: number) => `إشعار ودي ${k} من ${n}: طلب لم يُرد عليه في الوقت`,
    warningBody: (t: string, k: number, n: number) => `لاحظنا أن الطلب "${t}" لم يُرد عليه خلال المهلة المحددة، لذا يُحتسب ضمن نسبة استجابتك. هذا الإشعار الودي ${k} من ${n}. إذا تكرر عدم الرد فقد يظهر مؤشر الاستجابة على بطاقتك وقد يتأثر ترتيبك. شكراً لقبولك أو رفضك كل طلب في الوقت.`,
    badgeTitle: 'أصبح مؤشر الاستجابة ظاهراً على بطاقتك',
    badgeBody: (t: string, c: number) => `لاحظنا أن الطلب "${t}" لم يُرد عليه خلال المهلة المحددة. وبما أن هذا الطلب رقم ${c} دون رد خلال 30 يوماً، فقد تُظهر بطاقتك الآن مستوى "يحتاج إلى تحسين" للاستجابة وقد يتأثر ترتيبك. يتحسن المؤشر تلقائياً عندما ترد على الطلبات الجديدة في الوقت، ويسعدنا مساعدتك.`,
    countedTitle: 'طلب لم يُرد عليه في الوقت',
    countedBody: (t: string, c: number) => `لاحظنا أن الطلب "${t}" لم يُرد عليه خلال المهلة المحددة، لذا يُحتسب ضمن نسبة استجابتك (${c} خلال آخر 30 يوماً).`,
    notCountedTitle: 'طلب لم يُرد عليه (غير محتسب)',
    notCountedBody: (t: string) => `لم يُرد على الطلب "${t}" خلال المهلة، لكنه وصل خارج أوقات توفرك، لذلك لا يُحتسب في نسبة استجابتك. لا يلزم أي إجراء.`,
    upheldTitle: 'تم قبول اعتراضك',
    upheldBody: (t: string) => `أُزيل عدم الرد على "${t}" من إحصاءاتك.`,
    rejectedTitle: 'لم يُقبل اعتراضك',
    rejectedBody: (t: string) => `بعد المراجعة، لا يزال عدم الرد على "${t}" محتسباً. شكراً لتفهمك.`,
    dispute: (d: number) => `إذا لم يكن ذلك بسببك (مثل عطل تقني، أو وصول الطلب خارج ساعاتك المعلنة)، يسعدنا استلام اعتراضك خلال ${d} أيام من صفحة "استجابتي".`,
    improve: 'للحفاظ على استجابة جيدة: اقبل أو ارفض كل طلب خلال المهلة (الرفض يُحتسب رداً)، وحدّث أوقات توفرك، وسجّل إجازاتك مسبقاً.',
    button: 'افتح صفحة استجابتي',
    fallbackTitle: 'طلب',
  },
} as const

export function noticeCopy(d: NoticeProps): { title: string; body: string; showDispute: boolean } {
  const l = d.lang === 'ar' ? 'ar' : 'en'
  const t = NOTICE_STR[l]
  const title = (d.ticketTitle || t.fallbackTitle).slice(0, 120)
  const n = Math.max(1, Number(d.warningsTotal) || 2)
  const c = Math.max(1, Number(d.count30) || 1)
  const kind = String(d.kind || 'counted')
  const m = /^warning_(\d)$/.exec(kind)
  if (m) return { title: t.warningTitle(Number(m[1]), n), body: t.warningBody(title, Number(m[1]), n), showDispute: true }
  switch (kind) {
    case 'badge_visible': return { title: t.badgeTitle, body: t.badgeBody(title, c), showDispute: true }
    case 'not_counted': return { title: t.notCountedTitle, body: t.notCountedBody(title), showDispute: false }
    case 'dispute_upheld': return { title: t.upheldTitle, body: t.upheldBody(title), showDispute: false }
    case 'dispute_rejected': return { title: t.rejectedTitle, body: t.rejectedBody(title), showDispute: false }
    default: return { title: t.countedTitle, body: t.countedBody(title, c), showDispute: true }
  }
}

