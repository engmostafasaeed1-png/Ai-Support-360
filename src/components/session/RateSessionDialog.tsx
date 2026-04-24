import { useState, useEffect } from 'react';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Star, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  sessionId: string;
  consultantId: string;
  consultantName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ratingSchema = z.object({
  score: z.number().int().min(1, 'Please select a star rating').max(5),
  comment: z.string().trim().max(1000, 'Feedback must be under 1000 characters').optional(),
  is_anonymous: z.boolean(),
});

const SCORE_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

export default function RateSessionDialog({
  sessionId,
  consultantId,
  consultantName,
  open,
  onOpenChange,
}: Props) {
  const queryClient = useQueryClient();
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  useEffect(() => {
    if (!open) {
      setScore(0);
      setHover(0);
      setComment('');
      setAnonymous(false);
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: async () => {
      const parsed = ratingSchema.safeParse({ score, comment, is_anonymous: anonymous });
      if (!parsed.success) {
        throw new Error(parsed.error.errors[0]?.message || 'Invalid input');
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('ratings').insert({
        session_id: sessionId,
        client_id: user.id,
        consultant_id: consultantId,
        score: parsed.data.score,
        comment: parsed.data.comment || null,
        is_anonymous: parsed.data.is_anonymous,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Thanks for your feedback!');
      queryClient.invalidateQueries({ queryKey: ['session-rating', sessionId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to submit rating'),
  });

  const display = hover || score;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThumbsUp className="w-5 h-5 text-primary" />
            Rate your session
          </DialogTitle>
          <DialogDescription>
            How was your experience{consultantName ? ` with ${consultantName}` : ''}? Your feedback
            helps consultants improve.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Overall rating</Label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={`${v} star${v > 1 ? 's' : ''}`}
                  onMouseEnter={() => setHover(v)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setScore(v)}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                >
                  <Star
                    className={`w-7 h-7 transition-colors ${
                      v <= display
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground/40'
                    }`}
                  />
                </button>
              ))}
              {display > 0 && (
                <span className="ms-2 text-sm font-medium text-muted-foreground">
                  {SCORE_LABELS[display]}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rating-comment" className="text-sm font-medium">
              Detailed feedback <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="rating-comment"
              placeholder="What went well? What could be improved?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              className="min-h-[100px]"
            />
            <p className="text-[11px] text-muted-foreground text-end">{comment.length}/1000</p>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/50 p-3">
            <div>
              <Label htmlFor="rating-anon" className="text-sm font-medium">Submit anonymously</Label>
              <p className="text-xs text-muted-foreground">Your name won't be shown publicly.</p>
            </div>
            <Switch id="rating-anon" checked={anonymous} onCheckedChange={setAnonymous} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || score === 0}
            >
              {submit.isPending ? 'Submitting...' : 'Submit Rating'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
