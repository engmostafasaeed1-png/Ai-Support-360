import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import ClientRatingChip from '@/components/consultant/ClientRatingChip';
import type { ClientRatingSummary } from '@/hooks/useClientRatings';
import { useAskQuestion, useTicketQuestions } from '@/hooks/useBidding';
import { useNow } from '@/hooks/useCriticalService';
import { bidCountdown, bidsSoFar, questionProblem, QUESTION_MAX, ticketAreas, toneClass } from '@/lib/bidding';

export interface OpenRequest {
  id: string;
  title: string;
  description?: string | null;
  sap_module?: string | null;
  sap_modules?: string[] | null;
  client_id?: string | null;
  open_for_bids?: boolean | null;
  bid_deadline?: string | null;
}

interface Props {
  request: OpenRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bidCount?: number;
  ratingSummary?: ClientRatingSummary | null;
  /** The bid buttons (Place a bid / Revise bid / View my bid), shown while bidding is open. */
  actions?: ReactNode;
}

export function QuestionForm({ ticketId }: { ticketId: string }) {
  const ask = useAskQuestion();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const send = () => {
    const p = questionProblem(text);
    setProblem(p);
    if (p) return;
    ask.mutate({ ticketId, question: text }, {
      onSuccess: () => { toast.success('Your question was sent to the client.'); setText(''); },
      onError: (e: any) => toast.error(e?.message || 'Your question could not be sent.'),
    });
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`ask-${ticketId}`}>Ask the client a question</Label>
      <Textarea id={`ask-${ticketId}`} value={text} maxLength={QUESTION_MAX} rows={3}
        onChange={e => { setText(e.target.value.slice(0, QUESTION_MAX)); setProblem(null); }} />
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>Do not write e-mail addresses, phone numbers or links: contact details are shared inside the portal.</span>
        <span dir="ltr">{text.length}/{QUESTION_MAX}</span>
      </div>
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
      <Button type="button" size="sm" onClick={send} disabled={ask.isPending}>Send question</Button>
    </div>
  );
}

export default function OpenRequestPanel({ request, open, onOpenChange, bidCount, ratingSummary, actions }: Props) {
  const now = useNow(open ? 30_000 : 0);
  const { data: questions } = useTicketQuestions(open ? request?.id : undefined);
  if (!request) return null;
  const cd = bidCountdown(request.bid_deadline, now, request.open_for_bids !== false || !request.bid_deadline);
  const closed = cd.closed;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-2 text-start">
          <SheetTitle>{request.title}</SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">{ticketAreas(request).map(a => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)}</div>
              {request.client_id && <ClientRatingChip clientId={request.client_id} summary={ratingSummary} />}
              <div className="flex flex-wrap gap-x-3 text-xs">
                <span className={toneClass[cd.tone]} title={request.bid_deadline ? new Date(request.bid_deadline).toLocaleString() : undefined} data-testid="panel-deadline">{cd.text}</span>
                <span className="text-muted-foreground">{bidsSoFar(bidCount)}</span>
              </div>
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6 text-sm">
          <section className="space-y-1">
            <h3 className="font-semibold text-foreground">Description</h3>
            <p className="whitespace-pre-wrap text-muted-foreground">{request.description || '—'}</p>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold text-foreground">Questions and answers</h3>
            {(questions?.answered.length ?? 0) === 0 && (questions?.waiting.length ?? 0) === 0 && (
              <p className="text-xs text-muted-foreground">No questions yet.</p>
            )}
            {questions?.answered.map(q => (
              <div key={q.id} className="rounded-xl border border-border/50 p-3" data-testid="answered-question">
                <p className="font-medium text-foreground">{q.question}</p>
                <p className="mt-1 text-muted-foreground">{q.answer}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{format(new Date(q.answered_at || q.created_at), 'PP')}</p>
              </div>
            ))}
            {questions?.waiting.map(q => (
              <div key={q.id} className="rounded-xl border border-dashed border-border p-3">
                <p className="text-foreground">{q.question}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Waiting for the client's answer</p>
              </div>
            ))}
            {!closed && <QuestionForm ticketId={request.id} />}
          </section>

          <div className="border-t border-border/50 pt-4">
            {closed ? <p className="text-sm text-muted-foreground">Bidding is closed.</p> : <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
