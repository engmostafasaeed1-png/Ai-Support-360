import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Video, MessageSquare, Monitor, Clock, User, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

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

export default function SessionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: sessions, isLoading, error } = useQuery({
    queryKey: ['client-sessions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch sessions with consultant info via FK join
      const { data, error } = await supabase
        .from('sessions')
        .select('*, consultants(id, user_id, hourly_rate)')
        .eq('client_id', user.id)
        .order('scheduled_at', { ascending: false });

      if (error) throw error;

      // Fetch display names from profiles for all consultant user_ids
      const consultantUserIds = [...new Set(
        (data || []).map((s: any) => s.consultants?.user_id).filter(Boolean)
      )];

      let profileMap: Record<string, string> = {};
      if (consultantUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profile_directory')
          .select('user_id, display_name, avatar_url')
          .in('user_id', consultantUserIds);

        if (profiles) {
          profileMap = Object.fromEntries(
            profiles.map(p => [p.user_id, p.display_name || 'Consultant'])
          );
        }
      }

      return (data || []).map((s: any) => ({
        ...s,
        consultant_name: profileMap[s.consultants?.user_id] || t('sessions_page.unknown_consultant'),
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('sessions_page.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('sessions_page.subtitle')}</p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {error && (
        <Card className="rounded-2xl border-destructive/50">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-destructive">{t('sessions_page.login_required')}</p>
            <Button variant="outline" className="mt-3" onClick={() => navigate('/login')}>
              {t('sessions_page.go_login')}
            </Button>
          </CardContent>
        </Card>
      )}

      {sessions && sessions.length === 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-12 text-center">
            <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium text-foreground">{t('sessions_page.empty_title')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('sessions_page.empty_desc')}</p>
            <Button className="gradient-primary border-0 mt-4" onClick={() => navigate('/client/consultants')}>
              {t('sessions_page.browse_consultants')}
            </Button>
          </CardContent>
        </Card>
      )}

      {sessions && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map((session) => {
            const TypeIcon = typeIcons[session.session_type as keyof typeof typeIcons] || Video;
            const status = session.status || 'scheduled';

            return (
              <Card key={session.id} className="rounded-2xl border-border/50 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => navigate(`/client/sessions/${session.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <TypeIcon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={statusVariant[status] || 'outline'} className="text-[10px]">
                            {t(`sessions_page.status_${status}`)}
                          </Badge>
                          <span className="text-xs text-muted-foreground capitalize">
                            {session.session_type?.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-foreground mt-1 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          {(session as any).consultant_name}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-sm">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            {session.scheduled_at
                              ? format(new Date(session.scheduled_at), 'PPp')
                              : t('sessions_page.not_scheduled')}
                          </div>
                          {session.duration_minutes > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {session.duration_minutes} min
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {status === 'scheduled' && (
                      <Button size="sm" variant="outline" className="shrink-0 gap-1">
                        {t('sessions_page.join')} <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
