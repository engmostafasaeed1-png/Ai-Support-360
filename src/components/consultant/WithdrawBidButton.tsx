import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useWithdrawBid } from '@/hooks/useBidding';

export default function WithdrawBidButton({ bidId }: { bidId: string }) {
  const withdraw = useWithdrawBid();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">Withdraw bid</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw this bid? The client will be told.</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => withdraw.mutate(bidId, {
            onSuccess: () => toast.success('Bid withdrawn.'),
            onError: (e: any) => toast.error(e?.message || 'The bid could not be withdrawn.'),
          })}>Withdraw bid</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
