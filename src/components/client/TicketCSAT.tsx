import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Star, Send, Loader2, ThumbsUp, MessageSquare } from 'lucide-react';

interface Props {
  ticketId: string;
  ticketTitle: string;
  ticketStatus: string;
  clientId: string;
  consultantId: string | null;
}

export default function TicketCSAT({ ticketId, ticketTitle, ticketStatus, clientId, consultantId }: Props) {
  const queryClient = useQueryClient();
  const [surveyOpen, setSurveyOpen] = useState(false);

  const { data: survey, isLoading } = useQuery({
    queryKey: ['ticket-csat', ticketId],
    queryFn: async () => {
      const { data } = await supabase
        .from('ticket_satisfaction_surveys')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const isResolved = ['resolved', 'closed'].includes(ticketStatus);
  const canRate = isResolved && !survey?.rating;

  if (isLoading) return <Skeleton className="h-20 rounded-2xl" />;

  // Show rating card if already rated
  if (survey?.rating) {
    return (
      <Card className="rounded-2xl border-border/50 bg-green-50/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map(s => (
                <Star key={s} className={`w-5 h-5 ${s <= (survey.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-muted/30'}`} />
              ))}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Customer Satisfaction</p>
              <p className="text-[10px] text-muted-foreground">
                Rated {format(new Date(survey.responded_at || survey.created_at), 'MMM d, yyyy')}
              </p>
            </div>
            <Badge variant="secondary" className={`text-[10px] ${
              (survey.rating || 0) >= 4 ? 'bg-green-100 text-green-700' :
              (survey.rating || 0) >= 3 ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-700'
            }`}>
              {(survey.rating || 0) >= 4 ? 'Satisfied' : (survey.rating || 0) >= 3 ? 'Neutral' : 'Unsatisfied'}
            </Badge>
          </div>
          {survey.feedback && (
            <div className="mt-2 p-2 rounded-lg bg-muted/20 text-xs text-muted-foreground flex items-start gap-1.5">
              <MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />
              {survey.feedback}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Show rate button if ticket is resolved
  if (canRate) {
    return (
      <>
        <Card className="rounded-2xl border-border/50 border-dashed">
          <CardContent className="p-4 text-center">
            <ThumbsUp className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-2">How was your experience with this ticket?</p>
            <Button size="sm" className="gap-1.5 gradient-primary border-0" onClick={() => setSurveyOpen(true)}>
              <Star className="w-3.5 h-3.5" /> Rate Experience
            </Button>
          </CardContent>
        </Card>
        <CSATDialog
          open={surveyOpen}
          onOpenChange={setSurveyOpen}
          ticketId={ticketId}
          clientId={clientId}
          consultantId={consultantId}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ['ticket-csat', ticketId] })}
        />
      </>
    );
  }

  // Not resolved yet
  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="py-6 text-center">
        <Star className="w-6 h-6 text-muted-foreground/20 mx-auto mb-1" />
        <p className="text-xs text-muted-foreground">Satisfaction survey available after ticket resolution</p>
      </CardContent>
    </Card>
  );
}

function CSATDialog({ open, onOpenChange, ticketId, clientId, consultantId, onComplete }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  ticketId: string; clientId: string; consultantId: string | null;
  onComplete: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!rating) { toast.error('Please select a rating'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('ticket_satisfaction_surveys').insert({
        ticket_id: ticketId,
        client_id: clientId,
        consultant_id: consultantId,
        rating,
        feedback: feedback.trim() || null,
        responded_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
      toast.success('Thank you for your feedback!');
      onOpenChange(false);
      onComplete();
    } catch {
      toast.error('Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const labels = ['', 'Very Unsatisfied', 'Unsatisfied', 'Neutral', 'Satisfied', 'Very Satisfied'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Rate Your Experience</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-center">
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                onClick={() => setRating(s)}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(0)}
                className="transition-transform hover:scale-110"
              >
                <Star className={`w-10 h-10 transition-colors ${
                  s <= (hover || rating) ? 'fill-amber-400 text-amber-400' : 'text-muted/30'
                }`} />
              </button>
            ))}
          </div>
          {(hover || rating) > 0 && (
            <p className="text-sm font-medium text-foreground">{labels[hover || rating]}</p>
          )}
          <Textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Any additional feedback? (optional)"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Skip</Button>
          <Button onClick={handleSubmit} disabled={saving || !rating} className="gradient-primary border-0 gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
