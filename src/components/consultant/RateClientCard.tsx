import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COMMENT = 1000;

export interface ClientReviewRow {
  id: string;
  score: number;
  communication_score: number | null;
  clarity_score: number | null;
  cooperation_score: number | null;
  would_work_again: boolean | null;
  comment: string | null;
  created_at: string;
}

export function canEditReview(createdAt: string, now = Date.now()) {
  return now - new Date(createdAt).getTime() < EDIT_WINDOW_MS;
}

interface StarInputProps { label: string; value: number | null; onChange: (v: number) => void; required?: boolean }

export function StarInput({ label, value, onChange, required }: StarInputProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, n: number) => {
    let next = n;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, n + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, n - 1);
    else return;
    e.preventDefault();
    onChange(next);
    refs.current[next - 1]?.focus();
  };
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">{label}{required && <span className="text-destructive"> *</span>}</p>
      <div role="radiogroup" aria-label={label} aria-required={required} className="flex items-center gap-1" dir="ltr">
        {[1, 2, 3, 4, 5].map(n => {
          const checked = value === n;
          const tabbable = value ? checked : n === 1;
          return (
            <button key={n} ref={el => (refs.current[n - 1] = el)} type="button" role="radio" aria-checked={checked}
              aria-label={n === 1 ? '1 star' : `${n} stars`} tabIndex={tabbable ? 0 : -1}
              onClick={() => onChange(n)} onKeyDown={e => move(e, n)}
              className="rounded-md p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Star className={cn('h-6 w-6', value && n <= value ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StarsView({ value }: { value: number }) {
  return (
    <span role="img" aria-label={`${value} out of 5`} className="inline-flex gap-0.5" dir="ltr">
      {[1, 2, 3, 4, 5].map(n => <Star key={n} className={cn('h-4 w-4', n <= value ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />)}
    </span>
  );
}

interface Props { ticketId: string; consultantId: string; clientId: string }

export default function RateClientCard({ ticketId, consultantId, clientId }: Props) {
  const qc = useQueryClient();
  const key = ['client-review', ticketId, consultantId];
  const { data: review, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('client_reviews')
        .select('id, score, communication_score, clarity_score, cooperation_score, would_work_again, comment, created_at')
        .eq('ticket_id', ticketId).eq('consultant_id', consultantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ClientReviewRow | null;
    },
  });

  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comm, setComm] = useState<number | null>(null);
  const [clarity, setClarity] = useState<number | null>(null);
  const [coop, setCoop] = useState<number | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing || !review) return;
    setScore(review.score); setComm(review.communication_score); setClarity(review.clarity_score);
    setCoop(review.cooperation_score); setAgain(review.would_work_again); setComment(review.comment ?? '');
  }, [editing, review]);

  if (isLoading) return null;

  const submit = async () => {
    if (!score) { setMissing(true); return; }
    setMissing(false);
    setSaving(true);
    const values = {
      score,
      communication_score: comm,
      clarity_score: clarity,
      cooperation_score: coop,
      would_work_again: again,
      comment: comment.trim() ? comment.trim() : null,
    };
    const q = (supabase as any).from('client_reviews');
    const { error } = review
      ? await q.update(values).eq('id', review.id)
      : await q.insert({ ticket_id: ticketId, consultant_id: consultantId, client_id: clientId, ...values });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Thank you. Your rating was saved.');
    setEditing(false);
    await qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['client-rating-summaries'] });
  };

  const showForm = !review || editing;

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Rate this client</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {showForm ? (
          <>
            <StarInput label="Overall" value={score} onChange={v => { setScore(v); setMissing(false); }} required />
            {missing && <p role="alert" className="text-xs text-destructive">Choose an overall score.</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <StarInput label="Communication" value={comm} onChange={setComm} />
              <StarInput label="Clarity of requirements" value={clarity} onChange={setClarity} />
              <StarInput label="Cooperation" value={coop} onChange={setCoop} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Would you work with this client again?</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={again === true ? 'default' : 'outline'} aria-pressed={again === true} onClick={() => setAgain(true)}>Yes</Button>
                <Button type="button" size="sm" variant={again === false ? 'default' : 'outline'} aria-pressed={again === false} onClick={() => setAgain(false)}>No</Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`client-review-comment-${ticketId}`}>Comment (optional)</Label>
              <Textarea id={`client-review-comment-${ticketId}`} value={comment} maxLength={MAX_COMMENT} rows={3}
                onChange={e => setComment(e.target.value.slice(0, MAX_COMMENT))} />
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>Do not write e-mail addresses, phone numbers or links: contact details are shared inside the portal.</span>
                <span dir="ltr">{comment.length}/{MAX_COMMENT}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={submit} disabled={saving}>Submit rating</Button>
              {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="text-muted-foreground">Overall</span><StarsView value={review.score} /></div>
            {([['Communication', review.communication_score], ['Clarity of requirements', review.clarity_score], ['Cooperation', review.cooperation_score]] as [string, number | null][])
              .filter(([, v]) => v !== null).map(([l, v]) => (
                <div key={l} className="flex items-center gap-2"><span className="text-muted-foreground">{l}</span><StarsView value={v as number} /></div>
              ))}
            {review.would_work_again !== null && <p><span className="text-muted-foreground">Would work again: </span><span>{review.would_work_again ? 'Yes' : 'No'}</span></p>}
            {review.comment && <p className="whitespace-pre-wrap text-foreground">{review.comment}</p>}
            {canEditReview(review.created_at)
              ? <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Edit rating</Button>
              : <p className="text-xs text-muted-foreground">Ratings can be edited for 7 days.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
