// Browser side of the consultant role catalogue: the rules live in supabase/functions/_shared/consultantRoles.ts.
export * from '../../supabase/functions/_shared/consultantRoles';
import { roleKeyFor, type RoleEntry } from '../../supabase/functions/_shared/consultantRoles';

/** Main-role keys the database accepted before docs/sql/consultant-roles.sql (its old fixed check). */
export const LEGACY_PRIMARY_KEYS = ['functional', 'technical', 'techno_functional', 'architect', 'basis', 'project_manager', 'integration', 'data_analytics'] as const;
const NEW_TO_LEGACY: Record<string, string> = { solution_architect: 'architect', enterprise_architect: 'architect', technical_architect: 'architect', program_manager: 'project_manager', delivery_manager: 'project_manager' };

/** The main-role value to store: any catalogue key once the catalogue exists, else the closest old key (or null). */
export function primaryToStore(primary: string | null, catalogApplied: boolean, catalog?: RoleEntry[]): string | null {
  const key = primary ? roleKeyFor(primary, catalog) ?? (catalogApplied ? 'other' : null) : null;
  if (!key || catalogApplied) return key;
  if ((LEGACY_PRIMARY_KEYS as readonly string[]).includes(key)) return key;
  return NEW_TO_LEGACY[key] ?? null;
}
