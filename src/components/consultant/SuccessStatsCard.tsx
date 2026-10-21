import { Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConsultantRingSummary } from '@/components/consultant/ConsultantRing';
import { useSuccessConfig } from '@/hooks/useSuccessStats';
import { cn } from '@/lib/utils';
import {
  successColor, successGradient, successLabel, successLines, successProgressText, SUCCESS_VARS, type SuccessView,
} from '@/lib/successLevel';

const T = {
  en: { title: 'Requests and success', requests: 'Requests', solved: 'Solved', notSolved: 'Not solved', rate: 'Success rate', level: 'Level', new: 'New', none: 'No level yet' },
  ar: { title: 'الطلبات والنجاح', requests: 'الطلبات', solved: 'المحلولة', notSolved: 'غير المحلولة', rate: 'نسبة النجاح', level: 'المستوى', new: 'جديد', none: 'لا يوجد مستوى بعد' },
};

/** Pure presenter (tested): five numbers, the level and the honest distance to the next level. */
export function SuccessStatsView({ view, lang = 'en', className }: { view: SuccessView; lang?: 'en' | 'ar'; className?: string }) {
  const { settings } = useSuccessConfig();
  if (view.state === 'hidden') return null;
  const s = lang === 'ar' ? T.ar : T.en;
  const pct = view.pct == null ? '–' : lang === 'ar' ? `${view.pct} ٪` : `${view.pct} %`;
  const level = view.level ? successLabel(view.level, lang) : view.state === 'new' ? s.new : s.none;
  const progress = successProgressText(view.progress, lang);
  const lines = successLines(view, lang, settings);
  const items: Array<[string, string | number]> = [[s.requests, view.total], [s.solved, view.solved], [s.notSolved, view.notSolved], [s.rate, pct], [s.level, level]];
  return (
    <section aria-labelledby="success-stats-title" data-testid="success-stats-card" data-state={view.state} dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className={cn('rounded-2xl border border-border/60 bg-card p-4 shadow-sm', className)}
      style={view.level ? { borderColor: `hsl(var(${SUCCESS_VARS[view.level][0]}) / 0.5)` } : undefined}>
      <h2 id="success-stats-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center rounded-full', view.level === 'platinum' && 'ring-medal-shine')}
          style={{ background: view.level ? successGradient(view.level) : 'hsl(var(--muted))' }}>
          <Trophy className="h-3.5 w-3.5 text-card" style={view.level ? undefined : { color: 'hsl(var(--muted-foreground))' }} />
        </span>
        {s.title}
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-bold text-foreground" style={label === s.level && view.level ? { color: successColor(view.level) } : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      {view.state === 'ok' && view.pct != null && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${view.pct}%`, background: successGradient(view.level!, 90) }} />
        </div>
      )}
      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {lines.map((l) => <li key={l}>{l}</li>)}
        {progress && <li className="font-medium text-foreground" data-testid="success-progress">{progress}</li>}
      </ul>
    </section>
  );
}

/** Profile header card for one consultant, from the same numbers as the ring. */
export default function SuccessStatsCard({ consultantId, className }: { consultantId?: string | null; className?: string }) {
  const { i18n } = useTranslation();
  const summary = useConsultantRingSummary({ consultantId });
  return <SuccessStatsView view={summary.success} lang={i18n?.language?.startsWith('ar') ? 'ar' : 'en'} className={className} />;
}
