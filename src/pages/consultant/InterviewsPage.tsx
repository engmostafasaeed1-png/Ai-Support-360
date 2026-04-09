import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Video, Play, CheckCircle, Clock, Brain, ExternalLink } from 'lucide-react';
import AIInterviewFlow from '@/components/consultant/AIInterviewFlow';
import { format } from 'date-fns';

export default function InterviewsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [activeInterviewId, setActiveInterviewId] = useState<string | null>(null);

  const { data: interviews, isLoading, refetch } = useQuery({
    queryKey: ['consultant-interviews'],
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
          }}
          onCancel={() => setActiveInterviewId(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI Interviews</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Join pending AI interviews or review your past results.
        </p>
      </div>

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
                        <h3 className="font-semibold text-foreground">AI Skills Assessment</h3>
                        <p className="text-xs text-muted-foreground">
                          Requested {format(new Date(interview.created_at), 'MMM d, yyyy')}
                        </p>
                        <Badge variant="secondary" className="mt-1 bg-amber-100 text-amber-700 text-[10px]">
                          Pending — Join anytime
                        </Badge>
                      </div>
                    </div>
                    <Button
                      onClick={() => setActiveInterviewId(interview.id)}
                      className="gap-2"
                    >
                      <Play className="w-4 h-4" />
                      Join Interview
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
                          {interview.interview_type === 'physical' ? 'Manual Interview' : 'AI Skills Assessment'}
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
