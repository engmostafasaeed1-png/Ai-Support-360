import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

const mockSessions = [
  { id: 'demo-session-1', client: 'Ahmed Al-Rashidi', module: 'S/4HANA', lastMessage: 'Thank you, I'll test the fix now.', time: '5 min ago', unread: 1, status: 'active' },
  { id: 'demo-session-2', client: 'Fatima Al-Zahrani', module: 'FI/CO', lastMessage: 'The report looks correct now!', time: '3 hr ago', unread: 0, status: 'active' },
  { id: 'demo-session-3', client: 'Noura Al-Otaibi', module: 'MM', lastMessage: 'Can we schedule a follow-up?', time: '1 day ago', unread: 2, status: 'active' },
];

export default function ConsultantChatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Messages</h1>
        <p className="text-sm text-muted-foreground">Chat with your clients</p>
      </div>

      <div className="space-y-3">
        {mockSessions.map((session) => (
          <Link key={session.id} to={`/consultant/chat/${session.id}`}>
            <Card className="border-border/50 hover:shadow-md transition-shadow cursor-pointer mb-3">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                    {session.client.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h4 className="text-sm font-semibold text-foreground">{session.client}</h4>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {session.time}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-[10px]">{session.module}</Badge>
                      <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
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
