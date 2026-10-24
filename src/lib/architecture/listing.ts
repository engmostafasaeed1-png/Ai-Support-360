// Filters, search and sort for the Blueprints / Design documents tabs, the linked-documents view of Ticket
// references, and timeline grouping. Pure, unit-tested.
import { BLUEPRINT_TYPES, TYPE_TITLES, type ArchStatus, type ArchType } from '../../../supabase/functions/_shared/archModel';
import type { ArchListRow, ArchTimelineRow } from './api';

export type ArchGroup = 'blueprints' | 'design';
export type ArchSort = 'updated' | 'created' | 'title' | 'status';
export interface ArchFilters { type: ArchType | 'all'; module: string | 'all'; status: ArchStatus | 'all'; ticket: string | 'all'; search: string; sort: ArchSort }
export const DEFAULT_FILTERS: ArchFilters = { type: 'all', module: 'all', status: 'all', ticket: 'all', search: '', sort: 'updated' };

export const inGroup = (row: Pick<ArchListRow, 'type'>, group: ArchGroup) =>
  group === 'blueprints' ? BLUEPRINT_TYPES.includes(row.type) : !BLUEPRINT_TYPES.includes(row.type);

const STATUS_ORDER: ArchStatus[] = ['in_review', 'draft', 'approved', 'superseded', 'archived'];

export function filterDocs(rows: readonly ArchListRow[], group: ArchGroup, f: ArchFilters): ArchListRow[] {
  const q = f.search.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (!inGroup(r, group)) return false;
    if (f.type !== 'all' && r.type !== f.type) return false;
    if (f.module !== 'all' && r.sap_module !== f.module && r.sap_area !== f.module) return false;
    if (f.status !== 'all' && r.status !== f.status) return false;
    if (f.ticket !== 'all' && !r.links.some((l) => l.ticket_id === f.ticket)) return false;
    if (q) {
      const hay = [r.title, r.sap_area, r.sap_module, r.sap_version, r.owner_name, TYPE_TITLES[r.type].en, ...r.links.map((l) => `${l.ref} ${l.title}`)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by: Record<ArchSort, (a: ArchListRow, b: ArchListRow) => number> = {
    updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
    created: (a, b) => b.created_at.localeCompare(a.created_at),
    title: (a, b) => a.title.localeCompare(b.title),
    status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.updated_at.localeCompare(a.updated_at),
  };
  return out.sort(by[f.sort]);
}

/** Module values that appear in the list (for the filter). */
export function moduleOptions(rows: readonly ArchListRow[]): string[] {
  return Array.from(new Set(rows.flatMap((r) => [r.sap_module, r.sap_area]).filter(Boolean))).sort();
}

/** ticket id -> documents linked to it (Ticket references tab). */
export function docsByTicket(rows: readonly ArchListRow[]): Map<string, ArchListRow[]> {
  const m = new Map<string, ArchListRow[]>();
  for (const r of rows) for (const l of r.links) m.set(l.ticket_id, [...(m.get(l.ticket_id) ?? []), r]);
  return m;
}

/** Timeline rows grouped per day (newest first). */
export function groupByDay(rows: readonly ArchTimelineRow[]): Array<{ day: string; rows: ArchTimelineRow[] }> {
  const m = new Map<string, ArchTimelineRow[]>();
  for (const r of [...rows].sort((a, b) => b.at.localeCompare(a.at))) {
    const d = r.at.slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), r]);
  }
  return Array.from(m, ([day, list]) => ({ day, rows: list }));
}
