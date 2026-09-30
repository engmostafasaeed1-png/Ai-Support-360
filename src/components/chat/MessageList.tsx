import { useRef, useEffect } from 'react';
import { ChatMessage } from '@/hooks/useChat';
import { FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { useChatFileUrl } from '@/hooks/useChatFileUrl';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  participantNames: Record<string, string>;
}

function ChatFileAttachment({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  const href = useChatFileUrl(msg.file_url);
  const image = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(msg.file_url || '');

  if (!href) {
    return <span className="text-xs opacity-70">{msg.file_name || 'Attachment'}</span>;
  }

  return image ? (
    <img
      src={href}
      alt={msg.file_name || 'image'}
      className="rounded-lg max-w-full max-h-60 object-cover mb-1"
    />
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 ${isMine ? 'text-primary-foreground/80 hover:text-primary-foreground' : 'text-accent hover:underline'}`}
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="truncate text-xs">{msg.file_name || 'Download file'}</span>
      <Download className="w-3.5 h-3.5 shrink-0" />
    </a>
  );
}

export default function MessageList({ messages, currentUserId, participantNames }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.length === 0 && (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No messages yet. Start the conversation!
        </div>
      )}

      {messages.map((msg, i) => {
        const isMine = msg.sender_id === currentUserId;
        const showAvatar = i === 0 || messages[i - 1].sender_id !== msg.sender_id;
        const senderName = participantNames[msg.sender_id] || 'Unknown';

        if (msg.message_type === 'system') {
          return (
            <div key={msg.id} className="flex justify-center">
              <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                {msg.content}
              </span>
            </div>
          );
        }

        return (
          <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className="w-7 shrink-0">
              {showAvatar && (
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    isMine ? 'gradient-primary text-primary-foreground' : 'bg-accent/10 text-accent'
                  }`}
                >
                  {senderName.split(' ').map((n) => n[0]).join('')}
                </div>
              )}
            </div>

            {/* Bubble */}
            <div className={`max-w-[70%] ${isMine ? 'items-end' : 'items-start'}`}>
              {showAvatar && (
                <p className={`text-[10px] text-muted-foreground mb-0.5 ${isMine ? 'text-end' : ''}`}>
                  {senderName}
                </p>
              )}
              <div
                className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  isMine
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-muted/60 text-foreground rounded-tl-sm'
                }`}
              >
                {msg.message_type === 'file' && msg.file_url ? (
                  <div>
                    <ChatFileAttachment msg={msg} isMine={isMine} />
                    {msg.content && msg.content !== msg.file_name && (
                      <p className="mt-1">{msg.content}</p>
                    )}
                  </div>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
              <p className={`text-[9px] text-muted-foreground mt-0.5 ${isMine ? 'text-end' : ''}`}>
                {format(new Date(msg.created_at), 'HH:mm')}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
