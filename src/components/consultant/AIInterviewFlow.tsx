import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Brain, ChevronRight, ChevronLeft, Loader2, CheckCircle, Send,
  AlertTriangle, Clock,
} from 'lucide-react';

interface Question {
  id?: string;
  question: string;
  category: string;
  difficulty?: number;
}

interface EvaluationResult {
  answers: { score: number; feedback: string }[];
  technical_score: number;
  soft_skills_score: number;
  overall_score: number;
  summary: string;
}

interface Props {
  interviewId: string;
  onComplete: () => void;
  onCancel: () => void;
}

const categoryColors: Record<string, string> = {
  technical: 'bg-blue-100 text-blue-700',
  scenario: 'bg-purple-100 text-purple-700',
  soft_skills: 'bg-green-100 text-green-700',
  problem_solving: 'bg-amber-100 text-amber-700',
};

export default function AIInterviewFlow({ interviewId, onComplete, onCancel }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'loading' | 'questions' | 'submitting' | 'results'>('loading');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState('');

  // Generate questions on mount
  useEffect(() => {
    generateQuestions();
  }, []);

  const generateQuestions = async () => {
    setPhase('loading');
    setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('ai-interview-questions', {
        body: { interview_id: interviewId },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);

      const qs = data.questions || [];
      setQuestions(qs);
      setAnswers(new Array(qs.length).fill(''));
      
      // Fetch the saved answer IDs
      const { data: savedAnswers } = await supabase
        .from('interview_answers')
        .select('id, question_order')
        .eq('interview_id', interviewId)
        .order('question_order');
      
      if (savedAnswers) {
        setQuestions(qs.map((q: Question, i: number) => ({
          ...q,
          id: savedAnswers[i]?.id,
        })));
      }
      
      setPhase('questions');
    } catch (err: any) {
      console.error('Generate questions error:', err);
      setError(err.message || 'Failed to generate questions');
      setPhase('loading');
    }
  };

  const handleSubmit = async () => {
    setPhase('submitting');
    try {
      const payload = questions.map((q, i) => ({
        id: q.id,
        question: q.question,
        category: q.category,
        answer: answers[i],
      }));

      const { data, error: fnErr } = await supabase.functions.invoke('ai-interview-evaluate', {
        body: { interview_id: interviewId, answers: payload },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);

      setEvaluation(data.evaluation);
      setPhase('results');
      toast.success(t('ai_interview.completed', 'Interview completed!'));
    } catch (err: any) {
      console.error('Evaluate error:', err);
      toast.error(err.message || 'Failed to evaluate answers');
      setPhase('questions');
    }
  };

  const progress = questions.length > 0 ? ((currentQ + 1) / questions.length) * 100 : 0;
  const allAnswered = answers.every(a => a.trim().length > 0);

  // Loading / Error state
  if (phase === 'loading') {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-16 text-center">
          {error ? (
            <>
              <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
              <p className="text-sm text-destructive mb-4">{error}</p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
                <Button onClick={generateQuestions}>{t('common.retry', 'Retry')}</Button>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
              <p className="text-lg font-semibold text-foreground mb-1">
                {t('ai_interview.generating', 'Generating Interview Questions...')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('ai_interview.generating_desc', 'AI is creating personalized questions based on your skills')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // Results
  if (phase === 'results' && evaluation) {
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-full border-4 border-primary mx-auto flex items-center justify-center mb-3">
                <span className="text-3xl font-bold text-foreground">{evaluation.overall_score}</span>
              </div>
              <h2 className="text-xl font-bold text-foreground">{t('ai_interview.results_title', 'Interview Results')}</h2>
              <p className="text-sm text-muted-foreground mt-1">{evaluation.summary}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-xl bg-muted/20 text-center">
                <p className="text-2xl font-bold text-foreground">{evaluation.technical_score}</p>
                <p className="text-xs text-muted-foreground">{t('ai_interview.technical', 'Technical')}</p>
              </div>
              <div className="p-4 rounded-xl bg-muted/20 text-center">
                <p className="text-2xl font-bold text-foreground">{evaluation.soft_skills_score}</p>
                <p className="text-xs text-muted-foreground">{t('ai_interview.soft_skills', 'Soft Skills')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Per-question feedback */}
        <div className="space-y-3">
          {questions.map((q, i) => (
            <Card key={i} className="rounded-xl border-border/50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`text-[10px] ${categoryColors[q.category] || 'bg-muted'}`}>
                        {q.category.replace('_', ' ')}
                      </Badge>
                      {evaluation.answers[i] && (
                        <span className="text-xs font-bold text-foreground">{evaluation.answers[i].score}/100</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{q.question}</p>
                    <p className="text-xs text-muted-foreground">{answers[i]}</p>
                    {evaluation.answers[i]?.feedback && (
                      <p className="text-xs text-accent mt-2 italic">{evaluation.answers[i].feedback}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button className="w-full gradient-primary border-0" onClick={onComplete}>
          <CheckCircle className="w-4 h-4 me-2" />
          {t('ai_interview.done', 'Done')}
        </Button>
      </div>
    );
  }

  // Submitting
  if (phase === 'submitting') {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="py-16 text-center">
          <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
          <p className="text-lg font-semibold text-foreground mb-1">
            {t('ai_interview.evaluating', 'Evaluating Your Answers...')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('ai_interview.evaluating_desc', 'AI is reviewing and scoring your responses')}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Questions phase
  const q = questions[currentQ];
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">{t('ai_interview.title', 'AI Interview')}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {currentQ + 1}/{questions.length}
          </span>
        </div>
      </div>

      <Progress value={progress} className="h-2" />

      {/* Question card */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Badge className={`text-[10px] ${categoryColors[q?.category] || 'bg-muted'}`}>
              {q?.category?.replace('_', ' ') || 'general'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t('ai_interview.question', 'Question')} {currentQ + 1}
            </span>
          </div>
          <p className="text-base font-medium text-foreground mb-4">{q?.question}</p>
          <Textarea
            value={answers[currentQ] || ''}
            onChange={e => {
              const newAnswers = [...answers];
              newAnswers[currentQ] = e.target.value;
              setAnswers(newAnswers);
            }}
            placeholder={t('ai_interview.answer_placeholder', 'Type your answer here...')}
            rows={5}
            className="resize-none"
          />
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => currentQ === 0 ? onCancel() : setCurrentQ(currentQ - 1)}
        >
          <ChevronLeft className="w-4 h-4 me-1" />
          {currentQ === 0 ? t('common.cancel', 'Cancel') : t('ai_interview.prev', 'Previous')}
        </Button>

        {currentQ < questions.length - 1 ? (
          <Button onClick={() => setCurrentQ(currentQ + 1)} disabled={!answers[currentQ]?.trim()}>
            {t('ai_interview.next', 'Next')}
            <ChevronRight className="w-4 h-4 ms-1" />
          </Button>
        ) : (
          <Button
            className="gradient-primary border-0"
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            <Send className="w-4 h-4 me-1" />
            {t('ai_interview.submit', 'Submit Answers')}
          </Button>
        )}
      </div>
    </div>
  );
}
