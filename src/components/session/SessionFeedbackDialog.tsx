import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Star, TrendingUp, TrendingDown, FileText, CheckCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReactMarkdown from 'react-markdown';

interface Props {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SessionFeedbackDialog({ sessionId, open, onOpenChange }: Props) {
  const { t } = useTranslation();

  const { data: feedback, isLoading } = useQuery({
    queryKey: ['session-feedback', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      const { data, error } = await supabase
        .from('session_feedback')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && open,
  });

  const ScoreBar = ({ label, score, max = 10 }: { label: string; score: number | null; max?: number }) => (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{score ?? '-'}/{max}</span>
      </div>
      <Progress value={score ? (score / max) * 100 : 0} className="h-2" />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-primary" />
            {t('feedback.title', 'Session Feedback & Report')}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : !feedback ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t('feedback.not_ready', 'Feedback has not been generated for this session yet.')}
          </p>
        ) : (
          <Tabs defaultValue="evaluation" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="evaluation">Evaluation</TabsTrigger>
              <TabsTrigger value="mom">Meeting Minutes</TabsTrigger>
              <TabsTrigger value="actions">Action Items</TabsTrigger>
            </TabsList>

            <TabsContent value="evaluation" className="space-y-4">
              {/* Overall Score */}
              <div className="rounded-xl border border-border/40 p-5 text-center bg-muted/5">
                <div className="text-4xl font-bold text-primary">{feedback.overall_score ?? '-'}</div>
                <p className="text-xs text-muted-foreground mt-1">Overall Score / 10</p>
              </div>

              {/* Score Breakdown */}
              <div className="space-y-3">
                <ScoreBar label="Communication" score={feedback.communication_score} />
                <ScoreBar label="Technical" score={feedback.technical_score} />
                <ScoreBar label="Professionalism" score={feedback.professionalism_score} />
              </div>

              {/* AI Feedback */}
              {feedback.ai_feedback && (
                <div className="rounded-lg bg-accent/5 p-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-accent" /> AI Feedback
                  </p>
                  <p className="text-sm">{feedback.ai_feedback}</p>
                </div>
              )}

              {/* Strengths & Improvements */}
              <div className="grid grid-cols-2 gap-3">
                {feedback.strengths && (feedback.strengths as string[]).length > 0 && (
                  <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                    <p className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> Strengths
                    </p>
                    <ul className="space-y-1">
                      {(feedback.strengths as string[]).map((s, i) => (
                        <li key={i} className="text-xs text-foreground">• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {feedback.improvements && (feedback.improvements as string[]).length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs font-semibold text-amber-600 mb-2 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" /> Areas to Improve
                    </p>
                    <ul className="space-y-1">
                      {(feedback.improvements as string[]).map((s, i) => (
                        <li key={i} className="text-xs text-foreground">• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="mom">
              {feedback.mom_content ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{feedback.mom_content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No meeting minutes available.</p>
              )}
            </TabsContent>

            <TabsContent value="actions">
              {feedback.action_items && (feedback.action_items as string[]).length > 0 ? (
                <div className="space-y-2">
                  {(feedback.action_items as string[]).map((item, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg border border-border/40 p-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {i + 1}
                      </span>
                      <p className="text-sm">{item}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No action items recorded.</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
