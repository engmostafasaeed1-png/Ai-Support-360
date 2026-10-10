import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAdminSendMatch } from '@/hooks/useMatchRequests';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Send, Brain, Star, Sparkles, Shield, Clock, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: string;
  ticketTitle: string;
  sapModule: string;
  ticketDescription?: string;
  ticketUrgency?: string;
}

const mockAiResults = {
  recommendations: [
    {
      consultant_id: 'c1', match_score: 96, match_reason: 'Ahmed has 8 years in SAP S/4HANA with certified expertise. Completed 3 similar projects in Finance domain. AI interview score of 94.5 confirms deep technical knowledge.',
      strengths: ['Certified SAP S/4HANA expert', '8 years module experience', '96% session completion rate', 'Fast 15-min response time'],
      concerns: [],
      skill_match_score: 98, experience_score: 95, availability_score: 90, reliability_score: 96, interview_score: 94,
      name: 'Ahmed Al-Rashid', hourly_rate: 150, currency: 'USD', rating: 4.9, total_reviews: 127, availability: 'available',
      response_time_minutes: 15, verification_status: 'verified', ai_skills_score: 94.5, session_completion_rate: 96, total_completed_sessions: 89, has_active_nda: true, top_skills: ['SAP S/4HANA', 'SAP FI/CO', 'SAP MM'], interview: { overall_score: 94, technical_score: 96, soft_skills_score: 91 },
    },
    {
      consultant_id: 'c2', match_score: 88, match_reason: 'Sara has strong S/4HANA skills with Fiori expertise. Her language match and high satisfaction score make her a solid choice. Slightly lower project depth.',
      strengths: ['Bilingual EN/AR', 'Fiori/UX cross-skill', 'High client satisfaction'],
      concerns: ['Fewer completed sessions'],
      skill_match_score: 85, experience_score: 82, availability_score: 95, reliability_score: 80, interview_score: 88,
      name: 'Sara Khalil', hourly_rate: 120, currency: 'USD', rating: 4.7, total_reviews: 89, availability: 'available',
      response_time_minutes: 22, verification_status: 'verified', ai_skills_score: 88, session_completion_rate: 91, total_completed_sessions: 42, has_active_nda: false, top_skills: ['SAP S/4HANA', 'SAP Fiori/UX'], interview: { overall_score: 88, technical_score: 85, soft_skills_score: 92 },
    },
    {
      consultant_id: 'c3', match_score: 79, match_reason: 'Omar has solid SAP MM background with relevant industry experience. Currently busy but strong track record when available.',
      strengths: ['Industry domain match', 'Strong project portfolio', 'Verified certifications'],
      concerns: ['Currently busy', 'Slower response time'],
      skill_match_score: 82, experience_score: 85, availability_score: 45, reliability_score: 88, interview_score: 91,
      name: 'Omar Mansour', hourly_rate: 130, currency: 'USD', rating: 4.8, total_reviews: 63, availability: 'busy',
      response_time_minutes: 45, verification_status: 'verified', ai_skills_score: 91, session_completion_rate: 94, total_completed_sessions: 56, has_active_nda: true, top_skills: ['SAP MM', 'SAP S/4HANA', 'SAP WM'], interview: { overall_score: 91, technical_score: 93, soft_skills_score: 87 },
    },
  ],
  overall_rationale: 'Ranked by weighted criteria: skill match (25%), project experience (20%), AI interview (15%), availability (15%), track record (10%), satisfaction (8%), language (5%), compliance (2%). Ahmed leads due to exceptional skill match and reliability.',
};

export default function SendMatchDialog({ open, onOpenChange, ticketId, ticketTitle, sapModule, ticketDescription, ticketUrgency }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sendMatch = useAdminSendMatch();
  const { isGuest } = useGuestMode();

  // AI-powered matching
  const { data: aiMatch, isLoading: aiLoading, error: aiError, refetch: refetchAi } = useQuery({
    queryKey: ['ai-match-consultants', ticketId, sapModule],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('ai-ticket', {
        body: {
          action: 'match_consultants',
          title: ticketTitle,
          description: ticketDescription || ticketTitle,
          sap_module: sapModule,
          urgency: ticketUrgency || 'medium',
        },
      });
      if (error) throw error;
      return data?.result;
    },
    enabled: open && !isGuest,
    staleTime: 5 * 60 * 1000,
    placeholderData: isGuest ? mockAiResults : undefined,
  });

  // Check already-sent
  const { data: existingRequests } = useQuery({
    queryKey: ['existing-match-requests', ticketId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_match_requests')
        .select('consultant_id')
        .eq('ticket_id', ticketId);
      return new Set((data || []).map((e: any) => e.consultant_id));
    },
    enabled: open && !isGuest,
    placeholderData: isGuest ? new Set(['c3']) : undefined,
  });

  const recommendations = aiMatch?.recommendations || [];
  const alreadySent = existingRequests || new Set<string>();
  const available = recommendations.filter((c: any) => !alreadySent.has(c.consultant_id));
  const sent = recommendations.filter((c: any) => alreadySent.has(c.consultant_id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleSend = async () => {
    if (isGuest) {
      toast.success(`Match requests sent to ${selected.size} consultant(s)! (Demo)`);
      setSelected(new Set());
      setMessage('');
      onOpenChange(false);
      return;
    }
    let sentCount = 0;
    for (const consultantId of selected) {
      try {
        await sendMatch.mutateAsync({ ticketId, consultantId, message: message || undefined });
        sentCount++;
      } catch {}
    }
    if (sentCount > 0) {
      toast.success(`Match requests sent to ${sentCount} consultant(s)!`);
      setSelected(new Set());
      setMessage('');
      onOpenChange(false);
    } else {
      toast.error('Failed to send match requests.');
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-600';
    if (score >= 75) return 'text-blue-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 90) return 'bg-emerald-500';
    if (score >= 75) return 'bg-blue-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI-Powered Match Suggestions
          </DialogTitle>
          <DialogDescription>
            Intelligent matching for "<span className="font-medium">{ticketTitle}</span>" ({sapModule}).
            Consultants ranked by skill match, experience, reliability, and availability.
          </DialogDescription>
        </DialogHeader>

        {aiMatch?.overall_rationale && (
          <div className="bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground border border-border/30">
            <span className="font-medium text-foreground">Ranking Logic: </span>
            {aiMatch.overall_rationale}
          </div>
        )}

        <div className="space-y-3 py-2">
          {aiLoading ? (
            [1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : aiError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center space-y-2">
              <p className="text-sm font-medium text-destructive">The AI match suggestions could not be loaded.</p>
              <p className="text-xs text-muted-foreground">Nothing was sent to any consultant. Please try again in a moment.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => refetchAi()}>Try again</Button>
            </div>
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No matching consultants found.</p>
          ) : (
            available.map((c: any, idx: number) => {
              const isExpanded = expandedId === c.consultant_id;
              return (
                <div
                  key={c.consultant_id}
                  className={`rounded-xl border transition-all ${
                    selected.has(c.consultant_id) ? 'border-primary bg-primary/5' : 'border-border/50 hover:bg-muted/20'
                  }`}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer"
                    onClick={() => toggle(c.consultant_id)}
                  >
                    <Checkbox checked={selected.has(c.consultant_id)} onCheckedChange={() => toggle(c.consultant_id)} />
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                        {(c.name || '??').split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${getScoreBg(c.match_score)} flex items-center justify-center text-[9px] font-bold text-white`}>
                        {idx + 1}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{c.name}</p>
                        {c.has_active_nda && <Shield className="w-3.5 h-3.5 text-emerald-500" />}
                        {c.verification_status === 'verified' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> {c.rating} ({c.total_reviews})</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {c.response_time_minutes}m</span>
                        <span>${c.hourly_rate}/hr</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-lg font-bold ${getScoreColor(c.match_score)}`}>{c.match_score}</p>
                      <p className="text-[10px] text-muted-foreground">match</p>
                    </div>
                    <Button
                      variant="ghost" size="sm" className="p-1 h-auto"
                      onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : c.consultant_id); }}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-border/30 space-y-3">
                      <p className="text-xs text-muted-foreground">{c.match_reason}</p>

                      {/* Score breakdown */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { label: 'Skill Match', value: c.skill_match_score },
                          { label: 'Experience', value: c.experience_score },
                          { label: 'Availability', value: c.availability_score },
                          { label: 'Reliability', value: c.reliability_score },
                          { label: 'AI Interview', value: c.interview_score },
                        ].filter(s => s.value != null).map(s => (
                          <div key={s.label} className="space-y-1">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">{s.label}</span>
                              <span className={`font-medium ${getScoreColor(s.value)}`}>{s.value}</span>
                            </div>
                            <Progress value={s.value} className="h-1.5" />
                          </div>
                        ))}
                      </div>

                      {/* Strengths & concerns */}
                      <div className="flex flex-wrap gap-1.5">
                        {(c.strengths || []).map((s: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[10px] gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" /> {s}
                          </Badge>
                        ))}
                        {(c.concerns || []).map((s: string, i: number) => (
                          <Badge key={`c-${i}`} variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
                            <AlertTriangle className="w-2.5 h-2.5" /> {s}
                          </Badge>
                        ))}
                      </div>

                      {/* Skills & stats */}
                      <div className="flex flex-wrap gap-1">
                        {(c.top_skills || []).map((s: string) => (
                          <Badge key={s} className="text-[9px] bg-primary/10 text-primary border-0">{s}</Badge>
                        ))}
                      </div>

                      <div className="flex gap-4 text-[10px] text-muted-foreground">
                        {c.session_completion_rate != null && <span>✅ {c.session_completion_rate}% completion</span>}
                        {c.total_completed_sessions != null && <span>📋 {c.total_completed_sessions} sessions</span>}
                        {c.interview?.overall_score && <span>🧠 Interview: {c.interview.overall_score}/100</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {sent.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Already invited:</p>
              <div className="flex flex-wrap gap-2">
                {sent.map((c: any) => (
                  <Badge key={c.consultant_id} variant="secondary" className="text-[10px]">{c.name} ({c.match_score})</Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Optional message to consultants</label>
            <Textarea
              placeholder="e.g. Urgent — client needs help with month-end close..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 text-sm"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="gradient-primary border-0"
            disabled={selected.size === 0 || sendMatch.isPending}
            onClick={handleSend}
          >
            <Send className="w-4 h-4 me-1" /> Send to {selected.size} Consultant{selected.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
