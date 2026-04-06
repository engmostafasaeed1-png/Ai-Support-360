import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { ClipboardCheck, Star } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SurveyQuestion {
  question: string;
  type: 'rating' | 'text' | 'multiple_choice' | 'nps';
  scale?: number;
  options?: string[];
}

export default function SessionSurveyDialog({ sessionId, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<number, string | number>>({});

  const { data: survey, isLoading } = useQuery({
    queryKey: ['session-survey', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return null;
      const { data, error } = await supabase
        .from('session_surveys')
        .select('*')
        .eq('session_id', sessionId)
        .eq('generated_for', user.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && open,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!survey) throw new Error('No survey');
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      const formattedAnswers = Object.entries(answers).map(([idx, value]) => ({
        question_index: parseInt(idx),
        value,
      }));

      const { error } = await supabase.from('survey_responses').insert({
        survey_id: survey.id,
        respondent_id: user.user.id,
        answers: formattedAnswers,
        submitted_at: new Date().toISOString(),
      });
      if (error) throw error;

      await supabase.from('session_surveys').update({ status: 'completed' }).eq('id', survey.id);
    },
    onSuccess: () => {
      toast.success('Survey submitted! Thank you for your feedback.');
      queryClient.invalidateQueries({ queryKey: ['session-survey', sessionId] });
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to submit survey'),
  });

  const questions: SurveyQuestion[] = survey?.questions ? (survey.questions as any as SurveyQuestion[]) : [];

  const RatingInput = ({ index, scale = 5 }: { index: number; scale?: number }) => (
    <div className="flex gap-1">
      {Array.from({ length: scale }, (_, i) => i + 1).map(v => (
        <button
          key={v}
          onClick={() => setAnswers(prev => ({ ...prev, [index]: v }))}
          className={`w-9 h-9 rounded-lg border text-sm font-medium transition-colors ${
            answers[index] === v
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border/40 hover:border-primary/30'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            {t('survey.title', 'Post-Session Survey')}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : !survey ? (
          <p className="text-sm text-muted-foreground text-center py-8">No survey available for this session.</p>
        ) : survey.status === 'completed' ? (
          <div className="text-center py-8">
            <Star className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="font-semibold">Survey Already Completed</p>
            <p className="text-sm text-muted-foreground">Thank you for your feedback!</p>
          </div>
        ) : (
          <div className="space-y-5">
            {questions.map((q, idx) => (
              <div key={idx} className="space-y-2">
                <Label className="text-sm font-medium">{idx + 1}. {q.question}</Label>
                {q.type === 'rating' && <RatingInput index={idx} scale={q.scale} />}
                {q.type === 'nps' && <RatingInput index={idx} scale={q.scale || 10} />}
                {q.type === 'text' && (
                  <Textarea
                    placeholder="Your answer..."
                    value={(answers[idx] as string) || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [idx]: e.target.value }))}
                    className="min-h-[60px]"
                  />
                )}
                {q.type === 'multiple_choice' && q.options && (
                  <RadioGroup
                    value={(answers[idx] as string) || ''}
                    onValueChange={v => setAnswers(prev => ({ ...prev, [idx]: v }))}
                  >
                    {q.options.map(opt => (
                      <div key={opt} className="flex items-center gap-2">
                        <RadioGroupItem value={opt} id={`q${idx}-${opt}`} />
                        <Label htmlFor={`q${idx}-${opt}`} className="text-sm">{opt}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>
            ))}
            <Button
              className="w-full"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit Survey'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
