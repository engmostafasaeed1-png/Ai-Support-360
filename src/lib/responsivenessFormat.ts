import type { RespExclusion, RespLevel } from '../../supabase/functions/_shared/responsiveness';

/** Short duration for response times: "< 1 min", "45 min", "2 h 10 min", "1 d 3 h" (Arabic with ar). */
export function formatMinutes(m: number | null | undefined, ar = false): string {
  if (m == null || !Number.isFinite(m)) return '–';
  const v = Math.max(0, Math.round(m));
  const U = ar ? { min: 'د', h: 'س', d: 'ي', lt: 'أقل من دقيقة' } : { min: 'min', h: 'h', d: 'd', lt: '< 1 min' };
  if (v < 1) return U.lt;
  if (v < 60) return `${v} ${U.min}`;
  if (v < 1440) {
    const h = Math.floor(v / 60);
    const r = v % 60;
    return r ? `${h} ${U.h} ${r} ${U.min}` : `${h} ${U.h}`;
  }
  const d = Math.floor(v / 1440);
  const h = Math.round((v % 1440) / 60);
  return h ? `${d} ${U.d} ${h} ${U.h}` : `${d} ${U.d}`;
}

export const LEVEL_LABEL: Record<RespLevel, [string, string]> = {
  excellent: ['Excellent', 'ممتازة'],
  good: ['Good', 'جيدة'],
  fair: ['Fair', 'مقبولة'],
  needs_improvement: ['Needs improvement', 'تحتاج إلى تحسين'],
  new: ['New', 'جديد'],
};

/** Semantic token classes per level (no raw colours). */
export const LEVEL_TONE: Record<RespLevel, string> = {
  excellent: 'border-success/30 bg-success/10 text-success',
  good: 'border-info/30 bg-info/10 text-info',
  fair: 'border-warning/40 bg-warning/15 text-warning-foreground',
  needs_improvement: 'border-destructive/30 bg-destructive/10 text-destructive',
  new: 'border-border bg-muted text-muted-foreground',
};

export const EXCLUSION_LABEL: Record<RespExclusion, [string, string]> = {
  outside_hours: ['Not counted – outside your availability', 'غير محتسب – خارج أوقات توفرك'],
  unavailable_period: ['Not counted – during a period you marked unavailable', 'غير محتسب – خلال فترة حددتها كغير متاح'],
  busy: ['Not counted – you were marked busy', 'غير محتسب – كانت حالتك مشغول'],
  capacity: ['Not counted – you had reached your stated capacity', 'غير محتسب – وصلت إلى سعتك المعلنة'],
};
