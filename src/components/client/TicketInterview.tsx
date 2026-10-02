import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import {
  Video, Calendar, Clock, CheckCircle2, AlertTriangle, Play, X,
  Brain, Eye, Shield, FileText, MessageSquare, Loader2, UserCheck,
  Bot, MapPin,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import TimeSlotPicker, { type ProposedSlot } from '@/components/ui/TimeSlotPicker';

interface Props {
  ticketId: string;
  consultantId: string | null;
  clientId: string;
  isClient: boolean;
  isConsultant: boolean;
  consultantName?: string;
}

const statusConfig: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending: { color: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Pending' },
  scheduled: { color: 'bg-blue-100 text-blue-700', icon: Calendar, label: 'Scheduled' },
  in_progress: { color: 'bg-purple-100 text-purple-700', icon: Video, label: 'In Progress' },
  completed: { color: 'bg-green-100 text-green-700', icon: CheckCircle2, label: 'Completed' },
  cancelled: { color: 'bg-muted text-muted-foreground', icon: X, label: 'Cancelled' },
};

const interviewTypes = [
  { value: 'ai' as const, icon: Bot, label: 'AI Interview', desc: 'Automated AI assessment' },
  { value: 'physical' as const, icon: MapPin, label: 'Physical', desc: 'In-person meeting' },
  { value: 'online' as const, icon: Video, label: 'Online', desc: 'Video call interview' },
];

export default function TicketInterview({ ticketId, consultantId, clientId, isClient, isConsultant, consultantName }: Props) {
  const qc = useQueryClient();
  const [requestOpen, setRequestOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [interviewType, setInterviewType] = useState<'ai' | 'physical' | 'online'>('ai');
  const [proposedSlots, setProposedSlots] = useState<ProposedSlot[]>([]);

  const needsScheduling = interviewType === 'physical' || interviewType === 'online';

  const { data: userId } = useQuery({
    queryKey: ['current-user-id-interview'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  const { data: interviews, isLoading } = useQuery({
    queryKey: ['ticket-interviews', ticketId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_interviews')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
    enabled: !!ticketId,
  });

  const latestInterview = interviews?.[0];
  const hasActiveInterview = latestInterview && !['completed', 'cancelled'].includes(latestInterview.status);

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!consultantId || !userId) throw new Error('Missing data');

      const slotsData = proposedSlots.map(s => ({
        date: format(s.date, 'yyyy-MM-dd'),
        start_time: s.startTime,
        end_time: s.endTime,
      }));

      const roomId = `interview-${ticketId}-${Date.now()}`;
      const { error } = await supabase.from('ticket_interviews').insert({
        ticket_id: ticketId,
        client_id: userId,
        consultant_id: consultantId,
        room_id: roomId,
        client_notes: notes || null,
        interview_type: interviewType,
        proposed_slots: needsScheduling ? slotsData : null,
      });
      if (error) throw error;
      // The administrators are notified by a database trigger (a browser may not write notifications for other users).
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-interviews', ticketId] });
      toast.success('Interview requested! The consultant will be notified.');
      setRequestOpen(false);
      setNotes('');
      setInterviewType('ai');
      setProposedSlots([]);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startMutation = useMutation({
    mutationFn: async (interviewId: string) => {
      const { error } = await supabase
        .from('ticket_interviews')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', interviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-interviews', ticketId] });
      setVideoOpen(true);
    },
  });

  const endMutation = useMutation({
    mutationFn: async (interviewId: string) => {
      const { error } = await supabase
        .from('ticket_interviews')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', interviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-interviews', ticketId] });
      setVideoOpen(false);
      toast.success('Interview completed!');
    },
  });

  const analyzeInterview = async (interviewId: string) => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-interview-analysis', {
        body: { interview_id: interviewId },
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['ticket-interviews', ticketId] });
      toast.success('AI analysis complete!');
      setReportOpen(true);
    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const cancelMutation = useMutation({
    mutationFn: async (interviewId: string) => {
      const { error } = await supabase
        .from('ticket_interviews')
        .update({ status: 'cancelled' })
        .eq('id', interviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-interviews', ticketId] });
      toast.success('Interview cancelled');
    },
  });

  if (!consultantId) {
    return (
      <Card className="rounded-2xl border-dashed border-border/50">
        <CardContent className="p-5 text-center text-sm text-muted-foreground">
          <Video className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>Assign a consultant first to request a pre-work interview.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" />;

  return (
    <div className="space-y-3">
      {isClient && !hasActiveInterview && (
        <Card className="rounded-2xl border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Video className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Pre-Work Interview</p>
              <p className="text-xs text-muted-foreground">
                Interview {consultantName || 'the consultant'} before starting work
              </p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setRequestOpen(true)}>
              <Video className="w-3.5 h-3.5" /> Request
            </Button>
          </CardContent>
        </Card>
      )}

      {interviews?.map(interview => {
        const config = statusConfig[interview.status] || statusConfig.pending;
        const StatusIcon = config.icon;
        const hasReport = interview.ai_summary || interview.body_language_analysis;

        return (
          <Card key={interview.id} className="rounded-2xl border-border/50">
            <div className={`px-4 py-2.5 flex items-center gap-2 text-sm font-semibold rounded-t-2xl ${config.color}`}>
              <StatusIcon className="w-4 h-4" />
              {config.label}
              {interview.scheduled_at && (
                <span className="text-xs font-normal ms-auto">
                  {format(new Date(interview.scheduled_at), 'MMM d, h:mm a')}
                </span>
              )}
            </div>

            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDistanceToNow(new Date(interview.created_at), { addSuffix: true })}</span>
                {interview.started_at && interview.ended_at && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {Math.round((new Date(interview.ended_at).getTime() - new Date(interview.started_at).getTime()) / 60000)} min
                  </span>
                )}
              </div>

              {interview.client_notes && (
                <div className="p-2.5 rounded-lg bg-muted/20 text-xs">
                  <span className="font-semibold text-foreground">Client Notes: </span>
                  {interview.client_notes}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {interview.status === 'pending' && (
                  <>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={() => startMutation.mutate(interview.id)}>
                      <Play className="w-3.5 h-3.5" /> Start Interview
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1.5 text-xs" onClick={() => cancelMutation.mutate(interview.id)}>
                      <X className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  </>
                )}
                {interview.status === 'in_progress' && (
                  <>
                    <Button size="sm" className="gap-1.5 text-xs" onClick={() => setVideoOpen(true)}>
                      <Video className="w-3.5 h-3.5" /> Join Room
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => endMutation.mutate(interview.id)}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> End Interview
                    </Button>
                  </>
                )}
                {interview.status === 'completed' && (
                  <>
                    {!hasReport && (
                      <Button size="sm" className="gap-1.5 text-xs" onClick={() => analyzeInterview(interview.id)} disabled={analyzing}>
                        {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                        {analyzing ? 'Analyzing…' : 'AI Analysis'}
                      </Button>
                    )}
                    {hasReport && (
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setReportOpen(true)}>
                        <FileText className="w-3.5 h-3.5" /> View Report
                      </Button>
                    )}
                  </>
                )}
              </div>

              {interview.overall_recommendation && (
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
                  <p className="text-xs font-semibold text-primary flex items-center gap-1 mb-1">
                    <Brain className="w-3.5 h-3.5" /> AI Recommendation
                  </p>
                  <p className="text-xs text-foreground">{interview.overall_recommendation}</p>
                </div>
              )}
            </CardContent>

            <Dialog open={videoOpen && (interview.status === 'in_progress')} onOpenChange={setVideoOpen}>
              <DialogContent className="max-w-4xl h-[80vh]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Video className="w-5 h-5 text-primary" /> Pre-Work Interview
                  </DialogTitle>
                </DialogHeader>
                <div className="flex-1 rounded-xl overflow-hidden bg-black">
                  <iframe
                    src={`https://meet.jit.si/${interview.room_id}#config.prejoinPageEnabled=false&config.startWithAudioMuted=false&config.startWithVideoMuted=false&interfaceConfig.TOOLBAR_BUTTONS=["microphone","camera","closedcaptions","desktop","fullscreen","fodeviceselection","hangup","chat","recording","livestreaming","etherpad","settings","raisehand","videoquality","filmstrip","feedback","stats","shortcuts","tileview","download","help","mute-everyone","security","participants-pane","e2ee"]`}
                    allow="camera;microphone;display-capture;autoplay;clipboard-write"
                    className="w-full h-full border-0"
                    style={{ minHeight: '60vh' }}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="destructive" size="sm" onClick={() => endMutation.mutate(interview.id)}>
                    End Interview
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {hasReport && (
              <Dialog open={reportOpen} onOpenChange={setReportOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-primary" /> Interview AI Report
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {interview.ai_summary && (
                      <ReportSection icon={MessageSquare} title="Summary" content={interview.ai_summary} />
                    )}

                    {interview.body_language_analysis && typeof interview.body_language_analysis === 'object' && Object.keys(interview.body_language_analysis).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          <Eye className="w-4 h-4 text-primary" /> Body Language & Facial Analysis
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(interview.body_language_analysis as Record<string, any>).map(([key, val]) => (
                            <div key={key} className="p-2.5 rounded-lg bg-muted/20">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{key.replace(/_/g, ' ')}</p>
                              <p className="text-sm font-semibold">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {interview.facial_verification_result && typeof interview.facial_verification_result === 'object' && Object.keys(interview.facial_verification_result).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          <UserCheck className="w-4 h-4 text-primary" /> Identity Verification
                        </p>
                        <div className="p-3 rounded-lg bg-muted/20">
                          {Object.entries(interview.facial_verification_result as Record<string, any>).map(([key, val]) => (
                            <div key={key} className="flex justify-between py-1 text-xs border-b last:border-0 border-border/30">
                              <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                              <span className="font-medium">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {interview.overall_recommendation && (
                      <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
                        <p className="text-sm font-semibold text-primary flex items-center gap-1.5 mb-1">
                          <Shield className="w-4 h-4" /> Overall Recommendation
                        </p>
                        <p className="text-sm">{interview.overall_recommendation}</p>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </Card>
        );
      })}

      {/* Request Interview Dialog */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-5 h-5 text-primary" /> Request Pre-Work Interview
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Schedule an interview with {consultantName || 'the assigned consultant'} before starting work.
            </p>

            {/* Interview Type Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Interview Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {interviewTypes.map(type => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => {
                      setInterviewType(type.value);
                      if (type.value === 'ai') setProposedSlots([]);
                    }}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center',
                      interviewType === type.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30'
                    )}
                  >
                    <type.icon className={cn('w-5 h-5', interviewType === type.value ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="text-[11px] font-medium">{type.label}</span>
                    <span className="text-[9px] text-muted-foreground leading-tight">{type.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Time Slot Picker for physical/online */}
            {needsScheduling && (
              <TimeSlotPicker
                slots={proposedSlots}
                onChange={setProposedSlots}
                maxSlots={5}
              />
            )}

            <div className="space-y-1.5">
              <Label>Notes for the Consultant (optional)</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Topics to discuss, expectations, questions…"
                rows={3}
              />
            </div>

            {interviewType === 'ai' && (
              <div className="p-3 rounded-lg bg-muted/20 space-y-1.5">
                <p className="text-xs font-semibold">AI Interview includes:</p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Video className="w-3 h-3" /> HD Video Call</span>
                  <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Live Chat</span>
                  <span className="flex items-center gap-1"><Brain className="w-3 h-3" /> AI Transcript</span>
                  <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> Body Language Analysis</span>
                  <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" /> Identity Verification</span>
                  <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> AI Recommendations</span>
                </div>
              </div>
            )}

            <Button
              className="w-full gap-1.5"
              onClick={() => {
                if (needsScheduling && proposedSlots.length === 0) {
                  toast.error('Please propose at least one time slot');
                  return;
                }
                requestMutation.mutate();
              }}
              disabled={requestMutation.isPending}
            >
              {requestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              {requestMutation.isPending ? 'Requesting…' : 'Request Interview'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportSection({ icon: Icon, title, content }: { icon: typeof MessageSquare; title: string; content: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-primary" /> {title}
      </p>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{content}</p>
    </div>
  );
}
