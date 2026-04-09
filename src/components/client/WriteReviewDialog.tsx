import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Star, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  sessionId: string;
}

export default function WriteReviewDialog({ open, onOpenChange, consultantId, sessionId }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [score, setScore] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (score === 0) throw new Error('Please select a rating');

      const { error } = await supabase.from('ratings').insert({
        client_id: user.id,
        consultant_id: consultantId,
        session_id: sessionId,
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
      onOpenChange(false);
      setScore(0);
      setComment('');
      setIsAnonymous(false);
    },
    onError: (err: any) => toast.error(err.message || 'Failed to submit review'),
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

        <div className="space-y-5">
          {/* Star rating */}
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">{t('reviews.rate_experience', 'How was your experience?')}</p>
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map(s => (
                <button
                  key={s}
                  onClick={() => setScore(s)}
                  onMouseEnter={() => setHoveredStar(s)}
                  onMouseLeave={() => setHoveredStar(0)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      s <= (hoveredStar || score)
                        ? 'text-yellow-500 fill-yellow-500'
                        : 'text-muted-foreground/30'
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
              onChange={e => setComment(e.target.value)}
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
      </DialogContent>
    </Dialog>
  );
}
