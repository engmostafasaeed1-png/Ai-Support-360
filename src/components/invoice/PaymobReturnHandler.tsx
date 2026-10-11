import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * Paymob sends the browser back to /client/payments with the result in the address (a signature, the order, the amount ...).
 * Nothing in that address is believed: it is sent to the server, which checks Paymob's signature before it books anything.
 * The same payment also arrives from Paymob's server; whichever comes first is applied, the other one changes nothing.
 */
export function PaymobReturnHandler() {
  const queryClient = useQueryClient();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const search = new URLSearchParams(window.location.search);
    if (!search.has('hmac') || !(search.has('order') || search.has('order_id'))) return;
    handled.current = true;

    const params: Record<string, string> = {};
    search.forEach((value, key) => {
      params[key] = value;
    });
    // a reload must not send the same result again
    window.history.replaceState({}, '', window.location.pathname);

    void (async () => {
      const { data, error } = await supabase.functions.invoke('paymob-create-payment', { body: { action: 'confirm', params } });
      queryClient.invalidateQueries({ queryKey: ['client-payments'] });
      if (error) {
        toast.error('We could not confirm your card payment yet', {
          description: 'If your card was charged, the invoice is updated as soon as the payment provider confirms it.',
        });
      } else if (data?.state === 'paid') {
        toast.success('Payment received. Thank you!');
      } else if (data?.state === 'failed') {
        toast.error('The card payment was not completed', { description: 'Your card was not charged. You can try again.' });
      } else {
        toast.info('Your payment is being processed. This page updates when it is confirmed.');
      }
      // the confirmation from the payment provider may still be on its way
      window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ['client-payments'] }), 5000);
    })();
  }, [queryClient]);

  return null;
}
