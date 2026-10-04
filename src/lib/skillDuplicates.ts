// The skills of a consultant that are listed more than once (the same SAP module again) or that are empty (no module).
// Running the onboarding more than once used to add every skill again, and an empty form row used to be saved as an empty skill.

import { skillKey } from './onboardingDedupe';

export interface SkillRow {
  id: string;
  module: string;
  proficiency: number;
  years: number;
  certified: boolean;
}

/** True when `candidate` is better than `current`: certified first, then the higher level, then more years. At a tie the one that came first stays. */
function isBetter(candidate: SkillRow, current: SkillRow): boolean {
  if (candidate.certified !== current.certified) return candidate.certified;
  if (candidate.proficiency !== current.proficiency) return candidate.proficiency > current.proficiency;
  return candidate.years > current.years;
}

/**
 * The ids of the rows to remove: every row without a module, and, for each SAP module that is listed more than once,
 * all rows but the best one. The same module in other capitals or with spaces around it is the same module.
 */
export function duplicateSkillIds(rows: SkillRow[]): string[] {
  const remove: string[] = [];
  const groups = new Map<string, SkillRow[]>();
  for (const row of rows) {
    const key = skillKey(row.module);
    if (!key) {
      remove.push(row.id);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const best = group.reduce((current, candidate) => (isBetter(candidate, current) ? candidate : current));
    for (const row of group) {
      if (row !== best) remove.push(row.id);
    }
  }
  return remove;
}
