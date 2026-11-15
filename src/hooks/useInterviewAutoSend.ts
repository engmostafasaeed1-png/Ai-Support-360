import { useCallback, useEffect, useRef, useState } from 'react';
import { canSendAnswer, SPEECH_SILENCE_MS, TYPING_IDLE_MS } from '@/lib/interviewConversation';

export function useInterviewAutoSend({ text, blocked, onSend }: { text: string; blocked: boolean; onSend: () => void }) {
  const latest = useRef({ text, blocked, onSend });
  latest.current = { text, blocked, onSend };
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const stickyPause = useRef(false);
  const [source, setSource] = useState<'speech' | 'typing' | null>(null);
  const deadline = useRef(0);
  const [remaining, setRemaining] = useState(0);
  const cancel = useCallback(() => { deadline.current = 0; setRemaining(0); setSource(null); }, []);
  const pause = useCallback((sticky = true) => { stickyPause.current ||= sticky; pausedRef.current = true; setPaused(true); cancel(); }, [cancel]);
  const resume = useCallback(() => { stickyPause.current = false; pausedRef.current = false; setPaused(false); cancel(); }, [cancel]);
  const arm = useCallback((source: 'speech' | 'typing', delay?: number) => {
    if (source === 'typing' && !stickyPause.current) { pausedRef.current = false; setPaused(false); }
    if (pausedRef.current || latest.current.blocked) return;
    const ms = delay ?? (source === 'speech' ? SPEECH_SILENCE_MS : TYPING_IDLE_MS);
    deadline.current = Date.now() + ms;
    setSource(source);
    setRemaining(ms);
  }, []);
  useEffect(() => {
    if (blocked) cancel();
    else if (!pausedRef.current && canSendAnswer(latest.current.text)) arm('typing');
  }, [blocked, cancel, arm]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!deadline.current || pausedRef.current || latest.current.blocked) return;
      const ms = deadline.current - Date.now();
      if (ms > 0) { setRemaining(ms); return; }
      deadline.current = 0; setRemaining(0);
      if (canSendAnswer(latest.current.text)) latest.current.onSend();
    }, 50);
    return () => clearInterval(timer);
  }, []);
  return { paused, remaining, source, pause, resume, cancel, arm };
}