import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/lib/withTimeout';

/** How long a screen waits for an AI answer before it stops the spinner and offers "Try again". */
export const AI_TIMEOUT_MS = 45_000;

/** supabase.functions.invoke that gives up after `ms`: a request that never gets an answer must not keep a spinner running for ever. */
export function invokeWithTimeout(
  functionName: string,
  options?: Parameters<typeof supabase.functions.invoke>[1],
  ms: number = AI_TIMEOUT_MS,
) {
  return withTimeout(supabase.functions.invoke(functionName, options), ms);
}
