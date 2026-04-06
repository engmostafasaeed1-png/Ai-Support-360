import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, MapPin, Video, History, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import InterviewAnswersDialog from './InterviewAnswersDialog';

const typeIcons: Record<string, typeof Bot> = { ai: Bot, physical: MapPin, online: Video };
const typeLabels: Record<string, string> = { ai: 'AI', physical: 'Physical', online: 'Online' };

const statusBadge: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  in_progress: { label: 'In Progress', cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  completed: { label: 'Completed', cls: 'bg-green-500/10 text-green-600 border-green-500/20' },
  reviewed: { label: 'Reviewed', cls: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
};

interface Props {
  consultantId?: string;
}

export default function InterviewHistory({ consultantId }: Props) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answersId, setAnswersId] = useState<string | null>(null);

  const { data: interviews, isLoading } = useQuery({
    queryKey: ['interview-history', consultantId],
    queryFn: async () => {
      if (!consultantId) return [];
      const { data, error } = await supabase
        .from('interview_sessions')
        .select('*')
        .eq('consultant_id', consultantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!consultantId,
  });

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-accent" />
            {t('interview_history.title', 'Interview History')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </CardContent>
      </Card>
    );
  }

  const list = interviews || [];

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-accent" />
          {t('interview_history.title', 'Interview History')}
          {list.length > 0 && (
            <Badge variant="secondary" className="text-[10px] ms-auto">{list.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t('interview_history.empty', 'No interviews yet.')}
          </p>
        ) : (
          <div className="space-y-3">
            {list.map((iv: any) => {
              const TypeIcon = typeIcons[iv.interview_type] || Bot;
              const badge = statusBadge[iv.status] || statusBadge.pending;
              const isExpanded = expandedId === iv.id;
              const date = new Date(iv.created_at).toLocaleDateString();

              return (
                <div key={iv.id} className="rounded-xl border border-border/30 overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 p-4 bg-muted/10 hover:bg-muted/20 transition-colors text-start"
                    onClick={() => setExpandedId(isExpanded ? null : iv.id)}
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <TypeIcon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {typeLabels[iv.interview_type] || 'Interview'}
                        </span>
                        <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{date}</p>
                    </div>
                    {iv.overall_score != null && (
                      <div className="text-center me-2">
                        <span className="text-lg font-bold text-foreground">{iv.overall_score}</span>
                        <p className="text-[10px] text-muted-foreground">/100</p>
                      </div>
                    )}
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="p-4 border-t border-border/30 space-y-3">
                      {iv.technical_score != null && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 rounded-lg bg-muted/20 text-center">
                            <p className="text-lg font-bold text-foreground">{iv.technical_score}</p>
                            <p className="text-[10px] text-muted-foreground">{t('ai_interview.technical', 'Technical')}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/20 text-center">
                            <p className="text-lg font-bold text-foreground">{iv.soft_skills_score ?? '—'}</p>
                            <p className="text-[10px] text-muted-foreground">{t('ai_interview.soft_skills', 'Soft Skills')}</p>
                          </div>
                        </div>
                      )}
                      {iv.ai_summary && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                            {t('interview_history.summary', 'AI Summary')}
                          </p>
                          <p className="text-sm text-foreground">{iv.ai_summary}</p>
                        </div>
                      )}
                      {iv.started_at && (
                        <p className="text-xs text-muted-foreground">
                          {t('interview_history.started', 'Started')}: {new Date(iv.started_at).toLocaleString()}
                          {iv.completed_at && ` — ${t('interview_history.completed', 'Completed')}: ${new Date(iv.completed_at).toLocaleString()}`}
                        </p>
                      )}
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => setAnswersId(iv.id)}>
                        <Eye className="w-3.5 h-3.5 me-1" />
                        {t('interview_history.view_answers', 'View Answers')}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <InterviewAnswersDialog
        interviewId={answersId}
        open={!!answersId}
        onOpenChange={(open) => !open && setAnswersId(null)}
      />
    </Card>
  );
}
