import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ArrowLeft, Lock, Send, Lightbulb, Loader2, Mic, Square, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import LiveInterviewMeetingBar from '@/components/interview/LiveInterviewMeetingBar';
import InterviewRsvpCard from '@/components/interview/InterviewRsvpCard';
import InterviewResponsesCard from '@/components/interview/InterviewResponsesCard';

type Participant = {
  user_id: string;
  role: string;
  display_name: string | null;
  rsvp_status?: string | null;
  rsvp_note?: string | null;
  rsvp_at?: string | null;
  proposed_slots?: unknown;
};

const PARTICIPANT_COLUMNS = 'user_id, role, display_name, rsvp_status, rsvp_note, rsvp_at, proposed_slots';

type Msg = { id: string; sender_id: string; sender_name: string | null; content: string; is_private: boolean; created_at: string };

const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

export default function LiveInterviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [myName, setMyName] = useState('');
  const [role, setRole] = useState<'interviewer' | 'candidate' | 'admin' | null>(null);
  const [session, setSession] = useState<any>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [listening, setListening] = useState(false);
  const [scores, setScores] = useState({ technical: 70, soft: 70 });
  const [summary, setSummary] = useState('');
  const [finishing, setFinishing] = useState(false);
  const recRef = useRef<any>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const isInterviewer = role === 'interviewer' || role === 'admin';

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const [{ data: prof }, { data: sess }, { data: parts }, { data: msgs }, { data: isAdmin }] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
        supabase.from('interview_sessions').select('*').eq('id', id).maybeSingle(),
        supabase.from('interview_participants' as any).select(PARTICIPANT_COLUMNS).eq('session_id', id),
        supabase.from('interview_messages' as any).select('*').eq('session_id', id).order('created_at'),
        supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }),
      ]);
      setMyName(prof?.display_name || user.email?.split('@')[0] || 'Participant');
      setSession(sess);
      const p = (parts as any[]) || [];
      setParticipants(p);
      const mine = p.find((x) => x.user_id === user.id)?.role;
      setRole(mine || (isAdmin ? 'admin' : null));
      setMessages(((msgs as any[]) || []) as Msg[]);
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`live-interview-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'interview_messages', filter: `session_id=eq.${id}` }, (payload) => {
        const m = payload.new as Msg;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Re-read the session and the participants after an answer to the invitation or a reschedule.
  const reloadParticipants = async () => {
    if (!id) return;
    const [{ data: parts }, { data: sess }] = await Promise.all([
      supabase.from('interview_participants' as any).select(PARTICIPANT_COLUMNS).eq('session_id', id),
      supabase.from('interview_sessions').select('*').eq('id', id).maybeSingle(),
    ]);
    setParticipants(((parts as any[]) || []) as Participant[]);
    if (sess) setSession(sess);
  };

  const publicMsgs = useMemo(() => messages.filter((m) => !m.is_private), [messages]);
  const privateMsgs = useMemo(() => messages.filter((m) => m.is_private), [messages]);

  const post = async (content: string, isPrivate: boolean) => {
    const text = content.trim();
    if (!text || !id || !userId) return false;
    const { error } = await supabase.from('interview_messages' as any).insert({
      session_id: id, sender_id: userId, sender_name: myName, content: text.slice(0, 4000), is_private: isPrivate,
    });
    if (error) { toast.error(`Message not sent: ${error.message}`); return false; }
    return true;
  };

  const send = async () => {
    setSending(true);
    if (await post(input, false)) setInput('');
    setSending(false);
  };

  const toggleMic = () => {
    if (!SR) { toast.error('Voice input is not supported in this browser'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
      if (t) setInput((prev) => (prev ? prev + ' ' : '') + t.trim());
    };
    rec.onend = () => setListening(false);
    rec.start(); recRef.current = rec; setListening(true);
  };

  const getSuggestions = async () => {
    if (!id) return;
    setSuggesting(true);
    const history = publicMsgs.map((m) => ({
      role: participants.find((p) => p.user_id === m.sender_id)?.role === 'candidate' ? 'user' : 'assistant',
      content: m.content,
    })).slice(-40);
    const { data, error } = await invokeWithAuth('ai-interview-chat', {
      interview_id: id, messages: history, action: 'copilot',
    });
    setSuggesting(false);
    if (error || data?.error) {
      const msg = String(data?.error ?? error?.message ?? '');
      if (msg.includes('Invalid or expired session') || msg.includes('Unauthorized')) {
        toast.error('Your sign-in expired. Please sign in again.');
        navigate('/login');
        return;
      }
      toast.error(data?.error || 'Could not get suggestions');
      return;
    }
    setSuggestions(data?.suggestions || []);
  };

  const finish = async () => {
    if (!id) return;
    setFinishing(true);
    const overall = Math.round(scores.technical * 0.6 + scores.soft * 0.4);
    const { error } = await supabase.rpc('complete_live_interview' as any, {
      _session_id: id, _technical: scores.technical, _soft: scores.soft, _overall: overall, _summary: summary,
    });
    setFinishing(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Interview completed and scores saved');
    setSession((s: any) => ({ ...s, status: 'completed', overall_score: overall }));
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!session || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md text-center p-6 space-y-3">
          <p className="font-semibold">You don't have access to this interview.</p>
          <Button variant="outline" onClick={() => navigate(-1)}>Go back</Button>
        </Card>
      </div>
    );
  }

  const done = session.status === 'completed' || session.status === 'reviewed';
  const isOrganizer = !!userId && session.requested_by === userId;
  const canManage = isOrganizer || role === 'admin';
  const myParticipant = participants.find((p) => p.user_id === userId);
  const organizerName = participants.find((p) => p.user_id === session.requested_by)?.display_name || undefined;
  const nameOf = (m: Msg) => (m.sender_id === userId ? 'You' : m.sender_name || 'Participant');
  const roleOf = (uid: string) => participants.find((p) => p.user_id === uid)?.role;

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4 me-1" /> Back</Button>
          <h1 className="text-xl font-bold text-foreground">Live interview</h1>
          <Badge variant="secondary">{done ? 'Completed' : 'Live'}</Badge>
          {session.scheduled_at && <span className="text-xs text-muted-foreground">Scheduled {format(new Date(session.scheduled_at), 'MMM d, yyyy HH:mm')}</span>}
          <div className="ms-auto flex flex-wrap gap-1">
            {participants.map((p) => (
              <Badge key={p.user_id} variant="outline" className="text-[10px]">{p.display_name || 'Participant'} · {p.role}</Badge>
            ))}
          </div>
        </div>

        {!done && (
          <LiveInterviewMeetingBar
            sessionId={session.id}
            storedMeetingUrl={session.meeting_url}
            scheduledAt={session.scheduled_at}
            durationMinutes={session.duration_minutes}
            title={`Live interview: ${participants.find((p) => p.role === 'candidate')?.display_name || 'Candidate'}`}
            attendees={participants.map((p) => p.display_name || 'Participant')}
          />
        )}
        {!done && myParticipant && !isOrganizer && (
          <InterviewRsvpCard
            sessionId={session.id}
            status={myParticipant.rsvp_status || 'pending'}
            organizerName={organizerName}
            onAnswered={reloadParticipants}
          />
        )}
        {canManage && (
          <InterviewResponsesCard
            sessionId={session.id}
            organizerId={session.requested_by ?? null}
            people={participants}
            done={done}
            onChanged={reloadParticipants}
          />
        )}

        <div className={`grid gap-4 ${isInterviewer ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
          <Card className="rounded-2xl flex flex-col h-[70vh]">
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
              {publicMsgs.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">No messages yet. Say hello to start the discussion.</p>}
              {publicMsgs.map((m) => {
                const mine = m.sender_id === userId;
                return (
                  <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                      <div className="text-[10px] font-semibold opacity-80 mb-0.5">
                        {nameOf(m)}{roleOf(m.sender_id) ? ` · ${roleOf(m.sender_id)}` : ''} · {format(new Date(m.created_at), 'HH:mm')}
                      </div>
                      <div className="text-sm prose prose-sm max-w-none dark:prose-invert [&_*]:text-inherit"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </CardContent>
            {!done && (
              <div className="border-t p-3 flex gap-2 items-end">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Type your message… (Enter to send)"
                  className="min-h-[44px] max-h-32 resize-none"
                  aria-label="Message"
                />
                <Button variant={listening ? 'destructive' : 'outline'} size="icon" onClick={toggleMic} aria-label={listening ? 'Stop voice input' : 'Speak'}>
                  {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>
                <Button size="icon" onClick={send} disabled={sending || !input.trim()} aria-label="Send"><Send className="w-4 h-4" /></Button>
              </div>
            )}
          </Card>

          {isInterviewer && (
            <div className="space-y-4">
              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="w-4 h-4 text-primary" /> AI co-pilot</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">Only interviewers see these suggestions.</p>
                  <Button size="sm" variant="outline" onClick={getSuggestions} disabled={suggesting} className="w-full">
                    {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin me-1" /> : null} Suggest next questions
                  </Button>
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => setInput(s)} className="w-full text-left text-xs rounded-lg border p-2 hover:bg-muted transition-colors">{s}</button>
                  ))}
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Lock className="w-4 h-4" /> Private notes</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {privateMsgs.map((m) => (
                      <div key={m.id} className="text-xs rounded-md bg-muted p-2"><span className="font-semibold">{nameOf(m)}:</span> {m.content}</div>
                    ))}
                  </div>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to interviewers only" className="min-h-[60px] text-xs" />
                  <Button size="sm" variant="secondary" className="w-full" disabled={!note.trim()} onClick={async () => { if (await post(note, true)) setNote(''); }}>Save note</Button>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4 text-primary" /> Score sheet</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {done ? (
                    <p className="text-sm">Final score: <strong>{session.overall_score}/100</strong></p>
                  ) : (
                    <>
                      {(['technical', 'soft'] as const).map((k) => (
                        <div key={k} className="space-y-1.5">
                          <div className="flex justify-between text-xs"><Label>{k === 'technical' ? 'Technical SAP skills' : 'Communication & soft skills'}</Label><span className="font-semibold">{scores[k]}</span></div>
                          <Slider value={[scores[k]]} min={0} max={100} step={5} onValueChange={([v]) => setScores((s) => ({ ...s, [k]: v }))} />
                        </div>
                      ))}
                      <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary for the consultant's profile" className="min-h-[70px] text-xs" maxLength={4000} />
                      <Button className="w-full" onClick={finish} disabled={finishing}>
                        {finishing && <Loader2 className="w-3.5 h-3.5 animate-spin me-1" />} Finish interview
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
