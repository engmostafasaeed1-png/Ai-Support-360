import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRespondToCounter, type CounterRow } from '@/hooks/useBidding';

interface Props {
  counter: CounterRow;
  bid: { proposed_rate: number; estimated_hours: number; timeline_days: number | null };
  /** The version of the bid that was created when the consultant accepted (for the muted line). */
  newVersion?: number | null;
  money?: (n: number) => string;
}

const terms = (rate: number, hours: number, days: number | null | undefined, money: (n: number) => string) =>
  `${money(rate)}/hr · ${hours} h${days !== null && days !== undefined ? ` · ${days} days` : ''}`;

export default function CounterOfferBanner({ counter, bid, newVersion, money = n => `$${n}` }: Props) {
  const respond = useRespondToCounter();
  if (counter.status === 'accepted') {
    return <p className="text-xs text-muted-foreground">{`You accepted the client's counter-offer (new bid v${newVersion ?? '?'})`}</p>;
  }
  if (counter.status === 'declined') {
    return <p className="text-xs text-muted-foreground">You declined the client's counter-offer</p>;
  }
  if (counter.status !== 'pending') return null;
  const answer = (accept: boolean) => respond.mutate({ counterId: counter.id, accept }, {
    onSuccess: () => toast.success(accept ? 'Counter-offer accepted. A new bid with these terms was sent to the client.' : 'Counter-offer declined.'),
    onError: (e: any) => toast.error(e?.message || 'Your answer could not be saved.'),
  });
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" data-testid="counter-offer">
      <p className="font-semibold">The client sent a counter-offer</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span dir="ltr">{terms(Number(counter.proposed_rate), Number(counter.estimated_hours), counter.timeline_days, money)}</span>
        <span className="opacity-80"><span>Your bid: </span><span dir="ltr">{terms(Number(bid.proposed_rate), Number(bid.estimated_hours), bid.timeline_days, money)}</span></span>
      </div>
      {counter.message && <p className="whitespace-pre-wrap text-xs">{counter.message}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => answer(true)} disabled={respond.isPending}>Accept counter-offer</Button>
        <Button size="sm" variant="outline" onClick={() => answer(false)} disabled={respond.isPending}>Decline</Button>
      </div>
    </div>
  );
}
