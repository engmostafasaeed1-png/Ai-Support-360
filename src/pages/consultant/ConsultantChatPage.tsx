import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useConsultantSessions } from '@/hooks/useConsultantSessions';
import { Skeleton } from '@/components/ui/skeleton';

export default function ConsultantChatPage() {
  const { data: sessions = [], isLoading } = useConsultantSessions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Messages</h1>
        <p className="text-sm text-muted-foreground">Chat with your clients</p>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : sessions.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-12 text-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nothing here yet</p>
              <p className="text-xs text-muted-foreground mt-1">Your client conversations will appear here once you have scheduled sessions.</p>
            </CardContent>
          </Card>
        ) : (
          sessions.map((session: any) => (
            <Link key={session.id} to={`/consultant/chat/${session.id}`}>
              <Card className="border-border/50 hover:shadow-md transition-shadow cursor-pointer mb-3">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                      {(session.client || 'Client').split(' ').map((n: string) => n[0]).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <h4 className="text-sm font-semibold text-foreground">{session.client}</h4>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {session.scheduled_at ? new Date(session.scheduled_at).toLocaleDateString() : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                          {session.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
