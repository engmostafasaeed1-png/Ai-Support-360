import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, Download, MessageSquare, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateInterviewPdf } from '@/lib/interviewPdf';

interface Props {
  interviewId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session?: any;
  consultantName?: string;
}

export default function InterviewAnswersDialog({ interviewId, open, onOpenChange, session, consultantName }: Props) {
  const { t } = useTranslation();

  const { data: answers, isLoading } = useQuery({
    queryKey: ['interview-answers', interviewId],
    queryFn: async () => {
      if (!interviewId) return [];
      const { data, error } = await supabase
        .from('interview_answers')
        .select('*')
        .eq('interview_id', interviewId)
        .order('question_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!interviewId && open,
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
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => generateInterviewPdf(answers, session, consultantName)}
              >
                <Download className="w-3.5 h-3.5" />
                {t('interview_history.export_pdf', 'Export PDF')}
              </Button>
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
                      {a.score != null && (
                        <span className="ms-auto flex items-center gap-1 text-sm font-semibold text-foreground">
                          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                          {a.score}/10
                        </span>
                      )}
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
