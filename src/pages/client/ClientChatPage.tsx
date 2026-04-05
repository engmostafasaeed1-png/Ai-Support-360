import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { MessageSquare, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

const mockSessions = [
  { id: 'demo-session-1', consultant: 'Sarah Johnson', module: 'S/4HANA', lastMessage: "I'll look into the migration error now.", time: '2 min ago', unread: 3, status: 'active' },
  { id: 'demo-session-2', consultant: 'Lisa Chen', module: 'FI/CO', lastMessage: 'The posting date issue should be resolved.', time: '1 hr ago', unread: 0, status: 'active' },
  { id: 'demo-session-3', consultant: 'David Park', module: 'BTP', lastMessage: 'Session completed. Please rate your experience.', time: '2 days ago', unread: 0, status: 'completed' },
];

export default function ClientChatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Messages</h1>
        <p className="text-sm text-muted-foreground">Chat with your consultants</p>
      </div>

      <div className="space-y-3">
        {mockSessions.map((session) => (
          <Link key={session.id} to={`/client/chat/${session.id}`}>
            <Card className="border-border/50 hover:shadow-md transition-shadow cursor-pointer mb-3">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent shrink-0">
                    {session.consultant.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h4 className="text-sm font-semibold text-foreground">{session.consultant}</h4>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {session.time}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-[10px]">{session.module}</Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${session.status === 'active' ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-muted text-muted-foreground'}`}
                      >
                        {session.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{session.lastMessage}</p>
                  </div>
                  {session.unread > 0 && (
                    <span className="w-5 h-5 rounded-full gradient-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground shrink-0">
                      {session.unread}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
