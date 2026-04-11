import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Star, ClipboardCheck, MessageSquare, Zap, Clock, UserCheck, ThumbsUp } from 'lucide-react';
import { format } from 'date-fns';
import { useSatisfactionSurveys } from '@/hooks/useSatisfactionSurveys';
import SatisfactionSurveyDialog from '@/components/satisfaction/SatisfactionSurveyDialog';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

const dimensionMeta = [
  { key: 'communication_score', label: 'Communication', icon: MessageSquare },
  { key: 'technical_quality_score', label: 'Technical Quality', icon: Zap },
  { key: 'timeliness_score', label: 'Timeliness', icon: Clock },
  { key: 'professionalism_score', label: 'Professionalism', icon: UserCheck },
  { key: 'overall_score', label: 'Overall', icon: ThumbsUp },
] as const;

export default function SatisfactionPage() {
  const { t } = useTranslation();
  const { surveys, isLoading, submitSurvey } = useSatisfactionSurveys();
  const [fillingSurveyId, setFillingSurveyId] = useState<string | null>(null);

  const { data: currentUser } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id || null;
    },
  });

  const pendingSurveys = surveys.filter(s => s.status === 'pending' && s.rated_by === currentUser);
  const completedSurveys = surveys.filter(s => s.status === 'completed');
  const sentSurveys = surveys.filter(s => s.requested_by === currentUser && s.rated_by !== currentUser);

  // Aggregate stats from completed surveys where current user is rated
  const receivedCompleted = completedSurveys.filter(s => s.rated_user === currentUser);
  const avgByDimension = dimensionMeta.map(d => {
    const vals = receivedCompleted.map(s => (s as any)[d.key]).filter((v: any) => v != null) as number[];
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { ...d, avg: Math.round(avg * 10) / 10 };
  });

  const fillingSurvey = fillingSurveyId ? surveys.find(s => s.id === fillingSurveyId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" />
          {t('csat.page_title', 'Satisfaction Surveys')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('csat.page_desc', 'Rate and review experiences across 5 quality dimensions')}</p>
      </div>

      {/* Summary Card */}
      {receivedCompleted.length > 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold mb-3">Your Satisfaction Scores</h3>
            <div className="space-y-2">
              {avgByDimension.map(d => {
                const Icon = d.icon;
                return (
                  <div key={d.key} className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-xs w-28 text-muted-foreground">{d.label}</span>
                    <Progress value={(d.avg / 5) * 100} className="h-2 flex-1" />
                    <span className="text-xs font-semibold w-8 text-end">{d.avg || '—'}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="pending" className="flex-1 gap-1">
            Pending {pendingSurveys.length > 0 && <Badge variant="secondary" className="text-[10px]">{pendingSurveys.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex-1">Completed</TabsTrigger>
          <TabsTrigger value="sent" className="flex-1">Sent</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-3">
          {isLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
          ) : pendingSurveys.length === 0 ? (
            <div className="text-center py-10">
              <Star className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No pending surveys</p>
            </div>
          ) : (
            pendingSurveys.map(s => (
              <Card key={s.id} className="border-border/40 hover:border-primary/30 transition-all">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Rate: {s.rated_user_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.ticket_id ? 'From ticket' : s.session_id ? 'From session' : 'Direct request'}
                      {' · '}{format(new Date(s.created_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <Button size="sm" className="gradient-primary border-0" onClick={() => setFillingSurveyId(s.id)}>
                    Fill Survey
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-4 space-y-3">
          {completedSurveys.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground">No completed surveys yet</p>
            </div>
          ) : (
            completedSurveys.map(s => (
              <Card key={s.id} className="border-border/40">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">
                      {s.rated_by === currentUser ? `You → ${s.rated_user_name}` : `${s.rated_by_name} → You`}
                    </p>
                    <Badge variant="outline" className="text-[10px]">{format(new Date(s.created_at), 'MMM d')}</Badge>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {dimensionMeta.map(d => {
                      const val = (s as any)[d.key];
                      return (
                        <div key={d.key} className="text-center">
                          <p className="text-[10px] text-muted-foreground">{d.label.split(' ')[0]}</p>
                          <div className="flex items-center justify-center gap-0.5">
                            <Star className={`w-3 h-3 ${val ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/25'}`} />
                            <span className="text-xs font-semibold">{val || '—'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {s.comment && <p className="text-xs text-muted-foreground mt-2 border-t border-border/30 pt-2">{s.comment}</p>}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4 space-y-3">
          {sentSurveys.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground">No sent survey requests</p>
            </div>
          ) : (
            sentSurveys.map(s => (
              <Card key={s.id} className="border-border/40">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">To: {s.rated_by_name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(s.created_at), 'MMM d, yyyy')}</p>
                  </div>
                  <Badge variant={s.status === 'completed' ? 'default' : 'secondary'} className="text-[10px]">
                    {s.status}
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {fillingSurvey && (
        <SatisfactionSurveyDialog
          open={!!fillingSurveyId}
          onOpenChange={open => !open && setFillingSurveyId(null)}
          targetName={fillingSurvey.rated_user_name}
          isPending={submitSurvey.isPending}
          onSubmit={scores => {
            submitSurvey.mutate({
              surveyId: fillingSurvey.id,
              ...scores,
            }, { onSuccess: () => setFillingSurveyId(null) });
          }}
        />
      )}
    </div>
  );
}
