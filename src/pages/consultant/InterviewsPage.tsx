import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Video, Play, CheckCircle, Clock, Brain, ExternalLink } from 'lucide-react';
import AIInterviewFlow from '@/components/consultant/AIInterviewFlow';
import { format } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSessionReady } from '@/hooks/useSessionReady';

export default function InterviewsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [activeInterviewId, setActiveInterviewId] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { signedIn } = useSessionReady();
  const starting = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState('');

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

  const pendingInterviews = interviews?.filter(i => i.status === 'pending' || i.status === 'in_progress') || [];
  const completedInterviews = interviews?.filter(i => i.status === 'completed' || i.status === 'reviewed') || [];

  const handleStartOptionalInterview = async () => {
    if (isGuest || starting.current) return;
    starting.current = true;
    setIsStarting(true);
    setStartError('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error(t('interview.sign_in', 'Please sign in again.'));
      const { data: consultant, error: profileError } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (profileError) throw profileError;
      if (!consultant) throw new Error(t('interview.profile_required', 'Save your profile before starting the interview.'));
      // Resume a self-started assessment instead of creating duplicate pending interviews.
      const { data: pending, error: pendingError } = await supabase.from('interview_sessions')
        .select('id').eq('consultant_id', consultant.id).eq('interview_type', 'ai')
        .is('requested_by', null).in('status', ['pending', 'in_progress'])
        .neq('interview_style', 'live').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (pendingError) throw pendingError;
      if (pending) { setActiveInterviewId(pending.id); return; }
      const { data: session, error } = await supabase.from('interview_sessions')
        .insert({ consultant_id: consultant.id, interview_type: 'ai', status: 'pending', interview_style: 'standard' })
        .select('id').single();
      if (error) throw error;
      setActiveInterviewId(session.id);
      void refetch();
    } catch {
      setStartError(t('interview.start_failed', 'Could not start the interview. Check that your profile is saved and try again.'));
    } finally { starting.current = false; setIsStarting(false); }
  };

  useEffect(() => {
    if (searchParams.get('start') !== '1' || !signedIn || isGuest) return;
    const next = new URLSearchParams(searchParams);
    next.delete('start');
    setSearchParams(next, { replace: true });
    void handleStartOptionalInterview();
  }, [signedIn, isGuest, searchParams, setSearchParams]);

  if (activeInterviewId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => setActiveInterviewId(null)}>
          ← Back to Interviews
        </Button>
        <AIInterviewFlow
          interviewId={activeInterviewId}
          onComplete={() => {
            setActiveInterviewId(null);
            refetch();
            void queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
            void queryClient.invalidateQueries({ queryKey: ['consultant-interview-history'] });
          }}
          onCancel={() => setActiveInterviewId(null)}
        />
      </div>
    );
  }

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
        <Button onClick={handleStartOptionalInterview} disabled={isStarting || isGuest || !signedIn} className="gradient-primary border-0 gap-2">
          <Brain className="w-4 h-4" /> Start AI Interview
        </Button>
      </div>
      {startError && <p role="alert" className="text-sm text-destructive">{startError}</p>}

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
                      onClick={() => (interview as any).interview_style === 'live' ? navigate(`/interview/live/${interview.id}`) : setActiveInterviewId(interview.id)}
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
