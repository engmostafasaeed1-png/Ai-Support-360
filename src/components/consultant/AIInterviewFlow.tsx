import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Brain, Loader2, CheckCircle, Send, AlertTriangle, Video, VideoOff,
  Mic, MicOff, Monitor, PhoneOff, MessageSquare, Award, Volume2, VolumeX,
  Gauge, Globe, User, Eye, Smile, Activity, Clock, HelpCircle, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Slider } from '@/components/ui/slider';
import ReactMarkdown from 'react-markdown';
import aiMaleAvatar from '@/assets/ai-interviewer-male.jpg';
import aiFemaleAvatar from '@/assets/ai-interviewer-female.jpg';
import { useQueryClient } from '@tanstack/react-query';
import { TrustBadge } from './TrustBadge';
import { classifyStartError, ERROR_TEXT, logStartErrorOnce } from '@/lib/interviewStart';

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
  /** Start without camera or voice; answers are typed. */
  textOnly?: boolean;
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

// Interviewer messages may start with [[by: Name]] when asking a question from the admin question bank.
function splitAuthorTag(content: string): { author: string | null; speaker: { name: string; role: string } | null; text: string } {
  const m = content.match(/\[\[by:\s*([^\]]{1,120})\]\]/i);
  const sp = content.match(/\[\[speaker:\s*([^\]|]{1,60})\|?([^\]]{0,60})\]\]/i);
  // Hide half-streamed tags at the end ("[[by: Ahm", "[[speak") until they complete.
  const text = content
    .replace(/\[\[(by|speaker):\s*[^\]]{0,140}\]\]\s*/gi, '')
    .replace(/\[\[[a-z:|\s\-—.,'A-Z\u0600-\u06FF]*$/i, '');
  return {
    author: m ? m[1].trim() : null,
    speaker: sp ? { name: sp[1].trim(), role: (sp[2] || '').trim() } : null,
    text,
  };
}

// Panel replies may contain several [[speaker: ...]] turns; split them into separate bubbles.
function splitSpeakerTurns(content: string): string[] {
  const idx: number[] = [];
  const re = /\[\[speaker:/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) idx.push(m.index);
  if (idx.length <= 1) return [content];
  const out: string[] = [];
  if (content.slice(0, idx[0]).trim()) out.push(content.slice(0, idx[0]));
  idx.forEach((start, i) => out.push(content.slice(start, idx[i + 1] ?? content.length)));
  return out;
}

export type InterviewStyle = 'standard' | 'discussion' | 'scenario' | 'panel';
const STYLE_OPTIONS: { key: InterviewStyle; label: string; hint: string }[] = [
  { key: 'standard', label: '📋 Standard Q&A', hint: 'Questions one by one, from the expert question bank' },
  { key: 'discussion', label: '💬 Open discussion', hint: 'A natural back-and-forth conversation about your work' },
  { key: 'scenario', label: '🧩 Scenario discussion', hint: 'Solve real SAP problems step by step, with twists' },
  { key: 'panel', label: '👥 AI panel', hint: 'Three interviewers: functional, technical and project lead' },
];
const speakerGender = (name: string | undefined, fallback: 'male' | 'female'): 'male' | 'female' =>
  !name ? fallback : /mariam/i.test(name) ? 'female' : /ezz|omar/i.test(name) ? 'male' : fallback;

function DynamicAvatar({ src, isSpeaking, isListening, isThinking }: { src: string; isSpeaking: boolean; isListening: boolean; isThinking: boolean }) {
  const [blink, setBlink] = useState(false);

  // Natural blink every 3-6 seconds
  useEffect(() => {
    const blinkLoop = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 180);
      const next = 2500 + Math.random() * 4000;
      return setTimeout(blinkLoop, next);
    };
    const t = setTimeout(blinkLoop, 3000);
    return () => clearTimeout(t);
  }, []);

  // Dynamic ring color & glow
  const ringColor = isSpeaking
    ? 'border-green-400 shadow-[0_0_30px_rgba(74,222,128,0.35)]'
    : isListening
    ? 'border-blue-400 shadow-[0_0_25px_rgba(96,165,250,0.3)]'
    : isThinking
    ? 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.25)]'
    : 'border-primary/40';

  return (
    <div className="relative">
      {/* Breathing ring */}
      <div
        className={`absolute -inset-3 rounded-full border-2 transition-all duration-1000 ${
          isSpeaking ? 'border-green-400/20 animate-[breathe_2s_ease-in-out_infinite]'
          : isListening ? 'border-blue-400/15 animate-[breathe_3s_ease-in-out_infinite]'
          : 'border-white/5 animate-[breathe_4s_ease-in-out_infinite]'
        }`}
      />
      {/* Sound wave rings when speaking */}
      {isSpeaking && (
        <>
          <div className="absolute -inset-5 rounded-full border border-green-400/10 animate-ping" style={{ animationDuration: '1.5s' }} />
          <div className="absolute -inset-8 rounded-full border border-green-400/5 animate-ping" style={{ animationDuration: '2s' }} />
        </>
      )}
      {/* Avatar container */}
      <div
        className={`w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden border-3 transition-all duration-500 ${ringColor}`}
        style={{
          animation: isSpeaking ? 'headBob 1.5s ease-in-out infinite' : isThinking ? 'headTilt 3s ease-in-out infinite' : 'breatheScale 4s ease-in-out infinite',
        }}
      >
        <div className="relative w-full h-full">
          <img src={src} alt="AI Interviewer" className="w-full h-full object-cover" />
          {/* Blink overlay */}
          <div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-transparent pointer-events-none transition-opacity"
            style={{
              opacity: blink ? 0.15 : 0,
              background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.4) 55%, transparent 70%)',
              transitionDuration: '80ms',
            }}
          />
          {/* Speaking mouth animation overlay */}
          {isSpeaking && (
            <div className="absolute bottom-[15%] left-1/2 -translate-x-1/2 w-[30%] h-[8%] pointer-events-none">
              <div className="w-full h-full rounded-full bg-black/20 animate-[mouthMove_0.3s_ease-in-out_infinite]" />
            </div>
          )}
        </div>
      </div>
      {/* Status badge */}
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
      {isThinking && !isSpeaking && !isListening && (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-amber-500/20 backdrop-blur-sm rounded-full px-3 py-1">
          <Loader2 className="w-2.5 h-2.5 text-amber-300 animate-spin" />
          <span className="text-[10px] text-amber-300 ms-1">Thinking</span>
        </div>
      )}
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

export default function AIInterviewFlow({ interviewId, onComplete, onCancel, textOnly = false }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reward, setReward] = useState<{ ai_interview_badge: string; credibility_credits: number } | null>(null);
  const [phase, setPhase] = useState<'disclaimer' | 'chat' | 'evaluating' | 'results'>('disclaimer');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [bodyLanguage, setBodyLanguage] = useState<BodyLanguageResult | null>(null);
  const [error, setError] = useState('');
  const [cameraNotice, setCameraNotice] = useState('');
  const [micNotice, setMicNotice] = useState('');
  const [micOn, setMicOn] = useState(!textOnly);
  const [camOn, setCamOn] = useState(!textOnly);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('male');
  const [interviewerTone, setInterviewerTone] = useState<'friendly' | 'formal' | 'strict'>('friendly');
  const [interviewStyle, setInterviewStyle] = useState<InterviewStyle>('standard');
  const avatarImg = voiceGender === 'male' ? aiMaleAvatar : aiFemaleAvatar;
  const [speechRate, setSpeechRate] = useState(1.0);
  const [interviewLang, setInterviewLang] = useState<'en' | 'fr' | 'ar' | 'es' | 'de' | 'ar-SA'>('en');
  // Text-only: no camera, no listening; the consultant types every answer.
  const [conversationMode, setConversationMode] = useState(!textOnly);
  const sendToAIRef = useRef<(h: ChatMessage[]) => Promise<void>>();
  const [capturedFrames, setCapturedFrames] = useState(0);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const lastSpokenRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingTextRef = useRef('');
  const shouldAutoResumeRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);

  // Preload voices — some browsers load them asynchronously
  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis?.getVoices();
      if (v && v.length > 0) setVoicesReady(true);
    };
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

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
          setCameraNotice('');
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
          setCameraNotice(
            err?.name === 'NotFoundError'
              ? 'No camera was found, so the interview continues without video. You can answer by typing.'
              : 'Camera access is blocked, so the interview continues without video. To turn it on, click the camera or lock icon in the address bar, allow the camera, then press the camera button. You can answer by typing.'
          );
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

  const startInterviewAfterDisclaimer = useCallback(async () => {
    setPhase('chat');
    setError('');
    // Always the latest sender (voice, tone and language chosen just before pressing start), never a stale copy.
    const send = (h: ChatMessage[]) => sendToAIRef.current?.(h);
    try {
      const { error: styleError } = await supabase.from('interview_sessions').update({ interview_style: interviewStyle } as any).eq('id', interviewId);
      if (styleError) logStartErrorOnce(classifyStartError(styleError), styleError, 'interview-style');
      // Check if there's a saved conversation to resume
      const { data, error: readError } = await supabase
        .from('interview_sessions')
        .select('skill_results, status')
        .eq('id', interviewId)
        .single();
      if (readError) throw readError;
      const saved = data?.skill_results as unknown as ChatMessage[] | null;
      if (saved && Array.isArray(saved) && saved.length > 0 && data?.status === 'in_progress') {
        setMessages(saved);
        setInterviewStarted(true);
        messagesRef.current = saved;
        const lastMsg = saved[saved.length - 1];
        if (lastMsg?.role === 'user') void send(saved);
      } else {
        void send([]);
      }
    } catch (err) {
      // Visible with a Retry button (shown while there is no answer yet) and logged once.
      const code = classifyStartError(err);
      setError(t(ERROR_TEXT[code].key, ERROR_TEXT[code].message));
      logStartErrorOnce(code, err, 'interview-open');
    }
  }, [interviewId, interviewStyle, t]);

  const handleRejectDisclaimer = () => {
    onCancel();
  };

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
        sendToAIRef.current?.(newHistory);
      }
    }, 1200);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const speakText = useCallback((text: string) => {
    if (!ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const parts = splitAuthorTag(text);
    const g = speakerGender(parts.speaker?.name, voiceGender);
    const isOmar = /omar/i.test(parts.speaker?.name || '');
    const cleanText = parts.text.replace(/[#*_`~[\]()>]/g, '').replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
    if (!cleanText || cleanText === lastSpokenRef.current) return;
    lastSpokenRef.current = cleanText;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = g === 'male' ? speechRate * 0.92 : speechRate;
    utterance.pitch = g === 'female' ? 1.1 : isOmar ? 0.95 : 0.72;
    utterance.volume = 1.0;
    const langMap: Record<string, string> = { 'en': 'en-US', 'fr': 'fr-FR', 'ar': 'ar-EG', 'es': 'es-ES', 'de': 'de-DE', 'ar-SA': 'ar-SA' };
    utterance.lang = langMap[interviewLang] || 'en-US';

    const voices = window.speechSynthesis.getVoices();
    const langPrefix = interviewLang.startsWith('ar') ? 'ar' : interviewLang;
    const femaleHints = ['female', 'woman', 'zira', 'samantha', 'karen', 'victoria', 'fiona', 'Google.*Female', 'tessa', 'moira', 'allison', 'ava', 'susan', 'kate', 'emma', 'serena'];
    const maleHints = ['male', 'man', 'david', 'daniel', 'james', 'Google.*Male', 'alex', 'mark', 'reed', 'richard', 'thomas', 'google uk english male', 'aaron', 'fred', 'jorge', 'ralph', 'tom', 'rishi'];
    const isFemaleVoice = (name: string) => femaleHints.some(h => new RegExp(h, 'i').test(name));
    const isMaleVoice = (name: string) => maleHints.some(h => new RegExp(h, 'i').test(name));

    let preferred;
    if (g === 'male') {
      // Strictly pick male voice; never fall back to female
      preferred = voices.find(v => v.lang.startsWith(langPrefix) && isMaleVoice(v.name) && !v.localService)
        || voices.find(v => v.lang.startsWith(langPrefix) && isMaleVoice(v.name))
        || voices.find(v => isMaleVoice(v.name) && !v.localService)
        || voices.find(v => isMaleVoice(v.name))
        || voices.find(v => v.lang.startsWith(langPrefix) && !isFemaleVoice(v.name) && !v.localService)
        || voices.find(v => v.lang.startsWith(langPrefix) && !isFemaleVoice(v.name));
    } else {
      // Strictly pick female voice; never fall back to male
      preferred = voices.find(v => v.lang.startsWith(langPrefix) && isFemaleVoice(v.name) && !v.localService)
        || voices.find(v => v.lang.startsWith(langPrefix) && isFemaleVoice(v.name))
        || voices.find(v => isFemaleVoice(v.name) && !v.localService)
        || voices.find(v => isFemaleVoice(v.name))
        || voices.find(v => v.lang.startsWith(langPrefix) && !isMaleVoice(v.name) && !v.localService)
        || voices.find(v => v.lang.startsWith(langPrefix) && !isMaleVoice(v.name));
    }
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      if (conversationMode && shouldAutoResumeRef.current && SpeechRecognition) {
        setTimeout(() => startListening(), 100);
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
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicNotice('Microphone access is blocked, so voice answers are off. To turn it on, click the microphone or lock icon in the address bar and allow the microphone. You can answer by typing.');
      }
    };
    recognition.onend = () => { setIsListening(false); setInterimTranscript(''); };

    recognitionRef.current = recognition;
    setMicNotice('');
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
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) { setError('Please sign in again.'); setIsStreaming(false); setIsSpeaking(false); return; }
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ interview_id: interviewId, messages: chatHistory, lang: interviewLang, voice_gender: voiceGender, tone: interviewerTone }),
      });
      if (!resp.ok || !resp.body) {
        if (resp.status === 429) { setError('Rate limited — please try again in a moment.'); setIsStreaming(false); setIsSpeaking(false); return; }
        const errBody = await resp.json().catch(() => null);
        const msg = typeof errBody?.error === 'string' ? errBody.error : 'Failed to connect to interviewer';
        throw new Error(msg);
      }
      setError('');
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
      if (assistantText) {
        messagesRef.current = [...chatHistory, { role: 'assistant', content: assistantText }];
        setMessages(messagesRef.current);
        if (!interviewStarted) {
          setInterviewStarted(true);
          setStartedAt(new Date());
        }
        speakText(assistantText);
      }
    } catch (err: any) {
      console.error('Stream error:', err);
      const code = classifyStartError(err);
      const generic = !err?.message || err.message === 'Failed to connect to interviewer' || code === 'network';
      setError(generic ? t(ERROR_TEXT[code].key, ERROR_TEXT[code].message) : err.message);
      logStartErrorOnce(code, err, chatHistory.length === 0 ? 'interview-greeting' : 'interview-turn');
    } finally {
      setIsStreaming(false);
      // Auto-save conversation after each exchange
      const latest = messagesRef.current;
      if (latest.length > 0) {
        supabase.from('interview_sessions').update({
          skill_results: latest as any,
        }).eq('id', interviewId).then(() => {});
      }
      if (!ttsEnabled) {
        setTimeout(() => {
          setIsSpeaking(false);
          if (conversationMode && shouldAutoResumeRef.current && SpeechRecognition) startListening();
        }, 150);
      }
    }
  };

  sendToAIRef.current = sendToAI;

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
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return null;
      const resp = await fetch(BODY_LANG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ frames: framesRef.current.slice(-8) }),
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
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('Please sign in again.');
      // Run both evaluations in parallel
      const [evalResp, blResult] = await Promise.all([
        fetch(CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ interview_id: interviewId, messages, action: 'evaluate', voice_gender: voiceGender, tone: interviewerTone }),
        }),
        analyzeBodyLanguage(),
      ]);

      const data = await evalResp.json();
      if (!evalResp.ok || data.error) throw new Error(data.error || 'Evaluation failed');
      if (!data.evaluation || !data.reward?.ai_interview_badge) throw new Error('Could not confirm interview reward. Please try again.');
      setEvaluation(data.evaluation);
      setReward(data.reward);
      void queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['consultant-interviews'] });
      void queryClient.invalidateQueries({ queryKey: ['interview-history'] });
      setBodyLanguage(blResult);
      setPhase('results');
    } catch (err: any) {
      console.error('Eval error:', err);
      setError(err.message);
      shouldAutoResumeRef.current = true;
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
              {reward && <div className="mt-3 flex justify-center"><TrustBadge badge={reward.ai_interview_badge} credits={reward.credibility_credits} size="md" /></div>}
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

        {/* The verification outcome is decided by the platform team, never by the candidate. */}
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Submitted for review</h3>
            <p className="text-xs text-muted-foreground">
              Your interview results have been recorded. An administrator reviews every interview and updates your verification status — you can follow it on the Verification page.
            </p>
            <Button size="sm" className="gradient-primary border-0" onClick={() => onComplete?.()}>
              Continue
            </Button>
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
  // Disclaimer screen
  if (phase === 'disclaimer') {
    const interviewerName = voiceGender === 'female' ? 'Mariam' : 'Ezz';
    return (
      <div className="rounded-2xl overflow-hidden bg-[#0f1628] border border-white/10 p-6 md:p-10 max-w-xl mx-auto">
        <div className="flex flex-col items-center text-center space-y-5">
          {/* Avatar */}
          <div className="w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden border-3 border-primary/40 shadow-lg">
            <img src={avatarImg} alt={interviewerName} className="w-full h-full object-cover" />
          </div>

          {/* Introduction */}
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-1">
              Hi, I'm {interviewerName} 👋
            </h2>
            <p className="text-sm text-gray-400">
              I'm from <strong className="text-white">AI Support 360</strong>. I'm here to help you increase your credibility score through a quick skills assessment. Let me walk you through a few things before we begin.
            </p>
          </div>

          {/* Gender switch */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVoiceGender('female')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${voiceGender === 'female' ? 'bg-primary/20 text-primary border-primary/40' : 'bg-white/5 text-white/50 border-white/10'}`}
            >
              ♀ Mariam
            </button>
            <button
              onClick={() => setVoiceGender('male')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${voiceGender === 'male' ? 'bg-primary/20 text-primary border-primary/40' : 'bg-white/5 text-white/50 border-white/10'}`}
            >
              ♂ Ezz
            </button>
          </div>

          {/* Tone selector */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">Interviewer tone</span>
            <div className="flex items-center gap-2">
              {(['friendly', 'formal', 'strict'] as const).map((tone) => (
                <button
                  key={tone}
                  onClick={() => setInterviewerTone(tone)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-colors ${interviewerTone === tone ? 'bg-primary/20 text-primary border-primary/40' : 'bg-white/5 text-white/50 border-white/10'}`}
                >
                  {tone === 'friendly' ? '😊 Friendly' : tone === 'formal' ? '🎩 Formal' : '🧐 Strict'}
                </button>
              ))}
            </div>
          </div>

          {/* Interview style */}
          <div className="w-full flex flex-col items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-white/40">Interview style</span>
            <div className="grid grid-cols-2 gap-2 w-full">
              {STYLE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setInterviewStyle(o.key)}
                  aria-pressed={interviewStyle === o.key}
                  className={`text-left rounded-xl px-3 py-2 border transition-colors ${interviewStyle === o.key ? 'bg-primary/20 border-primary/40' : 'bg-white/5 border-white/10 hover:border-white/20'}`}
                >
                  <div className={`text-xs font-semibold ${interviewStyle === o.key ? 'text-primary' : 'text-white/80'}`}>{o.label}</div>
                  <div className="text-[10px] text-white/50 leading-snug mt-0.5">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="w-full bg-white/5 rounded-xl p-4 text-left space-y-3 border border-white/10">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" /> Data Sharing Disclaimer
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              By proceeding, you agree that the information shared during this interview — including your responses, technical assessments, and evaluation scores — will be shared with <strong className="text-white">relevant clients</strong> to assess your suitability for projects.
            </p>
            <ul className="text-xs text-gray-400 space-y-1.5">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                Your data will <strong className="text-gray-300">only</strong> be used for client matching purposes.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                Your data will <strong className="text-gray-300">not</strong> be used for marketing or sold to third parties.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
                You can request data deletion at any time through your profile settings.
              </li>
            </ul>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 w-full">
            <Button
              variant="outline"
              className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={handleRejectDisclaimer}
            >
              Decline & Exit
            </Button>
            <Button
              className="flex-1 gradient-primary border-0 text-white font-semibold"
              onClick={startInterviewAfterDisclaimer}
            >
              Accept & Start Interview
            </Button>
          </div>
        </div>
      </div>
    );
  }

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

        {/* Interview status banner */}
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2 flex items-center gap-2 text-xs border-b border-white/10 transition-colors ${
            interviewStarted
              ? 'bg-green-500/10 text-green-300'
              : 'bg-amber-500/10 text-amber-300'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${interviewStarted ? 'bg-green-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
          {interviewStarted ? (
            <span>
              ✅ Interview started with <strong>{voiceGender === 'female' ? 'Mariam' : 'Ezz'}</strong> · tone: <strong className="capitalize">{interviewerTone}</strong>
              {startedAt && <span className="text-white/40 ms-2">at {startedAt.toLocaleTimeString()}</span>}
            </span>
          ) : (
            <span>⏳ Waiting for {voiceGender === 'female' ? 'Mariam' : 'Ezz'} to greet you…</span>
          )}
        </div>

        {/* Main area */}
        <div className="grid md:grid-cols-5 gap-0 min-h-[450px]">
          {/* AI Avatar + User webcam */}
          <div className="md:col-span-2 relative flex flex-col items-center justify-center bg-gradient-to-br from-[#0a1128] via-[#0f1628] to-[#1a1f3a] p-6">
            {/* Ambient particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 rounded-full bg-primary/15 animate-pulse"
                  style={{
                    left: `${10 + i * 12}%`,
                    top: `${15 + (i % 4) * 20}%`,
                    animationDelay: `${i * 0.4}s`,
                    animationDuration: `${3 + i * 0.3}s`,
                  }}
                />
              ))}
            </div>
            <DynamicAvatar src={avatarImg} isSpeaking={isSpeaking} isListening={isListening} isThinking={isStreaming && !isSpeaking} />
            <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/50 rounded-lg px-3 py-1.5">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-white">{voiceGender === 'female' ? 'Mariam' : 'Ezz'} — AI Support 360</span>
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

              {messages.flatMap((m) => (m.role === 'assistant' ? splitSpeakerTurns(m.content).map((c) => ({ ...m, content: c })) : [m])).map((msg, i) => {
                const sp = msg.role === 'assistant' ? splitAuthorTag(msg.content).speaker : null;
                const interviewerLabel = sp?.name || (voiceGender === 'female' ? 'Mariam' : 'Ezz');
                const spGender = speakerGender(sp?.name, voiceGender);
                const isOmar = /omar/i.test(sp?.name || '');
                const msgAvatar = spGender === 'female' ? aiFemaleAvatar : aiMaleAvatar;
                return (
                  <div key={i} className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    {msg.role === 'assistant' ? (
                      <div className="flex flex-col items-center shrink-0 mt-0.5 gap-0.5">
                        <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-primary/40">
                          {isOmar ? (
                            <div className="w-full h-full bg-primary/30 flex items-center justify-center text-[11px] font-bold text-white">O</div>
                          ) : (
                            <img src={msgAvatar} alt={`${interviewerLabel} avatar`} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <span className="text-[9px] font-medium text-primary/80 leading-none">{interviewerLabel}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center shrink-0 mt-0.5 gap-0.5">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                          <MessageSquare className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span className="text-[9px] font-medium text-white/50 leading-none">You</span>
                      </div>
                    )}
                    <div className={`rounded-xl p-3 max-w-[85%] ${
                      msg.role === 'user'
                        ? 'bg-primary/20 rounded-tr-sm border border-primary/30'
                        : 'bg-white/5 rounded-tl-sm border border-white/10'
                    }`}>
                      {(() => {
                        const { author, text } = msg.role === 'assistant' ? splitAuthorTag(msg.content) : { author: null, text: msg.content };
                        return (
                          <>
                            {msg.role === 'assistant' && (
                              <div className="text-[10px] font-semibold text-primary/90 mb-1">
                                {interviewerLabel} <span className="text-white/40 font-normal">· {sp?.role || 'AI Support 360'}</span>
                              </div>
                            )}
                            {author && (
                              <div className="inline-flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-[10px] text-amber-200">
                                <Award className="w-3 h-3" /> Question from {author}
                              </div>
                            )}
                            <div className="text-sm text-white/90 leading-relaxed prose prose-sm prose-invert max-w-none">
                              <ReactMarkdown>{text}</ReactMarkdown>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}

              {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex items-start gap-2">
                  <div className="flex flex-col items-center shrink-0 mt-0.5 gap-0.5">
                    <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-primary/40">
                      <img src={avatarImg} alt={`${voiceGender === 'female' ? 'Mariam' : 'Ezz'} avatar`} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-[9px] font-medium text-primary/80 leading-none">{voiceGender === 'female' ? 'Mariam' : 'Ezz'}</span>
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
                <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-400 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" /> {error}
                  {!isStreaming && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
                    <button type="button" onClick={() => { setError(''); void sendToAI(messagesRef.current); }}
                      className="ms-auto rounded-md border border-red-400/40 px-2 py-0.5 font-medium text-red-300 hover:bg-red-500/10">
                      {t('common.retry', 'Retry')}
                    </button>
                  )}
                </div>
              )}
              {[cameraNotice, micNotice].filter(Boolean).map((notice) => (
                <div key={notice} role="status" className="flex items-start gap-2 text-xs text-amber-300 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {notice}
                </div>
              ))}
              {interimTranscript && (
                <div className="flex items-center gap-2 text-xs text-blue-300/70 mb-2 italic">
                  <Mic className="w-3 h-3 animate-pulse" /> {interimTranscript}
                </div>
              )}
              {/* Quick action buttons */}
              <div className="flex gap-1.5 mb-2">
                <button
                  onClick={() => {
                    const clarifyMsg: ChatMessage = { role: 'user', content: 'Can you please clarify or rephrase the last question? I want to make sure I understand it correctly.' };
                    const newHistory = [...messages, clarifyMsg];
                    setMessages(newHistory);
                    sendToAI(newHistory);
                  }}
                  disabled={isStreaming || messages.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white/90 hover:bg-white/10 text-[10px] transition-colors disabled:opacity-30"
                >
                  <HelpCircle className="w-3 h-3" /> Clarify Question
                </button>
                <button
                  onClick={() => {
                    const repeatMsg: ChatMessage = { role: 'user', content: 'Could you repeat the question please?' };
                    const newHistory = [...messages, repeatMsg];
                    setMessages(newHistory);
                    sendToAI(newHistory);
                  }}
                  disabled={isStreaming || messages.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white/90 hover:bg-white/10 text-[10px] transition-colors disabled:opacity-30"
                >
                  <RefreshCw className="w-3 h-3" /> Repeat
                </button>
              </div>
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => {
                    // Typing takes over: stop the mic and keep exactly what the user typed
                    if (isListening) stopListening();
                    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                    pendingTextRef.current = '';
                    setInput(e.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Speak now... or type here" : "Type your answer and press Enter (or click 🎤 to speak)"}
                  rows={2}
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
                <button onClick={() => setVoiceGender('female')} className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${voiceGender === 'female' ? 'bg-pink-500/30 text-pink-300' : 'text-white/50 hover:text-white/80'}`}>♀ Mariam</button>
                <button onClick={() => setVoiceGender('male')} className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${voiceGender === 'male' ? 'bg-blue-500/30 text-blue-300' : 'text-white/50 hover:text-white/80'}`}>♂ Ezz</button>
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
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  shouldAutoResumeRef.current = false;
                  if (isListening) stopListening();
                  if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
                  window.speechSynthesis.cancel();
                  // Save conversation progress to DB for resuming later
                  await supabase.from('interview_sessions').update({
                    skill_results: messages as any,
                  }).eq('id', interviewId);
                  onCancel?.();
                }}
                className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs"
              >
                <Clock className="w-3.5 h-3.5 me-1" />
                Pause & Resume Later
              </Button>
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
