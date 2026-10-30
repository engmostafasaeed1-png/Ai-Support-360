/** Groups notifications by local day (newest first): "today", "yesterday" or the date. Pure, tested. */
export interface DayGroup<T> { key: string; label: 'today' | 'yesterday' | 'date'; items: T[] }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dayGroups<T extends { created_at: string }>(items: T[], now: Date): DayGroup<T>[] {
  const today = dayKey(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = dayKey(new Date(it.created_at));
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({ key, label: key === today ? 'today' : key === yesterday ? 'yesterday' : 'date', items: list }));
}
