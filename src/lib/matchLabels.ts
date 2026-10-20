import type { ClarifyKey, CriterionKey } from '../../supabase/functions/_shared/ticketMatch';
import type { MatchedIn } from '../../supabase/functions/_shared/profileText';

/** EN/AR labels for every ranking criterion (same keys as the matching service). */
export const CRITERION_LABELS: Record<CriterionKey, [string, string]> = {
  module: ['SAP module match', 'تطابق وحدة SAP'],
  sub_module: ['Sub-module match', 'تطابق الوحدة الفرعية'],
  keywords: ['Details in the description', 'تفاصيل في الوصف'],
  profile_text: ['Ticket words found in the profile', 'كلمات الطلب في ملف المستشار'],
  experience: ['Years of experience', 'سنوات الخبرة'],
  role: ['Role (functional / technical / basis)', 'الدور (وظيفي / تقني / بيسس)'],
  industry: ['Industry', 'القطاع'],
  segment: ['Customer segment', 'شريحة العملاء'],
  country: ['Country / localization', 'الدولة / التوطين'],
  deployment: ['Deployment', 'نوع النشر'],
  work_mode: ['Work mode', 'نمط العمل'],
  timezone: ['Time zone overlap', 'تداخل المنطقة الزمنية'],
  rate: ['Rate within budget', 'السعر ضمن الميزانية'],
  badge: ['AI interview badge', 'شارة المقابلة الذكية'],
  rating: ['Rating', 'التقييم'],
  response: ['Response time', 'سرعة الرد'],
  availability: ['Availability', 'التوفر'],
  completion: ['Profile completion', 'اكتمال الملف'],
  evidence: ['Evidence-backed claims', 'ادعاءات مدعومة بإثبات'],
  founding: ['Founding Consultant', 'مستشار مؤسس'],
};

/** Short prefix shown before a chip's value, so "FB50" reads "T-code FB50" and "gold" reads "Gold badge". */
export function chipText(key: CriterionKey, text: string, ar: boolean): string {
  const tier = text.charAt(0).toUpperCase() + text.slice(1);
  switch (key) {
    case 'badge': return ar ? `شارة ${tier}` : `${tier} badge`;
    case 'rating': return ar ? `تقييم ${text}` : `Rated ${text}`;
    case 'response': return ar ? `يرد خلال ${text} دقيقة` : `Replies within ${text} min`;
    case 'availability': return ar ? 'متاح الآن' : 'Available now';
    case 'timezone': return ar ? 'منطقة زمنية متقاربة' : 'Time zone overlap';
    case 'rate': return ar ? 'ضمن الميزانية' : 'Within budget';
    case 'experience': return ar ? `خبرة ${text.replace(/\s*yrs?/, '')} سنة` : text.replace(/yrs?/, 'years');
    case 'evidence': return ar ? `${text} موثّق` : `${text} verified`;
    case 'founding': return ar ? 'مستشار مؤسس' : 'Founding Consultant';
    case 'profile_text': return ar ? `الملف يذكر ${text}` : `Profile mentions ${text}`;
    default: return text;
  }
}

export const QUESTION_LABELS: Record<ClarifyKey, { q: [string, string]; hint: [string, string] }> = {
  module: { q: ['Which SAP module or area is this about?', 'ما وحدة أو مجال SAP المعني؟'], hint: ['e.g. FI, MM, SD, Basis, SuccessFactors', 'مثال: FI أو MM أو SD أو Basis أو SuccessFactors'] },
  error: { q: ['What error message or transaction do you see?', 'ما رسالة الخطأ أو رمز المعاملة الذي يظهر لك؟'], hint: ['e.g. "F5 702" or FB50', 'مثال: "F5 702" أو FB50'] },
  country: { q: ['Which country or localization is affected?', 'ما الدولة أو التوطين المتأثر؟'], hint: ['e.g. Saudi Arabia', 'مثال: المملكة العربية السعودية'] },
};

const IN_LABELS: Record<MatchedIn, { en: [string, string] | string; ar: [string, string] | string }> = {
  certificate: { en: ['certificate', 'certificates'], ar: ['شهادة', 'شهادات'] },
  solved: { en: ['solved request', 'solved requests'], ar: ['طلب محلول', 'طلبات محلولة'] },
  project: { en: ['project', 'projects'], ar: ['مشروع', 'مشاريع'] },
  work_history: { en: ['job', 'jobs'], ar: ['وظيفة', 'وظائف'] },
  skill: { en: 'skills', ar: 'المهارات' },
  bio: { en: 'profile summary', ar: 'نبذة الملف' },
  review: { en: ['client review', 'client reviews'], ar: ['تقييم عميل', 'تقييمات عملاء'] },
  education: { en: 'education', ar: 'التعليم' },
};
const IN_ORDER: MatchedIn[] = ['certificate', 'solved', 'project', 'work_history', 'skill', 'bio', 'review', 'education'];

/** "Matched in: 2 projects, 1 certificate, skills" (counts only, never the profile text). */
export function matchedInText(counts: Partial<Record<MatchedIn, number>> | null | undefined, ar: boolean): string {
  const parts = IN_ORDER.filter((k) => (counts?.[k] ?? 0) > 0).map((k) => {
    const l = IN_LABELS[k][ar ? 'ar' : 'en'];
    const n = counts![k]!;
    return typeof l === 'string' ? l : `${n} ${n === 1 ? l[0] : l[1]}`;
  });
  return parts.length ? `${ar ? 'وُجدت في: ' : 'Matched in: '}${parts.join(ar ? '، ' : ', ')}` : '';
}
