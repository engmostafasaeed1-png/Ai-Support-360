import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Star, User, EyeOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { format } from 'date-fns';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockReviews } from '@/data/consultantMockData';

export default function ReviewsPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();

  const { data, isLoading } = useQuery({
    queryKey: ['consultant-reviews'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id, rating, total_reviews')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!consultant) return null;

      const { data: ratings } = await supabase
        .from('ratings')
        .select('id, score, comment, created_at, client_id, is_anonymous')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });

      // Fetch client names for non-anonymous reviews
      const nonAnonIds = (ratings || [])
        .filter((r: any) => !r.is_anonymous)
        .map((r: any) => r.client_id);

      let clientMap: Record<string, string> = {};
      if (nonAnonIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', nonAnonIds);
        if (profiles) {
          clientMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'Client']));
        }
      }

      return {
        rating: Number(consultant.rating) || 0,
        total: consultant.total_reviews || 0,
        reviews: (ratings || []).map((r: any) => ({
          ...r,
          client_name: r.is_anonymous ? null : (clientMap[r.client_id] || 'Client'),
        })),
      };
    },
    enabled: !isGuest,
  });

  const reviews = data?.reviews || (isGuest ? mockReviews.map(r => ({ ...r, client_name: r.client, is_anonymous: false })) : []);
  const avgRating = data?.rating || (reviews.length > 0 ? (reviews.reduce((s: number, r: any) => s + r.score, 0) / reviews.length) : 0);
  const totalReviews = data?.total || reviews.length;

  // Calculate distribution
  const dist = [5, 4, 3, 2, 1].map(star => {
    const count = reviews.filter((r: any) => r.score === star).length;
    return { star, count, pct: reviews.length > 0 ? Math.round((count / reviews.length) * 100) : 0 };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.reviews', 'Reviews')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('reviews.subtitle', 'All reviews from your clients')}
        </p>
      </div>

      {/* Summary Card */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-4xl font-bold text-foreground">{avgRating.toFixed(1)}</div>
              <div className="flex items-center gap-0.5 mt-1 justify-center">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`w-4 h-4 ${i < Math.round(avgRating) ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/30'}`} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{totalReviews} reviews</p>
            </div>
            <div className="flex-1 space-y-1.5">
              {dist.map(d => (
                <div key={d.star} className="flex items-center gap-2 text-xs">
                  <span className="w-4 text-end text-muted-foreground">{d.star}</span>
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                  <Progress value={d.pct} className="h-1.5 flex-1" />
                  <span className="w-8 text-end text-muted-foreground">{d.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reviews List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-12">
          <Star className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No reviews yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r: any) => (
            <Card key={r.id} className="border-border/40 hover:border-accent/30 hover:shadow-premium transition-all">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                      {r.is_anonymous ? (
                        <EyeOff className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <User className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <span className="font-semibold text-sm">
                        {r.is_anonymous ? t('reviews.anonymous', 'Anonymous') : r.client_name}
                      </span>
                      {r.is_anonymous && (
                        <Badge variant="secondary" className="text-[10px] ms-2">
                          {t('reviews.anonymous_badge', 'Anonymous Review')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`w-4 h-4 ${i < r.score ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/30'}`} />
                    ))}
                  </div>
                </div>
                {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                <p className="text-xs text-muted-foreground mt-2">
                  {r.created_at ? format(new Date(r.created_at), 'MMM d, yyyy') : r.date}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
