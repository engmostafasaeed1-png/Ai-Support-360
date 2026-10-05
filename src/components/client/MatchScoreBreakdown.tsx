import { useTranslation } from 'react-i18next';

export type MatchCriterion = { key: string; weight: number; score: number; contribution: number };

const labels: Record<string, [string, string]> = {
  skill_match_score: ['Skills, modules & technologies', 'المهارات والوحدات والتقنيات'],
  experience_score: ['CV, experience & similar issues', 'السيرة الذاتية والخبرة والمشكلات المشابهة'],
  interview_score: ['Skills assessment', 'تقييم المهارات'],
  availability_score: ['Availability & response', 'التوفر والاستجابة'],
  reliability_score: ['Reliability', 'الموثوقية'],
  satisfaction_score: ['Client satisfaction', 'رضا العملاء'],
  language_score: ['Language fit', 'توافق اللغة'],
  trust_score: ['Verification & trust', 'التحقق والثقة'],
};

export default function MatchScoreBreakdown({ breakdown }: { breakdown?: MatchCriterion[] }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  if (!breakdown?.length) return null;
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-primary">{ar ? 'تفاصيل نسبة التطابق' : 'Match score breakdown'}</summary>
      <p className="mt-2">{ar ? 'درجة ملاءمة تقديرية، وليست ضماناً لنجاح الحل.' : 'Estimated suitability, not a guarantee of resolution.'}</p>
      <dl className="mt-2 space-y-2">
        {breakdown.map(item => (
          <div key={item.key} className="flex flex-wrap justify-between gap-1 border-b border-border pb-1">
            <dt>{labels[item.key]?.[ar ? 1 : 0] || item.key} · {ar ? 'الوزن' : 'weight'} {item.weight}%</dt>
            <dd className="font-medium text-foreground">{item.score}/100 · {item.contribution.toFixed(1)} {ar ? 'نقطة' : 'points'}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}