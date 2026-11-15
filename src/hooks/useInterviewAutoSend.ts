import { useCallback, useEffect, useRef, useState } from 'react';
import { canSendAnswer, SPEECH_SILENCE_MS, TYPING_IDLE_MS } from '@/lib/interviewConversation';

export function useInterviewAutoSend({ text, blocked, onSend }: { text: string; blocked: boolean; onSend: () => void }) {
  const latest = useRef({ text, blocked, onSend });
  latest.current = { text, blocked, onSend };
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const deadline = useRef(0);
  const [remaining, setRemaining] = useState(0);
  const cancel = useCallback(() => { deadline.current = 0; setRemaining(0); }, []);
  const pause = useCallback(() => { pausedRef.current = true; setPaused(true); cancel(); }, [cancel]);
  const resume = useCallback(() => { pausedRef.current = false; setPaused(false); cancel(); }, [cancel]);
  const arm = useCallback((source: 'speech' | 'typing', delay?: number) => {
    if (pausedRef.current || latest.current.blocked) return;
    const ms = delay ?? (source === 'speech' ? SPEECH_SILENCE_MS : TYPING_IDLE_MS);
    deadline.current = Date.now() + ms;
    setRemaining(ms);
  }, []);
  useEffect(() => {
    if (blocked) cancel();
  }, [blocked, cancel]);
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
  return { paused, remaining, pause, resume, cancel, arm };
}