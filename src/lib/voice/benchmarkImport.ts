// Turns the offline benchmark output (scripts/voice-benchmark/run.ts → results.csv) into the frozen test set for the
// voice learning gate (admin_voice_benchmark_import). Text only: the owner's recordings never leave their computer.

export interface BenchmarkItem { id: string; category: string; lang: string; reference: string; raws: Record<string, string> }

/** Minimal CSV reader for the benchmark file (double-quoted fields, "" escapes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** One item per sentence with the raw text of each model (first successful run per model wins). */
export function benchmarkItemsFromCsv(text: string, allowedModels: readonly string[]): BenchmarkItem[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const col = (name: string) => head.indexOf(name);
  const need = ['id', 'reference', 'raw', 'variant', 'ok'].map(col);
  if (need.some((i) => i < 0)) return [];
  const [iId, iRef, iRaw, iVariant, iOk] = need;
  const iCat = col('category'), iLang = col('lang');
  const byId = new Map<string, BenchmarkItem>();
  for (const r of rows) {
    if (String(r[iOk]).toLowerCase() !== 'true') continue;
    const model = r[iVariant];
    if (!allowedModels.includes(model)) continue;
    const id = r[iId];
    const item = byId.get(id) ?? { id, category: iCat >= 0 ? r[iCat] : '', lang: iLang >= 0 ? r[iLang] : '', reference: r[iRef], raws: {} };
    if (!(model in item.raws)) item.raws[model] = r[iRaw] ?? '';
    byId.set(id, item);
  }
  return [...byId.values()].filter((i) => i.reference.trim() && Object.keys(i.raws).length).slice(0, 500);
}
