import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseTerms, type PricingTerms } from '@/lib/pricing';

/**
 * The percentages of the price (platform service fee, payment processing fee, VAT) and two switches, from the database.
 * Public information: the pricing page uses it too, without a login. null while loading, or when a percentage is not set.
 */
export function usePricingTerms() {
  return useQuery({
    queryKey: ['pricing-terms'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PricingTerms | null> => {
      const { data, error } = await supabase.rpc('pricing_terms');
      if (error) return null;
      return parseTerms(data);
    },
  });
}
