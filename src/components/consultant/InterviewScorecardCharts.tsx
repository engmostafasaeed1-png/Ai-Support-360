import { BarChart, Bar, XAxis, YAxis, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { radarRows, RUBRIC_KEYS, type CompetencyScores, type QuestionScore } from '../../../supabase/functions/_shared/interviewEvaluation';
import { useTranslation } from 'react-i18next';
export default function InterviewScorecardCharts({ questions, competencies }: { questions: QuestionScore[]; competencies: CompetencyScores | null }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  return <div className="grid gap-6 md:grid-cols-2 min-w-0" aria-hidden="true">
    {competencies && <div className="h-72 min-w-0 text-muted-foreground"><ResponsiveContainer><RadarChart data={radarRows(competencies, k => t(`interview.scorecard.${k}`))} outerRadius="60%"><PolarGrid stroke="hsl(var(--border))"/><PolarAngleAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}/><PolarRadiusAxis domain={[0, 100]} tick={false}/><Radar dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--accent))" fillOpacity={0.3} isAnimationActive={false}/></RadarChart></ResponsiveContainer></div>}
    {questions.map(q => <div key={q.question_index} className="min-w-0"><h4 className="text-sm font-medium">{t('interview.scorecard.question', { number: q.question_index })}</h4><div className="h-48"><ResponsiveContainer><BarChart data={RUBRIC_KEYS.map(k => ({ label: t(`interview.scorecard.${k}`), score: q.rubric[k] }))} layout="vertical" margin={{ left: 12, right: 12 }}><XAxis type="number" reversed={rtl} domain={[0, 5]} tick={{ fill: 'hsl(var(--muted-foreground))' }}/><YAxis type="category" orientation={rtl ? 'right' : 'left'} dataKey="label" width={100} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}/><Bar dataKey="score" fill="hsl(var(--primary))" isAnimationActive={false}/></BarChart></ResponsiveContainer></div></div>)}
  </div>;
}
