import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import ChatRoom from '@/components/chat/ChatRoom';

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
  const { isGuest } = useGuestMode();
  const sid = sessionId || 'demo-session-1';
  const backPath = role === 'client' ? '/client/chat' : '/consultant/chat';

  const { data: liveParticipants } = useQuery({
    queryKey: ['chat-session-participants', sid],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: session } = await supabase
        .from('sessions')
        .select('client_id, consultant_id')
        .eq('id', sid)
        .maybeSingle();
      if (!session) return null;

      const consultantUserId = session.consultant_id
        ? (await supabase.from('consultants').select('user_id').eq('id', session.consultant_id).maybeSingle()).data?.user_id
        : null;

      const ids = [session.client_id, consultantUserId].filter(Boolean) as string[];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', ids);
      const nameMap: Record<string, string> = {};
      (profiles || []).forEach(p => { nameMap[p.user_id] = p.display_name || 'User'; });

      const participants: Record<string, string> = {};
      participants[session.client_id] = nameMap[session.client_id] || 'Client';
      if (consultantUserId) participants[consultantUserId] = nameMap[consultantUserId] || 'Consultant';
      return { participants, currentUserId: user.id };
    },
    enabled: !isGuest,
  });

  const participants = isGuest
    ? (mockParticipants[sid] || mockParticipants['demo-session-1'])
    : (liveParticipants?.participants || {});
  const userIds = Object.keys(participants);
  const currentUserId = isGuest
    ? (role === 'client' ? userIds[0] : userIds[1])
    : (liveParticipants?.currentUserId || userIds[0] || '');

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
