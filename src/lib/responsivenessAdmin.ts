import type { AdminResponsivenessRow } from '@/hooks/useResponsiveness';
import { LEVEL_ORDER, type RespLevel } from '../../supabase/functions/_shared/responsiveness';

export type RespSortKey = 'name' | 'public_level' | 'rate_90d' | 'median_90d' | 'counted_90d' | 'no_response_30d' | 'warnings_sent' | 'disputes_open';

/** Sort for the admin table; empty values always go last. */
export function sortResponsivenessRows(rows: AdminResponsivenessRow[], key: RespSortKey, asc: boolean): AdminResponsivenessRow[] {
  const val = (r: AdminResponsivenessRow): string | number | null =>
    key === 'name' ? (r.name ?? '').toLowerCase() || null
      : key === 'public_level' ? LEVEL_ORDER.indexOf(r.public_level)
        : (r[key] as number | null);
  return [...rows].sort((a, b) => {
    const x = val(a); const y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return asc ? c : -c;
  });
}

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote, double quotes, and neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function responsivenessCsv(rows: AdminResponsivenessRow[]): string {
  const head = ['consultant_id', 'name', 'level', 'public_level', 'counted_90d', 'rate_90d', 'median_minutes_90d', 'no_response_30d', 'warnings_sent_90d', 'disputes_open', 'disputes_total', 'computed_at'];
  const lines = rows.map((r) => [r.consultant_id, r.name, r.level, r.public_level, r.counted_90d, r.rate_90d, r.median_90d, r.no_response_30d, r.warnings_sent, r.disputes_open, r.disputes_total, r.computed_at].map(cell).join(','));
  return '\uFEFF' + [head.map(cell).join(','), ...lines].join('\r\n');
}

export interface RespSummary {
  total: number;
  /** Consultants past the minimum sample (level other than "new"). */
  rated: number;
  /** Share of all counted requests that were answered (weighted by counted requests); null when nothing was counted. */
  overallRate: number | null;
  noResponses30d: number;
  disputesOpen: number;
  byLevel: Record<RespLevel, number>;
}

/** Page header figures for the admin overview; display only, computed from the overview rows. */
export function responsivenessSummary(rows: AdminResponsivenessRow[]): RespSummary {
  const byLevel = Object.fromEntries(LEVEL_ORDER.map((l) => [l, 0])) as Record<RespLevel, number>;
  let weighted = 0; let counted = 0; let noResp = 0; let open = 0;
  for (const r of rows) {
    byLevel[r.public_level] = (byLevel[r.public_level] ?? 0) + 1;
    if (r.rate_90d != null && r.counted_90d > 0) { weighted += r.rate_90d * r.counted_90d; counted += r.counted_90d; }
    noResp += r.no_response_30d;
    open += r.disputes_open;
  }
  return {
    total: rows.length,
    rated: rows.length - byLevel.new,
    overallRate: counted > 0 ? Math.round(weighted / counted) : null,
    noResponses30d: noResp,
    disputesOpen: open,
    byLevel,
  };
}
