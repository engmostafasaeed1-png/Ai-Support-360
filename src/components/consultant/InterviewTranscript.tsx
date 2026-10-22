import { useSessionReady } from '@/hooks/useSessionReady';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain, MessageSquare, CheckCircle, XCircle, TrendingUp,
  BarChart3, Clock, Award, User, Bot, ChevronDown, ChevronUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface InterviewTranscriptProps {
  consultantId: string;
  viewMode?: 'consultant' | 'client';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function InterviewTranscript({ consultantId, viewMode = 'consultant' }: InterviewTranscriptProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const signedIn = useSessionReady().signedIn;
  const { data: interviews, isLoading } = useQuery({
    queryKey: ['interview-transcripts', consultantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interview_sessions')
        .select('*')
        .eq('consultant_id', consultantId)
        .in('status', ['completed', 'reviewed'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: signedIn && (!!consultantId),
  });

  const signedIn2 = useSessionReady().signedIn;
  const { data: answers } = useQuery({
    queryKey: ['interview-answers', consultantId],
    queryFn: async () => {
      if (!interviews?.length) return [];
      const ids = interviews.map(i => i.id);
      const { data, error } = await supabase
        .from('interview_answers')
        // named columns: question_source is admin-only (docs/sql/interview-knowledge.sql)
        .select('id, interview_id, question, answer_transcript, category, score, ai_feedback, question_order, created_at, sap_module')
        .in('interview_id', ids)
        .order('question_order');
      if (error) throw error;
      return data || [];
    },
    enabled: signedIn2 && (!!interviews?.length),
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  }

  if (!interviews?.length) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-8 text-center">
          <Brain className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No completed interviews yet.</p>
        </CardContent>
      </Card>
    );
  }

  // Compute statistics
  const totalInterviews = interviews.length;
  const avgScore = interviews.reduce((sum, i) => sum + (i.overall_score || 0), 0) / totalInterviews;
  const avgTechnical = interviews.reduce((sum, i) => sum + (i.technical_score || 0), 0) / totalInterviews;
  const avgSoftSkills = interviews.reduce((sum, i) => sum + (i.soft_skills_score || 0), 0) / totalInterviews;
  const passedCount = interviews.filter(i => (i.overall_score || 0) >= 70).length;
  const latestScore = interviews[0]?.overall_score || 0;
  const trend = interviews.length > 1 ? (interviews[0]?.overall_score || 0) - (interviews[1]?.overall_score || 0) : 0;

  return (
    <div className="space-y-5">
      {/* Statistics Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-xl border-border/50">
          <CardContent className="p-4 text-center">
            <BarChart3 className="w-5 h-5 text-primary mx-auto mb-1.5" />
            <p className="text-2xl font-bold text-foreground">{Math.round(avgScore)}</p>
            <p className="text-[10px] text-muted-foreground">Avg. Score</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border/50">
          <CardContent className="p-4 text-center">
            <Brain className="w-5 h-5 text-blue-500 mx-auto mb-1.5" />
            <p className="text-2xl font-bold text-foreground">{Math.round(avgTechnical)}</p>
            <p className="text-[10px] text-muted-foreground">Avg. Technical</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border/50">
          <CardContent className="p-4 text-center">
            <MessageSquare className="w-5 h-5 text-green-500 mx-auto mb-1.5" />
            <p className="text-2xl font-bold text-foreground">{Math.round(avgSoftSkills)}</p>
            <p className="text-[10px] text-muted-foreground">Avg. Soft Skills</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border/50">
          <CardContent className="p-4 text-center">
            <TrendingUp className={`w-5 h-5 mx-auto mb-1.5 ${trend >= 0 ? 'text-green-500' : 'text-red-500'}`} />
            <p className="text-2xl font-bold text-foreground">
              {trend >= 0 ? '+' : ''}{trend}
            </p>
            <p className="text-[10px] text-muted-foreground">Score Trend</p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Bar */}
      <Card className="rounded-xl border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Pass Rate</span>
            <span className="text-xs text-muted-foreground">{passedCount}/{totalInterviews} interviews passed (≥70)</span>
          </div>
          <Progress value={(passedCount / totalInterviews) * 100} className="h-2" />
        </CardContent>
      </Card>

      {/* Interview List with Transcripts */}
      {interviews.map(interview => {
        const isExpanded = expandedId === interview.id;
        const conversation = interview.skill_results as unknown as ChatMessage[] | null;
        const interviewAnswers = (answers || []).filter(a => a.interview_id === interview.id);
        const scoreColor = (interview.overall_score || 0) >= 70 ? 'text-green-600' : (interview.overall_score || 0) >= 50 ? 'text-amber-600' : 'text-red-600';
        const scoreBg = (interview.overall_score || 0) >= 70 ? 'bg-green-500/10' : (interview.overall_score || 0) >= 50 ? 'bg-amber-500/10' : 'bg-red-500/10';

        return (
          <Card key={interview.id} className="rounded-2xl border-border/50 overflow-hidden">
            {/* Header */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : interview.id)}
              className="w-full p-5 flex items-center justify-between hover:bg-muted/20 transition-colors text-left"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl ${scoreBg} flex items-center justify-center`}>
                  <span className={`text-lg font-bold ${scoreColor}`}>{interview.overall_score || '—'}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground text-sm">
                      {interview.interview_type === 'physical' ? 'Manual Interview' : 'AI Interview'}
                    </h3>
                    <Badge variant="secondary" className={`text-[10px] ${
                      interview.status === 'reviewed' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {interview.status === 'reviewed' ? 'Reviewed' : 'Completed'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(interview.created_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right hidden md:block">
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>Tech: <strong className="text-foreground">{interview.technical_score || '—'}</strong></span>
                    <span>Soft: <strong className="text-foreground">{interview.soft_skills_score || '—'}</strong></span>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Expanded Content */}
            {isExpanded && (
              <div className="border-t border-border/50">
                <Tabs defaultValue="transcript" className="w-full">
                  <TabsList className="w-full justify-start rounded-none border-b border-border/30 bg-transparent h-auto p-0">
                    <TabsTrigger value="transcript" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2.5 px-4">
                      💬 Full Transcript
                    </TabsTrigger>
                    <TabsTrigger value="analysis" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2.5 px-4">
                      📊 Answer Analysis
                    </TabsTrigger>
                    <TabsTrigger value="summary" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary text-xs py-2.5 px-4">
                      📝 Summary
                    </TabsTrigger>
                  </TabsList>

                  {/* Transcript Tab */}
                  <TabsContent value="transcript" className="p-4 max-h-[500px] overflow-y-auto">
                    {conversation && conversation.length > 0 ? (
                      <div className="space-y-3">
                        {conversation.map((msg, idx) => (
                          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                              msg.role === 'assistant' ? 'bg-primary/10' : 'bg-accent/10'
                            }`}>
                              {msg.role === 'assistant' ? <Bot className="w-3.5 h-3.5 text-primary" /> : <User className="w-3.5 h-3.5 text-accent" />}
                            </div>
                            <div className={`max-w-[80%] rounded-xl p-3 text-sm ${
                              msg.role === 'assistant' 
                                ? 'bg-muted/30 border border-border/30 text-foreground' 
                                : 'bg-primary/10 border border-primary/20 text-foreground'
                            }`}>
                              <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1 [&>p:last-child]:mb-0">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        Transcript not available for this interview.
                      </p>
                    )}
                  </TabsContent>

                  {/* Analysis Tab */}
                  <TabsContent value="analysis" className="p-4">
                    {interviewAnswers.length > 0 ? (
                      <div className="space-y-3">
                        {interviewAnswers.map((a, idx) => (
                          <div key={a.id} className="p-3 rounded-xl border border-border/30 bg-muted/10">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                  {idx + 1}
                                </span>
                                <p className="text-xs font-medium text-foreground line-clamp-2">{a.question}</p>
                              </div>
                              {a.score != null && (() => {
                                const status = a.score >= 70 ? 'Good' : a.score >= 40 ? 'Mild' : 'Far Away';
                                const styles = a.score >= 70
                                  ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'
                                  : a.score >= 40
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
                                  : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';
                                const Icon = a.score >= 70 ? CheckCircle : a.score >= 40 ? TrendingUp : XCircle;
                                return (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <Badge variant="secondary" className={`text-[10px] ${styles}`}>
                                      <Icon className="w-2.5 h-2.5 me-0.5" />
                                      {status}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">{a.score}/100</span>
                                  </div>
                                );
                              })()}
                            </div>
                            {a.answer_transcript && (
                              <div className="bg-background rounded-lg p-2 mb-2 border border-border/20">
                                <p className="text-xs text-muted-foreground line-clamp-3">{a.answer_transcript}</p>
                              </div>
                            )}
                            {a.ai_feedback && (
                              <div className="bg-primary/5 rounded-lg p-2 border border-primary/10">
                                <p className="text-[10px] text-muted-foreground">
                                  <strong className="text-foreground">AI Feedback:</strong> {a.ai_feedback}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        Detailed answer analysis not available.
                      </p>
                    )}
                  </TabsContent>

                  {/* Summary Tab */}
                  <TabsContent value="summary" className="p-4">
                    <div className="space-y-4">
                      {interview.ai_summary && (
                        <div className="p-4 rounded-xl bg-muted/20 border border-border/30">
                          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                            <Award className="w-3.5 h-3.5 text-primary" /> AI Summary
                          </h4>
                          <p className="text-sm text-muted-foreground">{interview.ai_summary}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-center">
                          <p className="text-xl font-bold text-foreground">{interview.technical_score || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">Technical</p>
                        </div>
                        <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/10 text-center">
                          <p className="text-xl font-bold text-foreground">{interview.soft_skills_score || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">Soft Skills</p>
                        </div>
                        <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-center">
                          <p className="text-xl font-bold text-foreground">{interview.overall_score || '—'}</p>
                          <p className="text-[10px] text-muted-foreground">Overall</p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
