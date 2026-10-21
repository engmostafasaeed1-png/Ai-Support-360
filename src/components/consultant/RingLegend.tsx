import { Info, Shield, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toneGradient, type RingTone } from '@/lib/ringAvatar';
import { SUCCESS_DEFAULTS, SUCCESS_LEVELS, type SuccessSettings } from '@/lib/successLevel';
import { LevelStars } from './SuccessStars';

const T = {
  en: {
    open: 'How to read the ring', title: 'How to read the ring',
    outer: 'Outer ring: client reviews (rating out of 5)',
    inner: 'Inner ring: responsiveness to requests (only when shown publicly)',
    review: 'One outlined yellow star with a number: client reviews, e.g. "4.8 (23)"',
    stars: 'Rosette with 4 level stars next to the name: Success level (solved of finished requests), e.g. "Success: Gold" = 3 of 4 stars',
    corner: 'Shield chip (top corner): AI interview level, e.g. "AI Interview: Gold"',
    scale: 'Rating colours', dotted: 'Dotted: fewer than 3 reviews. Faint ring only: New.',
    steps: ['Below 3.0', '3.0 – 3.9', '4.0 – 4.5', '4.6 and up'],
    success: 'Success levels',
    levels: (s: SuccessSettings) => [`Success: Bronze, 1 star, from ${s.bronze} %`, `Success: Silver, 2 stars, from ${s.silver} %`, `Success: Gold, 3 stars, from ${s.gold} %`, `Success: Platinum, 4 stars, at ${s.platinum} % (every request solved)`],
    min: (s: SuccessSettings) => `A Success level shows after ${s.min_requests} finished requests; before that "New" and the plain counts. Below ${s.bronze} % only the counts show.`,
  },
  ar: {
    open: 'كيف تقرأ الحلقة', title: 'كيف تقرأ الحلقة',
    outer: 'الحلقة الخارجية: تقييمات العملاء (من 5)',
    inner: 'الحلقة الداخلية: سرعة الاستجابة للطلبات (عند عرضها للعموم فقط)',
    review: 'نجمة صفراء واحدة مفرغة مع رقم: تقييمات العملاء، مثل "4.8 (23)"',
    stars: 'وردة مع 4 نجوم مستوى بجانب الاسم: مستوى النجاح (الطلبات المحلولة من المنتهية)، مثل "النجاح: ذهبي" = 3 من 4 نجوم',
    corner: 'شارة الدرع (الزاوية العليا): مستوى المقابلة بالذكاء الاصطناعي، مثل "مقابلة الذكاء الاصطناعي: ذهبية"',
    scale: 'ألوان التقييم', dotted: 'منقّطة: أقل من 3 تقييمات. حلقة باهتة فقط: جديد.',
    steps: ['أقل من 3.0', '3.0 – 3.9', '4.0 – 4.5', '4.6 فأكثر'],
    success: 'مستويات النجاح',
    levels: (s: SuccessSettings) => [`النجاح: برونزي، نجمة واحدة، من ${s.bronze} ٪`, `النجاح: فضي، نجمتان، من ${s.silver} ٪`, `النجاح: ذهبي، 3 نجوم، من ${s.gold} ٪`, `النجاح: بلاتيني، 4 نجوم، عند ${s.platinum} ٪ (حل جميع الطلبات)`],
    min: (s: SuccessSettings) => `يظهر مستوى النجاح بعد ${s.min_requests} طلبات منتهية؛ وقبل ذلك "جديد" مع الأعداد فقط. وأقل من ${s.bronze} ٪ تظهر الأعداد فقط.`,
  },
};
const TONES: RingTone[] = ['red', 'amber', 'green', 'gold'];

/** (i) help next to the profile header pills: both arcs, the review star vs the Success level stars, the AI shield and the colour scales. */
export default function RingLegend({ success = true, settings = SUCCESS_DEFAULTS }: { success?: boolean; settings?: SuccessSettings }) {
  const { i18n } = useTranslation();
  const s = i18n?.language?.startsWith('ar') ? T.ar : T.en;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={s.open} data-testid="ring-legend"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" dir="auto" data-testid="ring-legend-content">
        <p className="mb-2 font-semibold">{s.title}</p>
        <ul className="space-y-1.5 text-xs">
          <li>{s.outer}</li>
          <li>{s.inner}</li>
          <li className="flex items-start gap-1.5"><Star className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--review-star))', fill: 'none' }} strokeWidth={2.4} aria-hidden="true" />{s.review}</li>
          {success && <li className="flex items-start gap-1.5"><LevelStars level="gold" size={11} className="mt-0.5" />{s.stars}</li>}
          <li className="flex items-start gap-1.5"><Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-badge-gold" aria-hidden="true" />{s.corner}</li>
        </ul>
        <p className="mb-1.5 mt-3 text-xs font-semibold">{s.scale}</p>
        <ul className="grid grid-cols-2 gap-1.5 text-xs">
          {TONES.map((tone, i) => (
            <li key={tone} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-6 rounded-full" style={{ background: toneGradient(tone, 90) }} />
              {s.steps[i]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{s.dotted}</p>
        {success && (
          <>
            <p className="mb-1.5 mt-3 text-xs font-semibold">{s.success}</p>
            <ul className="space-y-1 text-xs" data-testid="ring-legend-success">
              {SUCCESS_LEVELS.map((lv, i) => (
                <li key={lv} className="flex items-center gap-1.5">
                  <LevelStars level={lv} size={11} />
                  {s.levels(settings)[i]}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{s.min(settings)}</p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
