import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import RatingStars from '@/components/client/RatingStars';

export default function ClientCollaborationRatingCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['own-client-rating-stats'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await (supabase as any).from('client_rating_stats')
        .select('avg_score, review_count, communication_avg, clarity_avg, cooperation_avg, would_work_again_pct')
        .eq('client_id', user.id).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });
  if (isLoading) return null;
  const rows = data ? ([
    ['Communication', data.communication_avg],
    ['Clarity of requirements', data.clarity_avg],
    ['Cooperation', data.cooperation_avg],
  ].filter(([, v]) => v !== null && v !== undefined) as [string, number][]) : [];
  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">How consultants rate your collaboration</CardTitle></CardHeader>
      <CardContent>
        {!data || !data.review_count ? (
          <p className="text-sm text-muted-foreground">No ratings yet. Consultants can rate you after a request is finished.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
            <RatingStars rating={Number(data.avg_score)} reviews={Number(data.review_count)} size="lg" />
            <div className="space-y-3">
              {rows.map(([label, v]) => (
                <div key={label} className="space-y-1">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium text-foreground" dir="ltr">{Number(v).toFixed(1)}</span></div>
                  <Progress value={(Number(v) / 5) * 100} aria-label={label} className="h-2" />
                </div>
              ))}
              {data.would_work_again_pct !== null && data.would_work_again_pct !== undefined && (
                <p className="text-sm text-foreground"><span dir="ltr">{data.would_work_again_pct}%</span> <span>would work with you again</span></p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
