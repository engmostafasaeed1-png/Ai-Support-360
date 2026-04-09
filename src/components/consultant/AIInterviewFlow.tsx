import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain, Loader2, CheckCircle, Send, AlertTriangle, Video, VideoOff,
  Mic, MicOff, Monitor, PhoneOff, MessageSquare, Award, Volume2, VolumeX,
  Gauge, Globe, User, Eye, Smile, Activity,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import ReactMarkdown from 'react-markdown';
import aiMaleAvatar from '@/assets/ai-interviewer-male.jpg';
import aiFemaleAvatar from '@/assets/ai-interviewer-female.jpg';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface EvaluationResult {
  technical_score: number;
  soft_skills_score: number;
  overall_score: number;
  summary: string;
  strengths?: string[];
  improvements?: string[];
  detailed_feedback?: string;
}

interface BodyLanguageResult {
  eye_contact_score: number;
  facial_expression_score: number;
  posture_score: number;
  confidence_score: number;
  engagement_score: number;
  professional_presence_score: number;
  overall_body_language_score: number;
  summary: string;
  observations?: string[];
  tips?: string[];
}

interface Props {
  interviewId: string;
  onComplete: () => void;
  onCancel: () => void;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-interview-chat`;
const BODY_LANG_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-body-language`;

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

function SpeakingIndicator() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: '0.15s' }} />
      <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" style={{ animationDelay: '0.3s' }} />
    </div>
  );
}

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

function ScoreBar({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div className="w-5 h-5 text-muted-foreground shrink-0">{icon}</div>
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-foreground font-medium">{label}</span>
          <span className="text-muted-foreground">{score}/100</span>
        </div>
        <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
          <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${score}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function AIInterviewFlow({ interviewId, onComplete, onCancel }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'chat' | 'evaluating' | 'results'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [bodyLanguage, setBodyLanguage] = useState<BodyLanguageResult | null>(null);
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('male');
  const avatarImg = voiceGender === 'male' ? aiMaleAvatar : aiFemaleAvatar;
  const [speechRate, setSpeechRate] = useState(1.0);
  const [interviewLang, setInterviewLang] = useState<'en' | 'fr' | 'ar' | 'es' | 'de' | 'ar-SA'>('en');
  const [conversationMode, setConversationMode] = useState(true);
  const [capturedFrames, setCapturedFrames] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const lastSpokenRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingTextRef = useRef('');
  const shouldAutoResumeRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);

  // Webcam refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const framesRef = useRef<string[]>([]);
  const frameCaptureRef = useRef<ReturnType<typeof setInterval>>();

  // --- Webcam setup ---
  useEffect(() => {
    if (camOn) {
      navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } })
        .then(stream => {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          // Capture a frame every 30 seconds for body language analysis
          frameCaptureRef.current = setInterval(() => {
            captureFrame();
          }, 30000);
          // Capture first frame after 3 seconds
          setTimeout(() => captureFrame(), 3000);
        })
        .catch(err => {
          console.error('Camera access denied:', err);
          setCamOn(false);
        });
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [camOn]);

  const stopCamera = () => {
    if (frameCaptureRef.current) clearInterval(frameCaptureRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0) return;
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 320, 240);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    framesRef.current.push(dataUrl);
    setCapturedFrames(framesRef.current.length);
  };

  // Timer
  useEffect(() => {
    if (phase === 'chat') {
      timerRef.current = setInterval(() => setElapsedTime(t => t + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sendToAI([]);
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      window.speechSynthesis.cancel();
      stopCamera();
    };
  }, []);

  const scheduleSilenceSend = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      const text = pendingTextRef.current.trim();
      if (text) {
        pendingTextRef.current = '';
        setInput('');
        setInterimTranscript('');
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
          recognitionRef.current = null;
        }
        setIsListening(false);
        const userMsg: ChatMessage = { role: 'user', content: text };
        const newHistory = [...messagesRef.current, userMsg];
        setMessages(newHistory);
        sendToAI(newHistory);
      }
    }, 1800);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const speakText = useCallback((text: string) => {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[#*_`~\[\]()>]/g, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
    if (!cleanText || cleanText === lastSpokenRef.current) return;
    lastSpokenRef.current = cleanText;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = speechRate;
    utterance.pitch = voiceGender === 'female' ? 1.1 : 0.85;
    utterance.volume = 1.0;
    const langMap: Record<string, string> = { 'en': 'en-US', 'fr': 'fr-FR', 'ar': 'ar-EG', 'es': 'es-ES', 'de': 'de-DE', 'ar-SA': 'ar-SA' };
    utterance.lang = langMap[interviewLang] || 'en-US';

    const voices = window.speechSynthesis.getVoices();
    const langPrefix = interviewLang.startsWith('ar') ? 'ar' : interviewLang;
    const genderHints = voiceGender === 'female'
      ? ['female', 'woman', 'zira', 'samantha', 'karen', 'victoria', 'fiona', 'Google.*Female']
      : ['male', 'man', 'david', 'daniel', 'james', 'Google.*Male', 'alex'];
    const matchesGender = (name: string) => genderHints.some(h => new RegExp(h, 'i').test(name));
    const preferred = voices.find(v => v.lang.startsWith(langPrefix) && matchesGender(v.name) && !v.localService)
      || voices.find(v => v.lang.startsWith(langPrefix) && matchesGender(v.name))
      || voices.find(v => v.lang.startsWith(langPrefix) && !v.localService)
      || voices.find(v => v.lang.startsWith(langPrefix));
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      if (conversationMode && shouldAutoResumeRef.current && SpeechRecognition) {
        setTimeout(() => startListening(), 300);
      }
    };
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [ttsEnabled, speechRate, voiceGender, interviewLang]);

  const startListening = useCallback(() => {
    if (!SpeechRecognition || isListening) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    const sttLangMap: Record<string, string> = { 'en': 'en-US', 'fr': 'fr-FR', 'ar': 'ar-EG', 'es': 'es-ES', 'de': 'de-DE', 'ar-SA': 'ar-SA' };
    recognition.lang = sttLangMap[interviewLang] || 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += transcript;
        else interim += transcript;
      }
      if (final) {
        pendingTextRef.current = (pendingTextRef.current + ' ' + final).trim();
        setInput(pendingTextRef.current);
        setInterimTranscript('');
        if (conversationMode) scheduleSilenceSend();
      } else {
        setInterimTranscript(interim);
        if (conversationMode && silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') setIsListening(false);
    };
    recognition.onend = () => { setIsListening(false); setInterimTranscript(''); };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, interviewLang]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening(); else startListening();
  }, [isListening, startListening, stopListening]);

  const sendToAI = async (chatHistory: ChatMessage[]) => {
    setIsStreaming(true);
    setIsSpeaking(true);
    lastSpokenRef.current = '';
    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ interview_id: interviewId, messages: chatHistory, lang: interviewLang }),
      });
      if (!resp.ok || !resp.body) {
        if (resp.status === 429) { setError('Rate limited — please try again in a moment.'); setIsStreaming(false); setIsSpeaking(false); return; }
        throw new Error('Failed to connect to interviewer');
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantText += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && prev.length === chatHistory.length + 1) {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantText } : m);
                }
                return [...prev, { role: 'assistant', content: assistantText }];
              });
            }
          } catch { buffer = line + '\n' + buffer; break; }
        }
      }
      if (assistantText) speakText(assistantText);
    } catch (err: any) {
      console.error('Stream error:', err);
      setError(err.message || 'Connection failed');
    } finally {
      setIsStreaming(false);
      if (!ttsEnabled) {
        setTimeout(() => {
          setIsSpeaking(false);
          if (conversationMode && shouldAutoResumeRef.current && SpeechRecognition) startListening();
        }, 500);
      }
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    setInterimTranscript('');
    pendingTextRef.current = '';
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (isListening) stopListening();
    const userMsg: ChatMessage = { role: 'user', content: text };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    await sendToAI(newHistory);
    inputRef.current?.focus();
  };

  const analyzeBodyLanguage = async (): Promise<BodyLanguageResult | null> => {
    if (framesRef.current.length === 0) return null;
    try {
      const resp = await fetch(BODY_LANG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ frames: framesRef.current }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.analysis || null;
    } catch (err) {
      console.error('Body language analysis error:', err);
      return null;
    }
  };

  const handleEndInterview = async () => {
    shouldAutoResumeRef.current = false;
    setPhase('evaluating');
    clearInterval(timerRef.current);
    if (isListening) stopListening();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    window.speechSynthesis.cancel();

    // Capture one last frame before analysis
    captureFrame();

    try {
      // Run both evaluations in parallel
      const [evalResp, blResult] = await Promise.all([
        fetch(CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({ interview_id: interviewId, messages, action: 'evaluate' }),
        }),
        analyzeBodyLanguage(),
      ]);

      if (!evalResp.ok) throw new Error('Evaluation failed');
      const data = await evalResp.json();
      if (data.error) throw new Error(data.error);
      setEvaluation(data.evaluation);
      setBodyLanguage(blResult);
      setPhase('results');
    } catch (err: any) {
      console.error('Eval error:', err);
      setError(err.message);
      setPhase('chat');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Results screen
  if (phase === 'results' && evaluation) {
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6">
            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-full border-4 border-primary mx-auto flex items-center justify-center mb-3">
                <span className="text-3xl font-bold text-foreground">{evaluation.overall_score}</span>
              </div>
              <h2 className="text-xl font-bold text-foreground">Interview Complete</h2>
              <p className="text-sm text-muted-foreground mt-1">{evaluation.summary}</p>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 rounded-xl bg-muted/20 text-center">
                <p className="text-2xl font-bold text-foreground">{evaluation.technical_score}</p>
                <p className="text-xs text-muted-foreground">Technical</p>
              </div>
              <div className="p-4 rounded-xl bg-muted/20 text-center">
                <p className="text-2xl font-bold text-foreground">{evaluation.soft_skills_score}</p>
                <p className="text-xs text-muted-foreground">Soft Skills</p>
              </div>
            </div>

            {evaluation.strengths && evaluation.strengths.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-green-500" /> Strengths
                </h3>
                <div className="flex flex-wrap gap-2">
                  {evaluation.strengths.map((s, i) => (
                    <Badge key={i} variant="secondary" className="bg-green-500/10 text-green-700 text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            {evaluation.improvements && evaluation.improvements.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-foreground mb-2">Areas for Growth</h3>
                <div className="flex flex-wrap gap-2">
                  {evaluation.improvements.map((s, i) => (
                    <Badge key={i} variant="secondary" className="bg-amber-500/10 text-amber-700 text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            {evaluation.detailed_feedback && (
              <div className="p-4 rounded-xl bg-muted/10 border border-border/50">
                <h3 className="text-sm font-semibold text-foreground mb-1">Detailed Feedback</h3>
                <p className="text-sm text-muted-foreground">{evaluation.detailed_feedback}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Body Language Analysis Section */}
        {bodyLanguage && (
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <Eye className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Body Language & Presence</h3>
                  <p className="text-xs text-muted-foreground">AI analysis of facial expressions & body language during the interview</p>
                </div>
                <div className="ms-auto text-center">
                  <div className="w-14 h-14 rounded-full border-3 border-purple-400 flex items-center justify-center">
                    <span className="text-lg font-bold text-foreground">{bodyLanguage.overall_body_language_score}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">Overall</span>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                <ScoreBar label="Eye Contact & Gaze" score={bodyLanguage.eye_contact_score} icon={<Eye className="w-full h-full" />} />
                <ScoreBar label="Facial Expressions" score={bodyLanguage.facial_expression_score} icon={<Smile className="w-full h-full" />} />
                <ScoreBar label="Posture & Body Language" score={bodyLanguage.posture_score} icon={<Activity className="w-full h-full" />} />
                <ScoreBar label="Confidence Level" score={bodyLanguage.confidence_score} icon={<Award className="w-full h-full" />} />
                <ScoreBar label="Engagement" score={bodyLanguage.engagement_score} icon={<Brain className="w-full h-full" />} />
                <ScoreBar label="Professional Presence" score={bodyLanguage.professional_presence_score} icon={<User className="w-full h-full" />} />
              </div>

              <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 mb-4">
                <p className="text-sm text-foreground">{bodyLanguage.summary}</p>
              </div>

              {bodyLanguage.observations && bodyLanguage.observations.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-xs font-semibold text-foreground mb-2">📋 Key Observations</h4>
                  <ul className="space-y-1">
                    {bodyLanguage.observations.map((o, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-purple-400 mt-0.5">•</span> {o}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {bodyLanguage.tips && bodyLanguage.tips.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2">💡 Improvement Tips</h4>
                  <ul className="space-y-1">
                    {bodyLanguage.tips.map((tip, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-amber-400 mt-0.5">→</span> {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Interview Decision Actions */}
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6">
            <h3 className="text-sm font-semibold text-foreground mb-1">Interview Decision</h3>
            <p className="text-xs text-muted-foreground mb-4">Based on the results, choose a verification outcome for this consultant.</p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Button
                className="bg-green-600 hover:bg-green-700 text-white border-0"
                onClick={async () => {
                  await supabase.from('interview_sessions').update({ status: 'reviewed' }).eq('id', interviewId);
                  const { data: iv } = await supabase.from('interview_sessions').select('consultant_id').eq('id', interviewId).single();
                  if (iv) await supabase.from('consultants').update({ verification_status: 'verified' }).eq('id', iv.consultant_id);
                  onComplete?.();
                }}
              >
                <CheckCircle className="w-4 h-4 me-1.5" /> Pass
              </Button>
              <Button
                variant="outline"
                className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                onClick={async () => {
                  await supabase.from('interview_sessions').update({ status: 'reviewed' }).eq('id', interviewId);
                  const { data: iv } = await supabase.from('interview_sessions').select('consultant_id').eq('id', interviewId).single();
                  if (iv) await supabase.from('consultants').update({ verification_status: 'on_hold' }).eq('id', iv.consultant_id);
                  onComplete?.();
                }}
              >
                <Clock className="w-4 h-4 me-1.5" /> On Hold
              </Button>
              <Button
                variant="outline"
                className="border-red-500/50 text-red-600 hover:bg-red-500/10"
                onClick={async () => {
                  await supabase.from('interview_sessions').update({ status: 'reviewed' }).eq('id', interviewId);
                  const { data: iv } = await supabase.from('interview_sessions').select('consultant_id').eq('id', interviewId).single();
                  if (iv) await supabase.from('consultants').update({ verification_status: 'rejected' }).eq('id', iv.consultant_id);
                  onComplete?.();
                }}
              >
                <AlertTriangle className="w-4 h-4 me-1.5" /> Reject
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={async () => {
                  const { data: iv } = await supabase.from('interview_sessions').select('consultant_id').eq('id', interviewId).single();
                  if (iv) {
                    await supabase.from('interview_sessions').insert({ consultant_id: iv.consultant_id, interview_type: 'ai', status: 'pending' });
                    await supabase.from('consultants').update({ verification_status: 'under_review' }).eq('id', iv.consultant_id);
                  }
                  onComplete?.();
                }}
              >
                <Brain className="w-3.5 h-3.5 me-1" /> Request Re-Interview
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={async () => {
                  const { data: iv } = await supabase.from('interview_sessions').select('consultant_id').eq('id', interviewId).single();
                  if (iv) {
                    await supabase.from('interview_sessions').insert({ consultant_id: iv.consultant_id, interview_type: 'manual', status: 'pending' });
                    await supabase.from('consultants').update({ verification_status: 'under_review' }).eq('id', iv.consultant_id);
                  }
                  onComplete?.();
                }}
              >
                <Video className="w-3.5 h-3.5 me-1" /> Request Manual Interview
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Evaluating screen
  if (phase === 'evaluating') {
    return (
      <div className="rounded-2xl bg-[#0f1628] p-8 text-center">
        <div className="w-24 h-24 rounded-full mx-auto mb-6 overflow-hidden border-2 border-primary/50">
          <img src={avatarImg} alt="AI Interviewer" className="w-full h-full object-cover" />
        </div>
        <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
        <p className="text-lg font-semibold text-white mb-1">Evaluating Your Interview...</p>
        <p className="text-sm text-gray-400">AI is reviewing your conversation and analyzing body language</p>
        {framesRef.current.length > 0 && (
          <p className="text-xs text-gray-500 mt-2">📸 Analyzing {framesRef.current.length} video snapshots for body language</p>
        )}
      </div>
    );
  }

  // Chat phase
  const userMessageCount = messages.filter(m => m.role === 'user').length;

  return (
    <div className="space-y-0">
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="rounded-2xl overflow-hidden bg-[#0f1628] border border-white/10">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-black/40 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-medium text-white/80">LIVE — AI Interview</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setConversationMode(!conversationMode)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
                conversationMode
                  ? 'bg-green-500/20 text-green-400 border-green-500/30'
                  : 'bg-white/5 text-white/50 border-white/10'
              }`}
            >
              {conversationMode ? '🗣️ Hands-free' : '⌨️ Manual'}
            </button>
            <Badge variant="secondary" className="bg-green-500/10 text-green-400 text-[10px]">
              {isListening ? '🎤 Listening...' : isSpeaking ? '🔊 AI Speaking' : isStreaming ? '💭 Thinking...' : 'Ready'}
            </Badge>
            {capturedFrames > 0 && (
              <span className="text-[10px] text-purple-400/70">📸 {capturedFrames}</span>
            )}
            <span className="text-xs text-white/60 font-mono">{formatTime(elapsedTime)}</span>
            <span className="text-xs text-white/40">{userMessageCount} exchanges</span>
          </div>
        </div>

        {/* Main area */}
        <div className="grid md:grid-cols-5 gap-0 min-h-[450px]">
          {/* AI Avatar + User webcam */}
          <div className="md:col-span-2 relative flex flex-col items-center justify-center bg-gradient-to-br from-[#0a1128] via-[#0f1628] to-[#1a1f3a] p-6">
            <AvatarParticles />
            <div className="relative">
              <div className={`w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden border-3 transition-all duration-500 ${
                isSpeaking ? 'border-green-400 shadow-[0_0_30px_rgba(74,222,128,0.3)] scale-105' : 'border-primary/40'
              }`}>
                <img src={avatarImg} alt="AI Interviewer" className="w-full h-full object-cover" />
              </div>
              {isSpeaking && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-green-500/20 backdrop-blur-sm rounded-full px-3 py-1">
                  <SpeakingIndicator />
                  <span className="text-[10px] text-green-300 ms-1">Speaking</span>
                </div>
              )}
              {isListening && !isSpeaking && (
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-blue-500/20 backdrop-blur-sm rounded-full px-3 py-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-[10px] text-blue-300 ms-1">Listening</span>
                </div>
              )}
            </div>
            <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/50 rounded-lg px-3 py-1.5">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-white">Qurtuba AI Interviewer</span>
            </div>

            {/* User webcam preview */}
            {camOn && (
              <div className="absolute top-3 right-3 w-24 h-18 rounded-lg overflow-hidden border border-white/20 shadow-lg">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover mirror"
                  style={{ transform: 'scaleX(-1)' }}
                />
                <div className="absolute bottom-0.5 left-0.5 right-0.5 flex items-center justify-center">
                  <span className="text-[8px] text-white/60 bg-black/50 rounded px-1">You</span>
                </div>
              </div>
            )}
          </div>

          {/* Chat panel */}
          <div className="md:col-span-3 flex flex-col bg-[#111827] border-s border-white/10">
            <div className="flex-1 p-4 overflow-y-auto space-y-3 max-h-[350px]">
              {messages.length === 0 && !isStreaming && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Loader2 className="w-6 h-6 text-primary mx-auto mb-2 animate-spin" />
                    <p className="text-xs text-white/40">Connecting to interviewer...</p>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'assistant' ? (
                    <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 mt-0.5">
                      <img src={avatarImg} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <MessageSquare className="w-3.5 h-3.5 text-primary" />
                    </div>
                  )}
                  <div className={`rounded-xl p-3 max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-primary/20 rounded-tr-sm border border-primary/30'
                      : 'bg-white/5 rounded-tl-sm border border-white/10'
                  }`}>
                    <div className="text-sm text-white/90 leading-relaxed prose prose-sm prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}

              {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 mt-0.5">
                    <img src={avatarImg} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="bg-white/5 rounded-xl rounded-tl-sm p-3 border border-white/10">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" />
                      <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div className="p-3 border-t border-white/10 bg-black/20">
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" /> {error}
                </div>
              )}
              {interimTranscript && (
                <div className="flex items-center gap-2 text-xs text-blue-300/70 mb-2 italic">
                  <Mic className="w-3 h-3 animate-pulse" /> {interimTranscript}
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Speak now... or type here" : "Type your response or click 🎤"}
                  rows={2}
                  disabled={isStreaming}
                  className="flex-1 resize-none bg-white/5 border border-white/10 text-white placeholder:text-white/30 text-sm rounded-xl p-3 focus:outline-none focus:border-primary/50 disabled:opacity-50"
                />
                {SpeechRecognition && (
                  <Button
                    size="icon"
                    onClick={toggleListening}
                    disabled={isStreaming}
                    className={`h-auto w-12 rounded-xl shrink-0 transition-all ${
                      isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-400'
                    }`}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                )}
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  className="h-auto w-12 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom control bar */}
        <div className="flex flex-col bg-black/50 border-t border-white/10">
          <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 flex-wrap">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-white/50" />
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                <button onClick={() => setVoiceGender('female')} className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${voiceGender === 'female' ? 'bg-pink-500/30 text-pink-300' : 'text-white/50 hover:text-white/80'}`}>♀ Female</button>
                <button onClick={() => setVoiceGender('male')} className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${voiceGender === 'male' ? 'bg-blue-500/30 text-blue-300' : 'text-white/50 hover:text-white/80'}`}>♂ Male</button>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-[140px]">
              <Gauge className="w-3.5 h-3.5 text-white/50" />
              <Slider value={[speechRate]} onValueChange={([v]) => setSpeechRate(v)} min={0.5} max={2.0} step={0.25} className="flex-1 [&_[data-radix-slider-track]]:bg-white/10 [&_[data-radix-slider-range]]:bg-primary/60 [&_[data-radix-slider-thumb]]:w-3 [&_[data-radix-slider-thumb]]:h-3 [&_[data-radix-slider-thumb]]:border-primary" />
              <span className="text-[10px] text-white/50 w-8">{speechRate}x</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/50" />
              <select value={interviewLang} onChange={(e) => setInterviewLang(e.target.value as any)} className="bg-white/5 border border-white/10 text-white/80 text-[10px] rounded-lg px-2 py-1 focus:outline-none focus:border-primary/50 appearance-none cursor-pointer">
                <option value="en" className="bg-[#111827]">🇬🇧 English</option>
                <option value="fr" className="bg-[#111827]">🇫🇷 Français</option>
                <option value="ar" className="bg-[#111827]">🇪🇬 العربية</option>
                <option value="ar-SA" className="bg-[#111827]">🇸🇦 السعودية</option>
                <option value="es" className="bg-[#111827]">🇪🇸 Español</option>
                <option value="de" className="bg-[#111827]">🇩🇪 Deutsch</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <button onClick={toggleListening} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isListening ? 'bg-red-500/30 text-red-400 ring-2 ring-red-500/50 animate-pulse' : micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-400'}`} title={isListening ? 'Stop listening' : 'Start voice input'}>
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button onClick={() => setCamOn(!camOn)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${camOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-400'}`}>
                {camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </button>
              <button onClick={() => { setTtsEnabled(!ttsEnabled); if (ttsEnabled) { window.speechSynthesis.cancel(); setIsSpeaking(false); } }} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${ttsEnabled ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-red-500/20 text-red-400'}`} title={ttsEnabled ? 'Mute AI voice' : 'Enable AI voice'}>
                {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                <Monitor className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {userMessageCount >= 3 && (
                <Button size="sm" onClick={handleEndInterview} disabled={isStreaming} className="gradient-primary border-0">
                  <CheckCircle className="w-4 h-4 me-1" />
                  {interviewLang === 'ar' ? 'إنهاء وتقييم' : 'End & Evaluate'}
                </Button>
              )}
              <button onClick={onCancel} className="w-10 h-10 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400 flex items-center justify-center transition-colors">
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
