/**
 * Feature N: wording of the Consultant Service Policy notice e-mail (EN/AR). Pure TypeScript, shared by the template
 * and tests. The in-app notification text lives in the claim RPC (docs/sql/consultant-policy.sql).
 */
export interface PolicyNoticeProps {
  lang?: 'en' | 'ar'
  kind?: 'notice' | 'reminder' | 'manual' | string
  name?: string
  version?: number
  title?: string
  summary?: string
  /** Already formatted for the reader. */
  deadline?: string
  confirmUrl?: string
  policyUrl?: string
}

export const POLICY_NOTICE_STR = {
  en: {
    subject: (kind?: string) => kind === 'notice' ? 'Please confirm our updated service policy' : 'Reminder: please confirm our updated service policy',
    hello: (name?: string) => name ? `Hello ${name},` : 'Hello,',
    intro: (v: number) => `We have published version ${v} of the Consultant Service Policy. Please read it and confirm it in your portal - it takes a minute.`,
    summary: 'Summary',
    deadline: (d: string) => `Please confirm by ${d}. After that, until you confirm, you cannot accept new assignments or place new bids, and you are not shown in search, matching or Critical alerts. Your current tickets continue and you can always sign in and confirm.`,
    noDeadline: 'Until you confirm, after the grace period you cannot accept new assignments or place new bids. Your current tickets continue.',
    button: 'Read and confirm',
    full: 'Full, printable policy:',
  },
  ar: {
    subject: (kind?: string) => kind === 'notice' ? 'يُرجى تأكيد سياستنا المحدَّثة للخدمة' : 'تذكير: يُرجى تأكيد سياستنا المحدَّثة للخدمة',
    hello: (name?: string) => name ? `مرحبًا ${name}،` : 'مرحبًا،',
    intro: (v: number) => `نشرنا الإصدار ${v} من سياسة خدمة المستشار. يُرجى قراءتها وتأكيدها في بوابتك - لن يستغرق ذلك سوى دقيقة.`,
    summary: 'الملخص',
    deadline: (d: string) => `يُرجى التأكيد قبل ${d}. بعد ذلك، وحتى تؤكد، لن تتمكن من قبول إسنادات جديدة أو تقديم عروض جديدة، ولن تظهر في البحث أو المطابقة أو التنبيهات الحرجة. يستمر العمل في تذاكرك الحالية ويمكنك دائمًا تسجيل الدخول والتأكيد.`,
    noDeadline: 'إلى أن تؤكد، وبعد انتهاء فترة السماح، لن تتمكن من قبول إسنادات جديدة أو تقديم عروض جديدة. يستمر العمل في تذاكرك الحالية.',
    button: 'اقرأ وأكّد',
    full: 'السياسة كاملة وقابلة للطباعة:',
  },
}

export function policyNoticeLang(lang?: string): 'en' | 'ar' {
  return lang === 'ar' ? 'ar' : 'en'
}

/** Formats a deadline for the reader (Gregorian calendar, Riyadh time). */
export function formatPolicyDeadline(iso: string | null | undefined, lang: 'en' | 'ar'): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleDateString(lang === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' })
}
