import { useState, useRef, useCallback } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-triage-chat`;

export function useTriageChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (input: string) => {
    const userMsg: Message = { role: 'user', content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);

    let assistantSoFar = '';
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: updatedMessages }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              const snapshot = assistantSoFar;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: snapshot } : m);
                }
                return [...prev, { role: 'assistant', content: snapshot }];
              });
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Flush remaining
      if (buffer.trim()) {
        for (let raw of buffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              const snapshot = assistantSoFar;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: snapshot } : m);
                }
                return [...prev, { role: 'assistant', content: snapshot }];
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `⚠️ ${err.message || 'Something went wrong. Please try again.'}` },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [messages]);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, sendMessage, clearChat };
}
