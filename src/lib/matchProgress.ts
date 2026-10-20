import { MODULE_BY_CODE, extractTicketSignals, type MatchTicket } from '../../supabase/functions/_shared/ticketMatch';
import { makeSteps, setStep, type ProgressStep } from '@/lib/progressSteps';

export const MATCH_STEP_LABELS = {
  understand: 'Understanding your request',
  rank: 'Reading consultant profiles and ranking the best experts',
} as const;

/**
 * What the matcher reads in the request (SAP areas, transaction codes, error codes, country, deployment).
 * This runs in the browser with the same rules the server uses, so the line is true and instant.
 */
export function understoodSummary(ticket: MatchTicket): string {
  const s = extractTicketSignals(ticket);
  const terms = [
    ...s.modules.map((c) => MODULE_BY_CODE.get(c)?.label ?? c),
    ...s.tcodes.map((x) => x.code),
    ...s.errors.map((x) => x.code),
    ...(s.country ? [s.country] : []),
    ...(s.deployment ? [s.deployment] : []),
  ];
  const unique = [...new Set(terms)].slice(0, 5);
  return unique.length ? `We understood: ${unique.join(' · ')}` : 'No SAP area or error code found yet';
}

export type MatchPhase = 'ranking' | 'done' | 'error';

/** The two real steps of a match run: the browser reads the request, then one server call reads the profiles and ranks. */
export function matchSteps(phase: MatchPhase, understood?: string, found?: number): ProgressStep[] {
  let steps = makeSteps([
    { key: 'understand', label: MATCH_STEP_LABELS.understand },
    { key: 'rank', label: MATCH_STEP_LABELS.rank, open: true },
  ]);
  steps = setStep(steps, 'understand', 'done', understood);
  if (phase === 'ranking') return setStep(steps, 'rank', 'active');
  if (phase === 'error') return setStep(steps, 'rank', 'error');
  return setStep(steps, 'rank', 'done', found === undefined ? undefined : found === 1 ? '1 expert found' : `${found} experts found`);
}
