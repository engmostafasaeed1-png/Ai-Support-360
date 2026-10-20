import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Video, Play, CheckCircle, Clock, Brain, AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import AIInterviewFlow from '@/components/consultant/AIInterviewFlow';
import InterviewPreflight from '@/components/consultant/InterviewPreflight';
import { format } from 'date-fns';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInterviewEligibility, INTERVIEW_ELIGIBILITY_KEY } from '@/hooks/useInterviewEligibility';
import { useSessionReady } from '@/hooks/useSessionReady';
import { BLOCK_TEXT, ERROR_TEXT, classifyStartError, logStartErrorOnce, pickSessionToResume, resolveAiInterviewSession, type SessionRow, type StartErrorCode } from '@/lib/interviewStart';

export default function InterviewsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [activeInterviewId, setActiveInterviewId] = useState<string | null>(null);
  const [stage, setStage] = useState<'preflight' | 'interview'>('preflight');
  const [resumed, setResumed] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { signedIn } = useSessionReady();
  const eligibility = useInterviewEligibility();
  const block = isGuest ? null : eligibility.block;
  const starting = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<StartErrorCode | null>(null);

  const { data: interviews, isLoading, refetch } = useQuery({
    queryKey: ['consultant-interviews'],
    enabled: isGuest || signedIn,
    queryFn: async () => {
      if (isGuest) {
        return [
          { id: 'demo-1', status: 'pending', interview_type: 'ai', created_at: new Date().toISOString(), overall_score: null, ai_summary: null, requested_by: null },
          { id: 'demo-2', status: 'completed', interview_type: 'ai', created_at: new Date(Date.now() - 7 * 86400000).toISOString(), overall_score: 82, ai_summary: 'Strong SAP FICO skills demonstrated.', requested_by: null },
        ];
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!consultant) return [];
      const { data, error } = await supabase
        .from('interview_sessions')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Open AI sessions collapse into the one that would be resumed, so older duplicates never show as separate cards.
  const openRows = interviews?.filter(i => i.status === 'pending' || i.status === 'in_progress') || [];
  const aiPick = pickSessionToResume(openRows.filter(i => i.interview_type === 'ai') as SessionRow[], Date.now());
  const pendingInterviews = openRows.filter(i => (i as any).interview_style === 'live' || i.interview_type !== 'ai' || i.id === aiPick?.id);
  const completedInterviews = interviews?.filter(i => i.status === 'completed' || i.status === 'reviewed') || [];

  const openSession = (id: string, wasResumed: boolean) => {
    setResumed(wasResumed);
    setStage('preflight');
    setActiveInterviewId(id);
  };

  const handleStartOptionalInterview = async () => {
    if (isGuest || starting.current || block) return;
    starting.current = true;
    setIsStarting(true);
    setStartError(null);
    try {
      const consultantId = eligibility.data?.consultantId;
      if (!consultantId) { eligibility.refetch(); throw new Error('consultant profile not loaded'); }
      const session = await resolveAiInterviewSession(consultantId);
      openSession(session.id, session.resumed !== null);
      void refetch();
    } catch (err) {
      const code = classifyStartError(err);
      setStartError(code);
      logStartErrorOnce(code, err, 'interviews-page');
    } finally { starting.current = false; setIsStarting(false); }
  };

  useEffect(() => {
    if (searchParams.get('start') !== '1' || isGuest || block === 'checking') return;
    const next = new URLSearchParams(searchParams);
    next.delete('start');
    setSearchParams(next, { replace: true });
    // A blocked start keeps the reason and its fix visible instead of silently doing nothing.
    if (!block) void handleStartOptionalInterview();
  }, [block, isGuest, searchParams, setSearchParams]);

  const closeInterview = () => { setActiveInterviewId(null); void refetch(); };

  if (activeInterviewId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={closeInterview}>
          ← {t('interview.back_to_list', 'Back to Interviews')}
        </Button>
        {stage === 'preflight' ? (
          <InterviewPreflight
            resumed={resumed}
            onCancel={closeInterview}
            onContinue={({ textOnly: typed }) => { setTextOnly(typed); setStage('interview'); }}
          />
        ) : (
          <AIInterviewFlow
            interviewId={activeInterviewId}
            textOnly={textOnly}
            onComplete={() => {
              setActiveInterviewId(null);
              refetch();
              void queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
              void queryClient.invalidateQueries({ queryKey: ['interview-history'] });
              void queryClient.invalidateQueries({ queryKey: INTERVIEW_ELIGIBILITY_KEY });
            }}
            onCancel={closeInterview}
          />
        )}
      </div>
    );
  }

  const blockText = block ? BLOCK_TEXT[block] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            AI Interviews
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Optional</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Completing an AI interview is <strong>optional</strong>, but it earns you a verified badge + credibility credits clients can see.
          </p>
        </div>
        <Button onClick={handleStartOptionalInterview} disabled={isStarting || isGuest || !!block}
          aria-describedby={blockText ? 'interview-start-reason' : undefined} className="gradient-primary border-0 gap-2">
          {isStarting || block === 'checking' ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Brain className="w-4 h-4" />}
          {aiPick ? t('interview.continue_ai', 'Continue AI Interview') : t('interview.start_ai', 'Start AI Interview')}
        </Button>
      </div>
      {blockText && (
        <div id="interview-start-reason" role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          {block === 'checking' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
          <span>{t(blockText.key, blockText.message)}</span>
          {blockText.action && (
            <Button asChild size="sm" variant="outline" className="ms-auto"><Link to={blockText.action.to}>{t(blockText.action.key, blockText.action.label)}</Link></Button>
          )}
        </div>
      )}
      {startError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{t(ERROR_TEXT[startError].key, ERROR_TEXT[startError].message)}</span>
          <Button size="sm" variant="outline" className="ms-auto" onClick={handleStartOptionalInterview} disabled={isStarting}>
            <RotateCcw className="me-1 h-4 w-4" /> {t('common.retry', 'Retry')}
          </Button>
        </div>
      )}

      {/* Reward tier card */}
      <Card className="rounded-2xl border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <span className="text-xl">🎁</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Earn a verified badge + credibility credits</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your reward depends on your interview score. The badge appears on your profile so clients instantly see your verified expertise.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <div className="rounded-lg p-2.5 bg-gradient-to-br from-amber-200 to-yellow-400 text-amber-950 ring-1 ring-amber-400/50 text-center">
                  <div className="text-base">🥇</div>
                  <div className="text-[10px] font-bold">Gold · 85+</div>
                  <div className="text-[10px]">+150 credits</div>
                </div>
                <div className="rounded-lg p-2.5 bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800 ring-1 ring-slate-400/50 text-center">
                  <div className="text-base">🥈</div>
                  <div className="text-[10px] font-bold">Silver · 70+</div>
                  <div className="text-[10px]">+100 credits</div>
                </div>
                <div className="rounded-lg p-2.5 bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950 ring-1 ring-orange-500/50 text-center">
                  <div className="text-base">🥉</div>
                  <div className="text-[10px] font-bold">Bronze · 50+</div>
                  <div className="text-[10px]">+75 credits</div>
                </div>
                <div className="rounded-lg p-2.5 bg-gradient-to-br from-emerald-300 to-emerald-500 text-emerald-950 ring-1 ring-emerald-500/50 text-center">
                  <div className="text-base">✅</div>
                  <div className="text-[10px] font-bold">Verified</div>
                  <div className="text-[10px]">+50 credits</div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Credits are awarded once on your first completed interview. Retakes refresh your score and badge tier.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          {/* Pending / Ready to Join */}
          {pendingInterviews.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                Ready to Join ({pendingInterviews.length})
              </h2>
              {pendingInterviews.map((interview) => (
                <Card key={interview.id} className="rounded-2xl border-primary/30 bg-primary/5">
                  <CardContent className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Video className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {(interview as any).interview_style === 'live' ? 'Live Interview with our team' : interview.interview_type === 'physical' ? 'Manual Interview' : 'AI Skills Assessment'}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {(interview as any).scheduled_at ? `Scheduled ${format(new Date((interview as any).scheduled_at), 'MMM d, yyyy HH:mm')} · ` : ''}Requested {format(new Date(interview.created_at), 'MMM d, yyyy')}
                        </p>
                        <Badge variant="secondary" className={`mt-1 text-[10px] ${
                          interview.status === 'in_progress' 
                            ? 'bg-blue-100 text-blue-700' 
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {interview.status === 'in_progress' ? 'Paused — Resume anytime' : 'Pending — Join anytime'}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      onClick={() => (interview as any).interview_style === 'live' ? navigate(`/interview/live/${interview.id}`) : openSession(interview.id, true)}
                      className="gap-2"
                    >
                      <Play className="w-4 h-4" />
                      {(interview as any).interview_style === 'live' ? 'Join live interview' : interview.status === 'in_progress' ? 'Resume' : 'Join Interview'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {pendingInterviews.length === 0 && (
            <Card className="rounded-2xl border-border/50">
              <CardContent className="p-8 text-center">
                <Brain className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <h3 className="font-semibold text-foreground">No Pending Interviews</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  You'll see interview links here when a re-interview is requested.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Completed Interviews */}
          {completedInterviews.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Completed ({completedInterviews.length})
              </h2>
              {completedInterviews.map((interview) => {
                const isReviewed = interview.status === 'reviewed';
                const score = interview.overall_score || 0;
                const scoreColor = score >= 70 ? 'bg-green-100 text-green-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
                return (
                <Card key={interview.id} className="rounded-2xl border-border/50">
                  <CardContent className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isReviewed ? 'bg-primary/10' : 'bg-green-500/10'}`}>
                        {isReviewed ? <CheckCircle className="w-6 h-6 text-primary" /> : <CheckCircle className="w-6 h-6 text-green-500" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          {(interview as any).interview_style === 'live' ? 'Live Interview' : interview.interview_type === 'physical' ? 'Manual Interview' : 'AI Skills Assessment'}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Completed {format(new Date(interview.created_at), 'MMM d, yyyy')}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {interview.overall_score != null && (
                            <Badge variant="secondary" className={`text-[10px] ${scoreColor}`}>
                              Score: {interview.overall_score}/100
                            </Badge>
                          )}
                          <Badge variant="secondary" className={`text-[10px] ${isReviewed ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {isReviewed ? 'Reviewed' : 'Pending Review'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    {interview.ai_summary && (
                      <p className="text-xs text-muted-foreground max-w-[200px] text-right hidden md:block">
                        {interview.ai_summary.slice(0, 80)}…
                      </p>
                    )}
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
