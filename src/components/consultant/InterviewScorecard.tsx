import { lazy, Suspense, Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { COMPETENCIES } from '../../../supabase/functions/_shared/interviewCoverage';
import { RUBRIC_KEYS, type QuestionScore, type CompetencyScores } from '../../../supabase/functions/_shared/interviewEvaluation';
const Charts = lazy(() => import('./InterviewScorecardCharts'));
class ChartFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
export default function InterviewScorecard({ questions, competencies, answers, retry, busy, onRetry }: { questions: QuestionScore[]; competencies: CompetencyScores | null; answers: string[]; retry: boolean; busy: boolean; onRetry: () => void }) {
  const { t, i18n } = useTranslation();
  return <section dir={i18n.dir()} className="space-y-5 min-w-0 text-foreground">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{t('interview.scorecard.title')}</h3>{retry && <Button variant="outline" size="sm" busy={busy} onClick={onRetry}><RefreshCw className="h-4 w-4 me-2"/>{t('interview.scorecard.retry')}</Button>}</div>
    {retry && <p role="status" className="text-sm text-muted-foreground">{t('interview.scorecard.partial')}</p>}
    <ChartFallback><Suspense fallback={null}><Charts questions={questions} competencies={competencies}/></Suspense></ChartFallback>
    <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-start font-medium pb-2">{t('interview.scorecard.rubric')}</caption><thead><tr><th className="text-start p-2">{t('interview.scorecard.answer')}</th>{RUBRIC_KEYS.map(k => <th className="p-2" key={k}>{t(`interview.scorecard.${k}`)}</th>)}</tr></thead><tbody>{questions.map(q => <tr key={q.question_index} className="border-t border-border"><th className="text-start p-2">{q.question_index}</th>{RUBRIC_KEYS.map(k => <td className="text-center p-2" key={k}>{q.rubric[k]}/5</td>)}</tr>)}</tbody></table></div>
    {competencies && <dl className="grid grid-cols-2 gap-3 text-sm">{COMPETENCIES.map(k => <div key={k}><dt className="text-muted-foreground">{t(`interview.scorecard.${k}`)}</dt><dd className="font-semibold">{competencies[k]}/100</dd></div>)}</dl>}
    {questions.map(q => <details key={q.question_index} className="border-t border-border pt-4"><summary className="cursor-pointer font-medium">{t('interview.scorecard.comparison', { number: q.question_index })}</summary><div className="grid gap-4 mt-4 md:grid-cols-2 text-sm break-words"><div><h4 className="font-semibold mb-2">{t('interview.scorecard.your_answer')}</h4><p className="whitespace-pre-wrap" dir="auto">{answers[q.question_index - 1]}</p></div><div><h4 className="font-semibold mb-2">{t('interview.scorecard.stronger_answer')}</h4><p dir="auto">{q.ideal_answer}</p></div><div><h4 className="font-semibold">{t('interview.scorecard.strengths')}</h4><ul className="list-disc ps-5">{q.strengths.map((s,i) => <li key={i}>{s}</li>)}</ul></div><div><h4 className="font-semibold">{t('interview.scorecard.gaps')}</h4><ul className="list-disc ps-5">{q.gaps.map((s,i) => <li key={i}>{s}</li>)}</ul></div></div></details>)}
  </section>;
}
