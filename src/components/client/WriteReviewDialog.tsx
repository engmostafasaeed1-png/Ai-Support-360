import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Star, EyeOff, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/lib/friendlyError';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  /** The session to rate. Empty: the latest completed session of this client with this consultant that has no rating yet. */
  sessionId: string;
}

export default function WriteReviewDialog({ open, onOpenChange, consultantId, sessionId }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [score, setScore] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  // A rating belongs to a completed session (database rule). Without a session id, look for the latest completed session of this client with this consultant that has no rating yet.
  const { data: ratedSession, isLoading: lookingUp, isError: lookupFailed } = useQuery({
    queryKey: ['review-session', consultantId, sessionId],
    enabled: open,
    queryFn: async (): Promise<string | null> => {
      if (sessionId) return sessionId;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: done, error } = await supabase
        .from('sessions')
        .select('id')
        .eq('client_id', user.id)
        .eq('consultant_id', consultantId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      const ids = (done ?? []).map((s) => s.id);
      if (ids.length === 0) return null;
      const { data: rated, error: ratedError } = await supabase.from('ratings').select('session_id').eq('client_id', user.id).in('session_id', ids);
      if (ratedError) throw ratedError;
      const taken = new Set((rated ?? []).map((r) => r.session_id));
      return ids.find((id) => !taken.has(id)) ?? null;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (score === 0) throw new Error('Please select a rating');
      if (!ratedSession) throw new Error('There is no completed session to rate');

      const { error } = await supabase.from('ratings').insert({
        client_id: user.id,
        consultant_id: consultantId,
        session_id: ratedSession,
        score,
        comment: comment.trim() || null,
        is_anonymous: isAnonymous,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t('reviews.submitted', 'Review submitted! Thank you.'));
      queryClient.invalidateQueries({ queryKey: ['consultant-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-profile-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-profile-detail'] });
      queryClient.invalidateQueries({ queryKey: ['session-rating'] });
      queryClient.invalidateQueries({ queryKey: ['review-session'] });
      onOpenChange(false);
      setScore(0);
      setComment('');
      setIsAnonymous(false);
    },
    onError: (err) => toast.error(friendlyErrorMessage(err, 'Failed to submit review')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-primary" />
            {t('reviews.write_review', 'Write a Review')}
          </DialogTitle>
        </DialogHeader>

        {lookingUp ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Loader2 className="w-4 h-4 animate-spin" /> Looking for your sessions with this consultant...
          </div>
        ) : lookupFailed ? (
          <div className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/30 p-3 text-sm text-muted-foreground" role="alert">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Your sessions could not be checked right now. Please close this window and try again.</p>
          </div>
        ) : !ratedSession ? (
          <div className="flex items-start gap-2 rounded-xl border border-border/40 bg-muted/30 p-3 text-sm text-muted-foreground" data-testid="no-session-to-rate">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              You can rate a consultant after a completed session with them. Book a session; when it has taken place, mark it as completed on the session page, then you can rate it there or here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Star rating */}
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">{t('reviews.rate_experience', 'How was your experience?')}</p>
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    onClick={() => setScore(s)}
                    onMouseEnter={() => setHoveredStar(s)}
                    onMouseLeave={() => setHoveredStar(0)}
                    className="p-1 transition-transform hover:scale-110"
                    aria-label={`${s} star${s === 1 ? '' : 's'}`}
                  >
                    <Star
                      className={`w-8 h-8 transition-colors ${
                        s <= (hoveredStar || score) ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/30'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {score > 0 && (
                <p className="text-xs text-muted-foreground">
                  {score === 5 ? '⭐ Excellent!' : score === 4 ? '👍 Great' : score === 3 ? '👌 Good' : score === 2 ? '😐 Fair' : '😞 Poor'}
                </p>
              )}
            </div>

            {/* Comment */}
            <div className="space-y-2">
              <Label className="text-sm">{t('reviews.comment', 'Your feedback (optional)')}</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('reviews.comment_placeholder', 'Share your experience with this consultant...')}
                className="min-h-[80px]"
              />
            </div>

            {/* Anonymous toggle */}
            <div className="flex items-center justify-between rounded-xl border border-border/40 p-3">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-muted-foreground" />
                <div>
                  <Label className="text-sm font-medium">{t('reviews.post_anonymously', 'Post Anonymously')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('reviews.anonymous_desc', 'Your name won\'t be shown to the consultant')}
                  </p>
                </div>
              </div>
              <Switch checked={isAnonymous} onCheckedChange={setIsAnonymous} />
            </div>

            <Button
              className="w-full gradient-primary border-0"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || score === 0}
            >
              {mutation.isPending ? t('reviews.submitting', 'Submitting...') : t('reviews.submit', 'Submit Review')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
