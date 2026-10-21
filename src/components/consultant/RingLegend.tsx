import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toneGradient, type RingTone } from '@/lib/ringAvatar';

const T = {
  en: {
    open: 'How to read the ring', title: 'How to read the ring',
    outer: 'Outer ring: client reviews (rating out of 5)',
    inner: 'Inner ring: responsiveness to requests (only when shown publicly)',
    corner: 'Corner badge: AI interview level (Gold, Silver, Bronze, Verified)',
    scale: 'Colour scale', dotted: 'Dotted: fewer than 3 reviews. Faint ring only: New.',
    steps: ['Below 3.0', '3.0 – 3.9', '4.0 – 4.5', '4.6 and up'],
  },
  ar: {
    open: 'كيف تقرأ الحلقة', title: 'كيف تقرأ الحلقة',
    outer: 'الحلقة الخارجية: تقييمات العملاء (من 5)',
    inner: 'الحلقة الداخلية: سرعة الاستجابة للطلبات (عند عرضها للعموم فقط)',
    corner: 'شارة الزاوية: مستوى المقابلة بالذكاء الاصطناعي (ذهبية، فضية، برونزية، موثّق)',
    scale: 'مقياس الألوان', dotted: 'منقّطة: أقل من 3 تقييمات. حلقة باهتة فقط: جديد.',
    steps: ['أقل من 3.0', '3.0 – 3.9', '4.0 – 4.5', '4.6 فأكثر'],
  },
};
const TONES: RingTone[] = ['red', 'amber', 'green', 'gold'];

/** (i) help next to the profile header pills: explains both arcs, the corner badge and the colour scale. */
export default function RingLegend() {
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
          <li>{s.corner}</li>
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
      </PopoverContent>
    </Popover>
  );
}
