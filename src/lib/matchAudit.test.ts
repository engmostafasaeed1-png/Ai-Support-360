// Feature H, part 1: the matching audit. Runs the CURRENT deterministic matching path and the NEW matcher on synthetic tickets and consultants.
// Set MATCH_AUDIT=1 to print the top 5 of every ticket. Fixture data only; nothing here reads production data.
import { describe, expect, it } from 'vitest';
import { weightedMatch } from '../../supabase/functions/_shared/matchScoring';
import { contextFit } from '../../supabase/functions/_shared/contextFit';
import { rankConsultants } from '../../supabase/functions/_shared/ticketMatch';
import { FIXTURE_CONSULTANTS, FIXTURE_TICKETS, type FixtureTicket } from '@/test/fixtures/matchFixtures';

const label = (id: string) => FIXTURE_CONSULTANTS.find(c => c.id === id)?.label ?? id;

/** The current server ranking without the AI model: verified only, then the context-fit share of weightedMatch (the 8 other sub-scores come only from the model). */
function currentBaseline(t: FixtureTicket) {
  return FIXTURE_CONSULTANTS
    .filter(c => c.verification_status === 'verified')
    .map(c => ({ id: c.id, score: weightedMatch({ context_fit_score: contextFit(t, c).score ?? undefined }).match_score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

describe('matching audit (fixtures)', () => {
  it('prints the top 5 per ticket for the report', () => {
    if (!process.env.MATCH_AUDIT) return;
    for (const t of FIXTURE_TICKETS) {
      const now = currentBaseline(t).slice(0, 5);
      const next = rankConsultants(t, FIXTURE_CONSULTANTS);
      console.log(`\n### ${t.name}`);
      console.log(`current: ${now.map(r => `${r.id} ${r.score}`).join(' | ')}`);
      console.log(`new:     ${next.ranked.slice(0, 5).map(r => `${r.consultant_id} ${r.score} [${r.chips.map(c => c.text).join(', ')}]`).join(' | ')}`);
      console.log(`excluded: ${next.excluded.map(e => `${e.consultant_id}:${e.reason}`).join(' ')}; questions: ${next.questions.join(',') || '-'}; modules: ${next.signals.modules.join(',')}`);
    }
    expect(true).toBe(true);
  });

  it('root cause: without the AI model the current ranking ignores modules and description (all tie when no context is stated)', () => {
    const abap = FIXTURE_TICKETS.find(t => t.name === 'ABAP Fiori extension')!;
    const scores = new Set(currentBaseline(abap).map(r => r.score));
    expect(scores.size).toBe(1);
  });

  it('root cause: the current candidate list keeps offline consultants for critical tickets and disabled accounts', () => {
    const critical = FIXTURE_TICKETS.find(t => t.urgency === 'critical')!;
    const ids = currentBaseline(critical).map(r => r.id);
    expect(ids).toContain('c07');
    expect(ids).toContain('c14');
  });

  it('root cause: a wrong-module consultant ranks first in the current baseline when only the country is stated', () => {
    const mm = FIXTURE_TICKETS.find(t => t.name.startsWith('MM purchasing'))!;
    const top = currentBaseline(mm)[0].id;
    expect(label(top)).not.toMatch(/MM/);
  });
});
