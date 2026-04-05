import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  ChevronLeft, Video, MessageSquare, Monitor, Clock, User,
  Calendar, FileText, ListChecks, Play,
} from 'lucide-react';
import { format } from 'date-fns';

const typeIcons = {
  video: Video,
  chat: MessageSquare,
  screen_share: Monitor,
} as const;

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  scheduled: 'default',
  in_progress: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
};

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: session, isLoading } = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, consultants!sessions_consultant_id_fkey(id, user_id, hourly_rate, bio)')
        .eq('id', sessionId!)
        .single();

      if (error) throw error;

      // Get consultant display name
      let consultantName = t('session_detail.unknown_consultant');
      if (data.consultants?.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('user_id', data.consultants.user_id)
          .single();
        if (profile?.display_name) consultantName = profile.display_name;
      }

      return { ...data, consultant_name: consultantName };
    },
    enabled: !!sessionId,
  });

  // Fetch chat messages for this session
  const { data: messages } = useQuery({
    queryKey: ['session-messages', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!sessionId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t('session_detail.not_found')}</p>
      </div>
    );
  }

  const TypeIcon = typeIcons[session.session_type as keyof typeof typeIcons] || Video;
  const status = session.status || 'scheduled';

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/client/sessions')} className="gap-1">
        <ChevronLeft className="w-4 h-4" /> {t('session_detail.back')}
      </Button>

      {/* Header card */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <TypeIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={statusVariant[status] || 'outline'} className="text-xs">
                    {t(`sessions_page.status_${status}`)}
                  </Badge>
                  <span className="text-sm text-muted-foreground capitalize">
                    {session.session_type?.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-lg font-semibold text-foreground mt-1 flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  {(session as any).consultant_name}
                </p>
              </div>
            </div>

            {status === 'scheduled' && (
              <Button className="gradient-primary border-0 gap-1.5" size="lg">
                <Play className="w-4 h-4" /> {t('session_detail.join_session')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Details grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent" /> {t('session_detail.schedule')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('session_detail.scheduled_at')}</span>
              <span className="font-medium text-foreground">
                {session.scheduled_at ? format(new Date(session.scheduled_at), 'PPp') : '—'}
              </span>
            </div>
            {session.started_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('session_detail.started_at')}</span>
                <span className="font-medium text-foreground">
                  {format(new Date(session.started_at), 'PPp')}
                </span>
              </div>
            )}
            {session.ended_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('session_detail.ended_at')}</span>
                <span className="font-medium text-foreground">
                  {format(new Date(session.ended_at), 'PPp')}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('session_detail.duration')}</span>
              <span className="font-medium text-foreground">
                {session.duration_minutes || 0} {t('session_detail.minutes')}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" /> {t('session_detail.notes_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {session.notes ? (
              <p className="text-sm text-muted-foreground leading-relaxed">{session.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">{t('session_detail.no_notes')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Summary */}
      {(session.ai_summary || (session.ai_action_items && session.ai_action_items.length > 0)) && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-accent" /> {t('session_detail.ai_summary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {session.ai_summary && (
              <p className="text-sm text-muted-foreground leading-relaxed">{session.ai_summary}</p>
            )}
            {session.ai_action_items && session.ai_action_items.length > 0 && (
              <div>
                <p className="text-xs font-medium text-foreground mb-2">{t('session_detail.action_items')}</p>
                <ul className="space-y-1.5">
                  {session.ai_action_items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chat history */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-accent" /> {t('session_detail.chat_history')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!messages || messages.length === 0) ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">
              {t('session_detail.no_messages')}
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {messages.map((msg) => {
                const isClient = msg.sender_id === session.client_id;
                return (
                  <div key={msg.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] p-3 rounded-xl text-sm ${
                      isClient
                        ? 'bg-primary text-primary-foreground rounded-ee-sm'
                        : 'bg-muted text-foreground rounded-es-sm'
                    }`}>
                      {msg.content && <p>{msg.content}</p>}
                      {msg.file_name && (
                        <p className="text-xs underline mt-1">{msg.file_name}</p>
                      )}
                      <p className={`text-[10px] mt-1 ${isClient ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {format(new Date(msg.created_at), 'p')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
