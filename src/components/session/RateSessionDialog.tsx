import { useState, useEffect } from 'react';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, ThumbsUp, CheckCircle2, Lock, MessageCircle, Wrench, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Props {
  sessionId: string;
  consultantId: string;
  consultantName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const optionalScore = z
  .number()
  .int()
  .min(1)
  .max(5)
  .optional()
  .or(z.literal(0).transform(() => undefined));

const ratingSchema = z.object({
  score: z.number().int().min(1, 'Please select a star rating').max(5),
  comment: z.string().trim().max(1000, 'Feedback must be under 1000 characters').optional(),
  is_anonymous: z.boolean(),
  communication_score: optionalScore,
  technical_expertise_score: optionalScore,
  responsiveness_score: optionalScore,
});

const SCORE_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

type CategoryKey = 'communication' | 'technical' | 'responsiveness';

const CATEGORIES: { key: CategoryKey; label: string; description: string; icon: any }[] = [
  { key: 'communication', label: 'Communication', description: 'Clarity, listening, language', icon: MessageCircle },
  { key: 'technical', label: 'Technical Expertise', description: 'SAP knowledge & problem solving', icon: Wrench },
  { key: 'responsiveness', label: 'Responsiveness', description: 'Punctuality and follow-through', icon: Zap },
];

function CategoryStars({
  value,
  onChange,
  ariaLabel,
}: { value: number; onChange: (v: number) => void; ariaLabel: string }) {
  const [hoverV, setHoverV] = useState(0);
  const display = hoverV || value;
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHoverV(0)}>
      {[1, 2, 3, 4, 5].map((v) => (
        <button
          key={v}
          type="button"
          aria-label={`${ariaLabel}: ${v} star${v > 1 ? 's' : ''}`}
          onMouseEnter={() => setHoverV(v)}
          onClick={() => onChange(v === value ? 0 : v)}
          className="p-0.5 rounded hover:bg-muted transition-colors"
        >
          <Star
            className={`w-4 h-4 transition-colors ${
              v <= display ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

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
  const [communicationScore, setCommunicationScore] = useState(0);
  const [technicalScore, setTechnicalScore] = useState(0);
  const [responsivenessScore, setResponsivenessScore] = useState(0);

  useEffect(() => {
    if (!open) {
      setScore(0);
      setHover(0);
      setComment('');
      setAnonymous(false);
      setCommunicationScore(0);
      setTechnicalScore(0);
      setResponsivenessScore(0);
    }
  }, [open]);

  // Look up an existing rating from the current user for this session
  const existing = useQuery({
    queryKey: ['session-rating', sessionId],
    enabled: open && !!sessionId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('ratings')
        .select('id, score, comment, is_anonymous, created_at, communication_score, technical_expertise_score, responsiveness_score')
        .eq('session_id', sessionId)
        .eq('client_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      // Defensive guard: prevent a second rating for the same session
      if (existing.data) {
        throw new Error('You have already rated this session.');
      }

      const parsed = ratingSchema.safeParse({
        score,
        comment,
        is_anonymous: anonymous,
        communication_score: communicationScore || undefined,
        technical_expertise_score: technicalScore || undefined,
        responsiveness_score: responsivenessScore || undefined,
      });
      if (!parsed.success) {
        throw new Error(parsed.error.errors[0]?.message || 'Invalid input');
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Re-check inside the transaction window to avoid races
      const { data: dup } = await supabase
        .from('ratings')
        .select('id')
        .eq('session_id', sessionId)
        .eq('client_id', user.id)
        .maybeSingle();
      if (dup) {
        throw new Error('A rating for this session already exists.');
      }

      const { error } = await (supabase.from('ratings') as any).insert({
        session_id: sessionId,
        client_id: user.id,
        consultant_id: consultantId,
        score: parsed.data.score,
        comment: parsed.data.comment || null,
        is_anonymous: parsed.data.is_anonymous,
        communication_score: parsed.data.communication_score ?? null,
        technical_expertise_score: parsed.data.technical_expertise_score ?? null,
        responsiveness_score: parsed.data.responsiveness_score ?? null,
      });
      if (error) {
        // Handle unique constraint violations gracefully
        if ((error as any).code === '23505') {
          throw new Error('You have already rated this session.');
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success('Thanks for your feedback!');
      queryClient.invalidateQueries({ queryKey: ['session-rating', sessionId] });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e.message || 'Failed to submit rating');
      // Refresh in case the rating exists server-side
      queryClient.invalidateQueries({ queryKey: ['session-rating', sessionId] });
    },
  });

  const display = hover || score;
  const alreadyRated = !!existing.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ThumbsUp className="w-5 h-5 text-primary" />
            {alreadyRated ? 'Your session rating' : 'Rate your session'}
          </DialogTitle>
          <DialogDescription>
            {alreadyRated
              ? `You've already submitted a rating${consultantName ? ` for ${consultantName}` : ''}. Each session can only be rated once.`
              : `How was your experience${consultantName ? ` with ${consultantName}` : ''}? Your feedback helps consultants improve.`}
          </DialogDescription>
        </DialogHeader>

        {existing.isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : alreadyRated ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                  Submitted {existing.data?.created_at ? format(new Date(existing.data.created_at), 'MMM d, yyyy · h:mm a') : ''}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((v) => (
                  <Star
                    key={v}
                    className={`w-6 h-6 ${
                      v <= (existing.data?.score || 0)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground/30'
                    }`}
                  />
                ))}
                <span className="ms-2 text-sm font-medium text-foreground">
                  {SCORE_LABELS[existing.data?.score || 0]}
                </span>
              </div>

              {(() => {
                const items = [
                  { key: 'communication', label: 'Communication', icon: MessageCircle, value: (existing.data as any)?.communication_score },
                  { key: 'technical', label: 'Technical Expertise', icon: Wrench, value: (existing.data as any)?.technical_expertise_score },
                  { key: 'responsiveness', label: 'Responsiveness', icon: Zap, value: (existing.data as any)?.responsiveness_score },
                ].filter((it) => typeof it.value === 'number' && it.value > 0);
                if (items.length === 0) return null;
                return (
                  <div className="rounded-lg border border-border/40 bg-background/60 p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Detailed scores</p>
                    {items.map((it) => {
                      const Icon = it.icon;
                      return (
                        <div key={it.key} className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                            {it.label}
                          </span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((v) => (
                              <Star
                                key={v}
                                className={`w-3.5 h-3.5 ${
                                  v <= (it.value as number)
                                    ? 'fill-yellow-400 text-yellow-400'
                                    : 'text-muted-foreground/30'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {existing.data?.comment ? (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Your feedback</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{existing.data.comment}</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No written feedback provided.</p>
              )}

              {existing.data?.is_anonymous && (
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Submitted anonymously
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
