import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend, ResponsiveContainer } from 'recharts';

interface Props {
  interviews: any[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const typeLabels: Record<string, string> = { ai: 'AI', physical: 'Physical', online: 'Online' };
const RADAR_COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#10b981', '#f59e0b', '#ef4444'];

function ScoreBar({ score, max = 100, color }: { score: number; max?: number; color: string }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2.5 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-foreground w-8 text-end">{score}</span>
    </div>
  );
}

function TrendIcon({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (diff > 0) return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
  if (diff < 0) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

export default function InterviewComparisonDialog({ interviews, open, onOpenChange }: Props) {
  const { t } = useTranslation();

  const scored = interviews
    .filter((iv: any) => iv.overall_score != null)
    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (scored.length < 2) return null;

  const latest = scored[scored.length - 1];
  const first = scored[0];
  const overallDiff = latest.overall_score - first.overall_score;
  const techDiff = (latest.technical_score ?? 0) - (first.technical_score ?? 0);
  const softDiff = (latest.soft_skills_score ?? 0) - (first.soft_skills_score ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            {t('interview_comparison.title', 'Interview Score Comparison')}
          </DialogTitle>
        </DialogHeader>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t('interview_comparison.overall', 'Overall'), diff: overallDiff },
            { label: t('ai_interview.technical', 'Technical'), diff: techDiff },
            { label: t('ai_interview.soft_skills', 'Soft Skills'), diff: softDiff },
          ].map(({ label, diff }) => (
            <div key={label} className="rounded-xl border border-border/30 p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase mb-1">{label} Trend</p>
              <div className="flex items-center justify-center gap-1.5">
                <span className={`text-lg font-bold ${diff > 0 ? 'text-green-500' : diff < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {diff > 0 ? '+' : ''}{diff}
                </span>
                {diff > 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> : diff < 0 ? <TrendingDown className="w-4 h-4 text-red-500" /> : <Minus className="w-4 h-4 text-muted-foreground" />}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">first → latest</p>
            </div>
          ))}
        </div>

        {/* Radar Chart */}
        <div className="rounded-xl border border-border/30 p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">
            {t('interview_comparison.radar', 'Score Radar')}
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart
              data={[
                { metric: t('ai_interview.technical', 'Technical'), ...Object.fromEntries(scored.map((iv: any, i: number) => [`s${i}`, iv.technical_score ?? 0])) },
                { metric: t('ai_interview.soft_skills', 'Soft Skills'), ...Object.fromEntries(scored.map((iv: any, i: number) => [`s${i}`, iv.soft_skills_score ?? 0])) },
                { metric: t('interview_comparison.overall', 'Overall'), ...Object.fromEntries(scored.map((iv: any, i: number) => [`s${i}`, iv.overall_score ?? 0])) },
              ]}
              cx="50%" cy="50%" outerRadius="70%"
            >
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} />
              {scored.map((iv: any, i: number) => (
                <Radar
                  key={iv.id}
                  name={`#${i + 1} ${typeLabels[iv.interview_type] || ''}`}
                  dataKey={`s${i}`}
                  stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                  fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                  fillOpacity={i === scored.length - 1 ? 0.25 : 0.08}
                />
              ))}
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Timeline Comparison */}
        <div className="space-y-3 mt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            {t('interview_comparison.timeline', 'Score Timeline')}
          </p>
          {scored.map((iv: any, idx: number) => {
            const date = new Date(iv.created_at).toLocaleDateString();
            const prev = idx > 0 ? scored[idx - 1] : null;

            return (
              <div key={iv.id} className="rounded-xl border border-border/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                      {idx + 1}
                    </span>
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {typeLabels[iv.interview_type] || 'Interview'}
                      </span>
                      <p className="text-[10px] text-muted-foreground">{date}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {prev && <TrendIcon current={iv.overall_score} previous={prev.overall_score} />}
                    <Badge variant="outline" className="text-xs font-bold">{iv.overall_score}/100</Badge>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-muted-foreground">{t('ai_interview.technical', 'Technical')}</span>
                      {prev?.technical_score != null && iv.technical_score != null && (
                        <span className={`text-[10px] font-medium ${iv.technical_score - prev.technical_score > 0 ? 'text-green-500' : iv.technical_score - prev.technical_score < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {iv.technical_score - prev.technical_score > 0 ? '+' : ''}{iv.technical_score - prev.technical_score}
                        </span>
                      )}
                    </div>
                    <ScoreBar score={iv.technical_score ?? 0} color="bg-primary" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-muted-foreground">{t('ai_interview.soft_skills', 'Soft Skills')}</span>
                      {prev?.soft_skills_score != null && iv.soft_skills_score != null && (
                        <span className={`text-[10px] font-medium ${iv.soft_skills_score - prev.soft_skills_score > 0 ? 'text-green-500' : iv.soft_skills_score - prev.soft_skills_score < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {iv.soft_skills_score - prev.soft_skills_score > 0 ? '+' : ''}{iv.soft_skills_score - prev.soft_skills_score}
                        </span>
                      )}
                    </div>
                    <ScoreBar score={iv.soft_skills_score ?? 0} color="bg-accent" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
