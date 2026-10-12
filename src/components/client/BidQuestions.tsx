import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAnswerQuestion, useHideQuestion, type ClientQuestion } from '@/hooks/useClientBids';
import { contactHelp } from '@/lib/clientBidding';
import { toast } from 'sonner';
function Question({ question: q, readOnly }: { question: ClientQuestion; readOnly: boolean }) {
  const [answer, setAnswer] = useState('');
  const respond = useAnswerQuestion();
  const hide = useHideQuestion();
  return <article className="border-b border-border py-4 space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium">A consultant</span><time className="text-xs text-muted-foreground">{new Date(q.created_at).toLocaleString()}</time></div>
    <p className="text-sm whitespace-pre-wrap break-words">{q.question}</p>
    {q.hidden && <p className="text-xs text-warning">Hidden from consultants</p>}
    {q.answer ? <p className="text-sm bg-muted/40 p-3 whitespace-pre-wrap break-words">{q.answer}</p> : !readOnly && <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (!answer.trim()) return; respond.mutate({ id: q.id, answer }, { onSuccess: () => setAnswer(''), onError: (e: any) => toast.error(e.message) }); }}>
      <Textarea aria-label="Answer" maxLength={1000} value={answer} onChange={e => setAnswer(e.target.value)} />
      <p className="text-xs text-muted-foreground">{contactHelp}</p>
      <p className="text-xs text-muted-foreground">Your answer is shown to all consultants who can bid, without your name.</p>
      <Button size="sm" type="submit" disabled={respond.isPending || !answer.trim()}>Answer</Button>
    </form>}
    {!readOnly && <Button variant="link" size="sm" disabled={hide.isPending} onClick={() => hide.mutate({ id: q.id, hidden: !q.hidden }, { onError: (e: any) => toast.error(e.message) })}>{q.hidden ? 'Show' : 'Hide'}</Button>}
  </article>;
}
export default function BidQuestions({ questions, readOnly = false }: { questions: ClientQuestion[]; readOnly?: boolean }) {
  return <section><h3 className="font-semibold">Questions from consultants</h3>{questions.map(q => <Question key={q.id} question={q} readOnly={readOnly} />)}</section>;
}
