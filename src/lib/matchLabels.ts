import type { ClarifyKey, CriterionKey } from '../../supabase/functions/_shared/ticketMatch';

/** EN/AR labels for every ranking criterion (same keys as the matching service). */
export const CRITERION_LABELS: Record<CriterionKey, [string, string]> = {
  module: ['SAP module match', 'تطابق وحدة SAP'],
  sub_module: ['Sub-module match', 'تطابق الوحدة الفرعية'],
  keywords: ['Details in the description', 'تفاصيل في الوصف'],
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
    default: return text;
  }
}

export const QUESTION_LABELS: Record<ClarifyKey, { q: [string, string]; hint: [string, string] }> = {
  module: { q: ['Which SAP module or area is this about?', 'ما وحدة أو مجال SAP المعني؟'], hint: ['e.g. FI, MM, SD, Basis, SuccessFactors', 'مثال: FI أو MM أو SD أو Basis أو SuccessFactors'] },
  error: { q: ['What error message or transaction do you see?', 'ما رسالة الخطأ أو رمز المعاملة الذي يظهر لك؟'], hint: ['e.g. "F5 702" or FB50', 'مثال: "F5 702" أو FB50'] },
  country: { q: ['Which country or localization is affected?', 'ما الدولة أو التوطين المتأثر؟'], hint: ['e.g. Saudi Arabia', 'مثال: المملكة العربية السعودية'] },
};
