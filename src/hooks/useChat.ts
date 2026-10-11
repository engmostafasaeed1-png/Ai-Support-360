import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { safeFileName } from '@/lib/storagePath';

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_id: string;
  content: string | null;
  message_type: 'text' | 'file' | 'voice_note' | 'system';
  file_url: string | null;
  file_name: string | null;
  is_read: boolean;
  created_at: string;
  optimistic?: boolean;
}

interface UseChatOptions {
  sessionId: string;
  userId: string;
}

export function useChat({ sessionId, userId }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load existing messages
  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('Failed to load messages:', error);
        toast.error('Could not load chat history. Please refresh.');
        setIsLoading(false);
        return;
      }

      if (data) {
        setMessages(data as unknown as ChatMessage[]);
      }
      setIsLoading(false);
    };

    loadMessages();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Subscribe to realtime messages + presence
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${sessionId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newMsg = payload.new as unknown as ChatMessage;
          setMessages((prev) => {
            // Remove optimistic message with same content from same sender
            const filtered = prev.filter(
              (m) => !(m.optimistic && m.sender_id === newMsg.sender_id && m.content === newMsg.content)
            );
            if (filtered.some((m) => m.id === newMsg.id)) return filtered;
            return [...filtered, newMsg];
          });
        }
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        const typingUserId = payload.payload?.user_id;
        if (typingUserId && typingUserId !== userId) {
          setTypingUsers((prev) => new Set(prev).add(typingUserId));

          if (typingTimeoutRef.current[typingUserId]) {
            clearTimeout(typingTimeoutRef.current[typingUserId]);
          }
          typingTimeoutRef.current[typingUserId] = setTimeout(() => {
            setTypingUsers((prev) => {
              const next = new Set(prev);
              next.delete(typingUserId);
              return next;
            });
          }, 3000);
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      Object.values(typingTimeoutRef.current).forEach(clearTimeout);
    };
  }, [sessionId, userId]);

  const sendMessage = useCallback(
    async (content: string, type: 'text' | 'file' = 'text', fileUrl?: string, fileName?: string): Promise<boolean> => {
      // Optimistic message
      const optimisticMsg: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        session_id: sessionId,
        sender_id: userId,
        content: type === 'text' ? content : fileName || 'File',
        message_type: type,
        file_url: fileUrl || null,
        file_name: fileName || null,
        is_read: false,
        created_at: new Date().toISOString(),
        optimistic: true,
      };

      setMessages((prev) => [...prev, optimisticMsg]);

      const { error } = await supabase.from('messages').insert({
        session_id: sessionId,
        sender_id: userId,
        content: type === 'text' ? content : fileName || 'File',
        message_type: type,
        file_url: fileUrl || null,
        file_name: fileName || null,
      });

      if (error) {
        console.error('Send message error:', error);
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
        toast.error('Failed to send message. Please try again.');
        return false;
      }
      return true;
    },
    [sessionId, userId]
  );

  const sendTyping = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: userId },
    });
  }, [userId]);

  const uploadFile = useCallback(
    async (file: File) => {
      // Storage policy: the first folder must be the session id (both participants can read and write it).
      const path = `${sessionId}/${Date.now()}-${safeFileName(file.name)}`;
      const { data, error } = await supabase.storage
        .from('chat-files')
        .upload(path, file);

      if (error) {
        console.error('Upload error:', error);
        toast.error('Could not upload the file. Please try again.');
        return null;
      }

      // The bucket is private: store the storage path; the UI signs it for display (useChatFileUrl).
      return { url: data.path, name: file.name };
    },
    [sessionId]
  );

  return { messages, isLoading, typingUsers, sendMessage, sendTyping, uploadFile };
}
