import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
    const loadMessages = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(data as unknown as ChatMessage[]);
      }
      setIsLoading(false);
    };

    loadMessages();
  }, [sessionId]);

  // Subscribe to realtime messages + presence
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${sessionId}`)
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
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
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
    async (content: string, type: 'text' | 'file' = 'text', fileUrl?: string, fileName?: string) => {
      const { error } = await supabase.from('messages').insert({
        session_id: sessionId,
        sender_id: userId,
        content: type === 'text' ? content : fileName || 'File',
        message_type: type,
        file_url: fileUrl || null,
        file_name: fileName || null,
      });
      if (error) console.error('Send message error:', error);
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
      const path = `${userId}/${Date.now()}-${file.name}`;
      const { data, error } = await supabase.storage
        .from('chat-files')
        .upload(path, file);

      if (error) {
        console.error('Upload error:', error);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('chat-files')
        .getPublicUrl(data.path);

      return { url: urlData.publicUrl, name: file.name };
    },
    [userId]
  );

  return { messages, isLoading, typingUsers, sendMessage, sendTyping, uploadFile };
}
