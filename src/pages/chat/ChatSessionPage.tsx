import { useParams } from 'react-router-dom';
import ChatRoom from '@/components/chat/ChatRoom';

// Demo chat room using mock data — for prototype purposes
// In production, sessionId, userId, and names come from auth + DB

const mockParticipants: Record<string, Record<string, string>> = {
  'demo-session-1': { 'client-user-1': 'Ahmed Al-Rashidi', 'consultant-user-1': 'Sarah Johnson' },
  'demo-session-2': { 'client-user-2': 'Fatima Al-Zahrani', 'consultant-user-2': 'Lisa Chen' },
  'demo-session-3': { 'client-user-3': 'Noura Al-Otaibi', 'consultant-user-3': 'David Park' },
};

interface ChatSessionPageProps {
  role: 'client' | 'consultant';
}

export default function ChatSessionPage({ role }: ChatSessionPageProps) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const sid = sessionId || 'demo-session-1';

  const participants = mockParticipants[sid] || mockParticipants['demo-session-1'];
  const userIds = Object.keys(participants);
  const currentUserId = role === 'client' ? userIds[0] : userIds[1];
  const backPath = role === 'client' ? '/client/chat' : '/consultant/chat';

  return (
    <div className="h-[calc(100vh-7rem)]">
      <ChatRoom
        sessionId={sid}
        currentUserId={currentUserId}
        participantNames={participants}
        sessionTitle={`Session ${sid.split('-').pop()}`}
        backPath={backPath}
      />
    </div>
  );
}
