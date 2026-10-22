import { useSessionReady } from '@/hooks/useSessionReady';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, Download, MessageSquare, Star, TrendingUp, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateInterviewPdf } from '@/lib/interviewPdf';
import ShareMenu from '@/components/ShareMenu';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockInterviewAnswers } from '@/data/interviewMockData';

interface Props {
  interviewId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: any;
  consultantName?: string;
}

export default function InterviewAnswersDialog({ interviewId, open, onOpenChange, session, consultantName }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();

  const signedIn = useSessionReady().signedIn;
  const { data: answers, isLoading } = useQuery({
    queryKey: ['interview-answers', interviewId],
    queryFn: async () => {
      if (!interviewId) return [];
      if (isGuest) return mockInterviewAnswers[interviewId] || [];
      const { data, error } = await supabase
        .from('interview_answers')
        // named columns: question_source is admin-only (docs/sql/interview-knowledge.sql)
        .select('id, interview_id, question, answer_transcript, category, score, ai_feedback, question_order, created_at, sap_module')
        .eq('interview_id', interviewId)
        .order('question_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: signedIn && (!!interviewId && open),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              {t('interview_history.answers_title', 'Interview Answers')}
            </DialogTitle>
            {answers && answers.length > 0 && (
              <div className="flex items-center gap-2">
                <ShareMenu
                  title={`Interview Results${consultantName ? ` — ${consultantName}` : ''}`}
                  text={session ? `Overall: ${session.overall_score}/100 | Technical: ${session.technical_score}/100 | Soft Skills: ${session.soft_skills_score}/100` : undefined}
                  details={session ? [
                    { label: 'Overall Score', value: `${session.overall_score}/100` },
                    { label: 'Technical', value: `${session.technical_score}/100` },
                    { label: 'Soft Skills', value: `${session.soft_skills_score}/100` },
                    { label: 'Type', value: session.interview_type || 'AI' },
                  ] : undefined}
                  variant="outline"
                  size="sm"
                  onDownload={() => generateInterviewPdf(answers, session, consultantName)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => generateInterviewPdf(answers, session, consultantName)}
                >
                  <Download className="w-3.5 h-3.5" />
                  {t('interview_history.export_pdf', 'Export PDF')}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : !answers || answers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t('interview_history.no_answers', 'No answers recorded for this interview.')}
          </p>
        ) : (
          <div className="space-y-4">
            {answers.map((a, idx) => (
              <div key={a.id} className="rounded-xl border border-border/40 overflow-hidden">
                <div className="flex items-start gap-3 p-4 bg-muted/10">
                  <span className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[10px] capitalize">{a.category}</Badge>
                      {a.score != null && (() => {
                        const status = a.score >= 7 ? 'Good' : a.score >= 4 ? 'Mild' : 'Far Away';
                        const styles = a.score >= 7
                          ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
                          : a.score >= 4
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';
                        const Icon = a.score >= 7 ? CheckCircle : a.score >= 4 ? TrendingUp : XCircle;
                        return (
                          <span className="ms-auto flex items-center gap-1.5">
                            <Badge variant="secondary" className={`text-[10px] ${styles}`}>
                              <Icon className="w-2.5 h-2.5 me-0.5" />
                              {status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{a.score}/10</span>
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm font-medium text-foreground">{a.question}</p>
                  </div>
                </div>

                <div className="p-4 space-y-3 border-t border-border/30">
                  {a.answer_transcript ? (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                        {t('interview_history.answer', 'Answer')}
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{a.answer_transcript}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      {t('interview_history.no_answer', 'No answer provided.')}
                    </p>
                  )}

                  {a.ai_feedback && (
                    <div className="rounded-lg bg-accent/5 p-3">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-accent" />
                        {t('interview_history.ai_feedback', 'AI Feedback')}
                      </p>
                      <p className="text-sm text-foreground">{a.ai_feedback}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
