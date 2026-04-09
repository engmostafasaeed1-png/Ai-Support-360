import { useState, useEffect, useRef } from 'react';
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
  AlertTriangle, Clock, Video, VideoOff, Mic, MicOff, Monitor, PhoneOff,
  MessageSquare,
} from 'lucide-react';
import aiAvatarImg from '@/assets/ai-interviewer-avatar.png';

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

// Animated speaking indicator dots
function SpeakingIndicator() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: '0.15s' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: '0.3s' }} />
    </div>
  );
}

// Floating particles for avatar background
function AvatarParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-primary/20 animate-pulse"
          style={{
            left: `${15 + i * 15}%`,
            top: `${20 + (i % 3) * 25}%`,
            animationDelay: `${i * 0.5}s`,
            animationDuration: `${2 + i * 0.5}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function AIInterviewFlow({ interviewId, onComplete, onCancel }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'loading' | 'questions' | 'submitting' | 'results'>('loading');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Timer
  useEffect(() => {
    if (phase === 'questions') {
      timerRef.current = setInterval(() => setElapsedTime(t => t + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  // Simulate avatar speaking when question changes
  useEffect(() => {
    if (phase === 'questions') {
      setIsSpeaking(true);
      const timer = setTimeout(() => setIsSpeaking(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [currentQ, phase]);

  useEffect(() => {
    generateQuestions();
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

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
      clearInterval(timerRef.current);
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
      <div className="rounded-2xl bg-[#0f1628] p-8 text-center">
        {error ? (
          <>
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <p className="text-sm text-red-400 mb-4">{error}</p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
              <Button onClick={generateQuestions}>{t('common.retry', 'Retry')}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="w-24 h-24 rounded-full mx-auto mb-6 overflow-hidden border-2 border-primary/50 animate-pulse">
              <img src={aiAvatarImg} alt="AI Interviewer" className="w-full h-full object-cover" />
            </div>
            <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
            <p className="text-lg font-semibold text-white mb-1">
              {t('ai_interview.generating', 'Preparing Your Interview...')}
            </p>
            <p className="text-sm text-gray-400">
              {t('ai_interview.generating_desc', 'AI is creating personalized questions based on your skills')}
            </p>
          </>
        )}
      </div>
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
      <div className="rounded-2xl bg-[#0f1628] p-8 text-center">
        <div className="w-24 h-24 rounded-full mx-auto mb-6 overflow-hidden border-2 border-primary/50">
          <img src={aiAvatarImg} alt="AI Interviewer" className="w-full h-full object-cover" />
        </div>
        <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
        <p className="text-lg font-semibold text-white mb-1">
          {t('ai_interview.evaluating', 'Evaluating Your Answers...')}
        </p>
        <p className="text-sm text-gray-400">
          {t('ai_interview.evaluating_desc', 'AI is reviewing and scoring your responses')}
        </p>
      </div>
    );
  }

  // Questions phase — Video Call UI
  const q = questions[currentQ];
  return (
    <div className="space-y-0">
      {/* Video Call Container */}
      <div className="rounded-2xl overflow-hidden bg-[#0f1628] border border-white/10">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-black/40 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-medium text-white/80">LIVE — AI Interview</span>
          </div>
          <div className="flex items-center gap-3">
            <Badge className={`text-[10px] ${categoryColors[q?.category] || 'bg-muted'}`}>
              {q?.category?.replace('_', ' ') || 'general'}
            </Badge>
            <span className="text-xs text-white/60 font-mono">{formatTime(elapsedTime)}</span>
            <span className="text-xs text-white/40">Q {currentQ + 1}/{questions.length}</span>
          </div>
        </div>

        {/* Main video area */}
        <div className="grid md:grid-cols-5 gap-0 min-h-[400px]">
          {/* AI Avatar — main video feed */}
          <div className="md:col-span-3 relative flex items-center justify-center bg-gradient-to-br from-[#0a1128] via-[#0f1628] to-[#1a1f3a] p-8">
            <AvatarParticles />
            
            {/* Avatar */}
            <div className="relative">
              <div className={`w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-3 transition-all duration-500 ${
                isSpeaking ? 'border-green-400 shadow-[0_0_30px_rgba(74,222,128,0.3)] scale-105' : 'border-primary/40'
              }`}>
                <img src={aiAvatarImg} alt="AI Interviewer" className="w-full h-full object-cover" />
              </div>
              {/* Speaking indicator */}
              {isSpeaking && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-green-500/20 backdrop-blur-sm rounded-full px-3 py-1">
                  <SpeakingIndicator />
                  <span className="text-[10px] text-green-300 ms-1">Speaking</span>
                </div>
              )}
            </div>

            {/* Name label */}
            <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/50 rounded-lg px-3 py-1.5">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-white">Qurtuba AI Interviewer</span>
            </div>
          </div>

          {/* Right panel — Question + Answer */}
          <div className="md:col-span-2 flex flex-col bg-[#111827] border-s border-white/10">
            {/* Question bubble */}
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="flex items-start gap-2 mb-4">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Brain className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="bg-white/5 rounded-xl rounded-tl-sm p-3 border border-white/10 flex-1">
                  <p className="text-sm text-white/90 leading-relaxed">{q?.question}</p>
                </div>
              </div>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 px-2 mb-3">
                {questions.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all ${
                      i < currentQ ? 'bg-green-400 w-4' :
                      i === currentQ ? 'bg-primary w-6' :
                      'bg-white/10 w-3'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Answer input area */}
            <div className="p-3 border-t border-white/10 bg-black/20">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare className="w-3.5 h-3.5 text-white/40" />
                <span className="text-[10px] text-white/40 uppercase tracking-wider">Your Answer</span>
              </div>
              <Textarea
                value={answers[currentQ] || ''}
                onChange={e => {
                  const newAnswers = [...answers];
                  newAnswers[currentQ] = e.target.value;
                  setAnswers(newAnswers);
                }}
                placeholder={t('ai_interview.answer_placeholder', 'Type your answer here...')}
                rows={4}
                className="resize-none bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm focus:border-primary/50"
              />
            </div>
          </div>
        </div>

        {/* Bottom control bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-t border-white/10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMicOn(!micOn)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setCamOn(!camOn)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                camOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>
            <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
              <Monitor className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => currentQ === 0 ? onCancel() : setCurrentQ(currentQ - 1)}
              className="text-white/70 hover:text-white hover:bg-white/10"
            >
              <ChevronLeft className="w-4 h-4 me-1" />
              {currentQ === 0 ? t('common.cancel', 'Cancel') : t('ai_interview.prev', 'Previous')}
            </Button>

            {currentQ < questions.length - 1 ? (
              <Button
                size="sm"
                onClick={() => setCurrentQ(currentQ + 1)}
                disabled={!answers[currentQ]?.trim()}
                className="bg-primary hover:bg-primary/90"
              >
                {t('ai_interview.next', 'Next')}
                <ChevronRight className="w-4 h-4 ms-1" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="gradient-primary border-0"
                onClick={handleSubmit}
                disabled={!allAnswered}
              >
                <Send className="w-4 h-4 me-1" />
                {t('ai_interview.submit', 'Submit')}
              </Button>
            )}
          </div>

          <button
            onClick={onCancel}
            className="w-10 h-10 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center justify-center transition-colors"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
