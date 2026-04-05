import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type Message = { role: 'user' | 'assistant'; content: string };
export type Conversation = { id: string; title: string; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-triage-chat`;

export function useTriageChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Check auth state
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load conversation list for authenticated users
  const loadConversations = useCallback(async () => {
    if (!userId) { setConversations([]); return; }
    const { data } = await supabase
      .from('chatbot_conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);
    setConversations((data as Conversation[]) ?? []);
  }, [userId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load a specific conversation
  const loadConversation = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('chatbot_messages')
      .select('role, content')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data as Message[]);
      setConversationId(id);
    }
  }, []);

  // Persist a message to the DB
  const persistMessage = useCallback(async (msg: Message, convId: string) => {
    if (!userId) return;
    await supabase.from('chatbot_messages').insert({
      conversation_id: convId,
      role: msg.role,
      content: msg.content,
    });
  }, [userId]);

  // Ensure a conversation exists, create if needed
  const ensureConversation = useCallback(async (firstMessage: string): Promise<string | null> => {
    if (!userId) return null;
    if (conversationId) return conversationId;
    const title = firstMessage.slice(0, 80) || 'New conversation';
    const { data, error } = await supabase
      .from('chatbot_conversations')
      .insert({ user_id: userId, title })
      .select('id')
      .single();
    if (error || !data) return null;
    const newId = data.id;
    setConversationId(newId);
    loadConversations();
    return newId;
  }, [userId, conversationId, loadConversations]);

  const sendMessage = useCallback(async (input: string) => {
    const userMsg: Message = { role: 'user', content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);

    // Persist user message
    const convId = await ensureConversation(input);
    if (convId) persistMessage(userMsg, convId);

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

      // Persist assistant message
      if (assistantSoFar && convId) {
        persistMessage({ role: 'assistant', content: assistantSoFar }, convId);
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
  }, [messages, ensureConversation, persistMessage]);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setIsLoading(false);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await supabase.from('chatbot_conversations').delete().eq('id', id);
    if (conversationId === id) clearChat();
    loadConversations();
  }, [conversationId, clearChat, loadConversations]);

  const renameConversation = useCallback(async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    await supabase.from('chatbot_conversations').update({ title: trimmed }).eq('id', id);
    loadConversations();
  }, [loadConversations]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setIsLoading(false);
  }, []);

  return {
    messages, isLoading, sendMessage, clearChat,
    conversations, conversationId, loadConversation,
    deleteConversation, renameConversation, newChat, userId,
  };
}
