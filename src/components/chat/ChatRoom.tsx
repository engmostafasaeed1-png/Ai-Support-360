import { useState, useCallback } from 'react';
import { useChat } from '@/hooks/useChat';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';
import { Badge } from '@/components/ui/badge';
import { Video, Phone, MoreVertical, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface ChatRoomProps {
  sessionId: string;
  currentUserId: string;
  participantNames: Record<string, string>;
  sessionTitle?: string;
  backPath?: string;
}

export default function ChatRoom({
  sessionId,
  currentUserId,
  participantNames,
  sessionTitle = 'Chat Session',
  backPath,
}: ChatRoomProps) {
  const { messages, isLoading, typingUsers, sendMessage, sendTyping, uploadFile } = useChat({
    sessionId,
    userId: currentUserId,
  });
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();

  const otherName = Object.entries(participantNames).find(([id]) => id !== currentUserId)?.[1] || 'Participant';

  const handleFileUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      const result = await uploadFile(file);
      if (result) {
        await sendMessage(result.name, 'file', result.url, result.name);
      }
      setUploading(false);
    },
    [uploadFile, sendMessage]
  );

  return (
    <div className="flex flex-col h-full bg-background rounded-2xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-card/80 backdrop-blur">
        {backPath && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(backPath)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent shrink-0">
          {otherName.split(' ').map((n) => n[0]).join('')}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{otherName}</h3>
          <p className="text-[10px] text-muted-foreground truncate">{sessionTitle}</p>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
            Online
          </Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:flex">
            <Phone className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hidden sm:flex">
            <Video className="w-4 h-4 text-muted-foreground" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading messages...
        </div>
      ) : (
        <MessageList messages={messages} currentUserId={currentUserId} participantNames={participantNames} />
      )}

      {/* Typing indicator */}
      <TypingIndicator typingUsers={typingUsers} participantNames={participantNames} />

      {/* Input */}
      <ChatInput
        onSend={(content) => sendMessage(content, 'text')}
        onTyping={sendTyping}
        onFileUpload={handleFileUpload}
        disabled={uploading}
      />
    </div>
  );
}
