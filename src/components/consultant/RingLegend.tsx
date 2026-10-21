import { Info, Shield, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toneGradient, type RingTone } from '@/lib/ringAvatar';
import { successGradient, SUCCESS_DEFAULTS, SUCCESS_LEVELS, type SuccessSettings } from '@/lib/successLevel';

const T = {
  en: {
    open: 'How to read the ring', title: 'How to read the ring',
    outer: 'Outer ring: client reviews (rating out of 5)',
    inner: 'Inner ring: responsiveness to requests (only when shown publicly)',
    band: 'Thin outer band: success rate (solved of finished requests), coloured by the Success level',
    corner: 'Shield chip (top corner): AI interview level, e.g. "AI Interview: Gold"',
    medal: 'Trophy chip (bottom corner): Success level, e.g. "Success: Platinum"',
    scale: 'Rating colours', dotted: 'Dotted: fewer than 3 reviews. Faint ring only: New.',
    steps: ['Below 3.0', '3.0 – 3.9', '4.0 – 4.5', '4.6 and up'],
    success: 'Success levels',
    levels: (s: SuccessSettings) => [`Success: Bronze from ${s.bronze} %`, `Success: Silver from ${s.silver} %`, `Success: Gold from ${s.gold} %`, `Success: Platinum at ${s.platinum} % (every request solved)`],
    min: (s: SuccessSettings) => `A Success level shows after ${s.min_requests} finished requests; before that "New" and the plain counts. Below ${s.bronze} % only the counts show.`,
  },
  ar: {
    open: 'كيف تقرأ الحلقة', title: 'كيف تقرأ الحلقة',
    outer: 'الحلقة الخارجية: تقييمات العملاء (من 5)',
    inner: 'الحلقة الداخلية: سرعة الاستجابة للطلبات (عند عرضها للعموم فقط)',
    band: 'الشريط الخارجي الرفيع: نسبة النجاح (الطلبات المحلولة من المنتهية)، بلون مستوى النجاح',
    corner: 'شارة الدرع (الزاوية العليا): مستوى المقابلة بالذكاء الاصطناعي، مثل "مقابلة الذكاء الاصطناعي: ذهبية"',
    medal: 'شارة الكأس (الزاوية السفلى): مستوى النجاح، مثل "النجاح: بلاتيني"',
    scale: 'ألوان التقييم', dotted: 'منقّطة: أقل من 3 تقييمات. حلقة باهتة فقط: جديد.',
    steps: ['أقل من 3.0', '3.0 – 3.9', '4.0 – 4.5', '4.6 فأكثر'],
    success: 'مستويات النجاح',
    levels: (s: SuccessSettings) => [`النجاح: برونزي من ${s.bronze} ٪`, `النجاح: فضي من ${s.silver} ٪`, `النجاح: ذهبي من ${s.gold} ٪`, `النجاح: بلاتيني عند ${s.platinum} ٪ (حل جميع الطلبات)`],
    min: (s: SuccessSettings) => `يظهر مستوى النجاح بعد ${s.min_requests} طلبات منتهية؛ وقبل ذلك "جديد" مع الأعداد فقط. وأقل من ${s.bronze} ٪ تظهر الأعداد فقط.`,
  },
};
const TONES: RingTone[] = ['red', 'amber', 'green', 'gold'];

/** (i) help next to the profile header pills: both arcs, the success band, the two chips and the colour scales. */
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
          {success && <li>{s.band}</li>}
          <li className="flex items-start gap-1.5"><Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-badge-gold" aria-hidden="true" />{s.corner}</li>
          {success && <li className="flex items-start gap-1.5"><Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'hsl(var(--success-gold-a))' }} aria-hidden="true" />{s.medal}</li>}
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
                  <span aria-hidden="true" className="h-2.5 w-6 rounded-full" style={{ background: successGradient(lv, 90) }} />
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
