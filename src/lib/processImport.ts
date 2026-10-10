/** Reading a process list from a CSV file, and the checks that go with it. */

const BOM = String.fromCharCode(0xfeff);

export interface CsvRecord {
  /** The line of the file where the record starts (the header is line 1). */
  line: number;
  cells: string[];
}

function detectSeparator(text: string): string {
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  for (const ch of text) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      break;
    } else if (!inQuotes && ch === ',') {
      commas += 1;
    } else if (!inQuotes && ch === ';') {
      semicolons += 1;
    }
  }
  return semicolons > 0 && commas === 0 ? ';' : ',';
}

/**
 * Splits CSV text into records. A cell in quotes may contain separators, line breaks and doubled quotes ("").
 * The separator is a comma, or a semicolon when the first line has semicolons and no commas outside quotes.
 */
export function parseCsv(input: string): CsvRecord[] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const sep = detectSeparator(text);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let startLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    records.push({ line: startLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === sep) {
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      startLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRecord();
  return records.map((r) => ({ ...r, cells: r.cells.map((c) => c.trim()) }));
}

export interface ProcessImportRow {
  line: number;
  name: string;
  description: string | null;
  category: string;
  sap_module: string | null;
  process_owner: string | null;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

export interface ProcessImportResult {
  rows: ProcessImportRow[];
  skipped: SkippedRow[];
  /** Set when the file cannot be used at all. */
  fatal?: string;
}

export interface ProcessImportOptions {
  categories: string[];
  modules: string[];
  /** Names (lower case) of the processes that already exist under the same parent. */
  existingNames: Set<string>;
}

const norm = (s: string) => s.trim().toLowerCase();
const canonical = (value: string, list: string[]) => list.find((x) => norm(x) === norm(value));

function findColumn(headers: string[], exact: string[], partial: string[]): number {
  const found = headers.findIndex((h) => exact.includes(h));
  if (found >= 0) return found;
  return headers.findIndex((h) => partial.some((p) => h.includes(p)) && !h.includes('owner'));
}

/** Turns the text of a CSV file into the processes to add and the rows that have to be skipped (with the line and the reason). */
export function buildProcessRows(text: string, opts: ProcessImportOptions): ProcessImportResult {
  const records = parseCsv(text).filter((r) => r.cells.some((c) => c !== ''));
  if (records.length < 2) {
    return { rows: [], skipped: [], fatal: 'The file needs a header line and at least one process.' };
  }
  const headers = records[0].cells.map(norm);
  const nameIdx = findColumn(headers, ['name', 'process', 'process name', 'process_name'], ['name', 'process']);
  if (nameIdx < 0) {
    return { rows: [], skipped: [], fatal: 'The first line of the file needs a "name" column.' };
  }
  const descIdx = findColumn(headers, ['description', 'desc'], ['desc']);
  const catIdx = findColumn(headers, ['category'], ['categ']);
  const modIdx = findColumn(headers, ['sap_module', 'sap module', 'module', 'sap'], ['module', 'sap']);
  const ownerIdx = headers.findIndex((h) => ['owner', 'process_owner', 'process owner'].includes(h) || h.includes('owner'));

  const seenInFile = new Set<string>();
  const rows: ProcessImportRow[] = [];
  const skipped: SkippedRow[] = [];

  for (const record of records.slice(1)) {
    const cell = (idx: number) => (idx >= 0 ? record.cells[idx] ?? '' : '');
    const name = cell(nameIdx).replace(/\s+/g, ' ').trim();
    if (!name) {
      skipped.push({ line: record.line, reason: 'the name is empty' });
      continue;
    }
    if (name.length > 200) {
      skipped.push({ line: record.line, reason: 'the name is longer than 200 characters' });
      continue;
    }
    let category = 'General';
    const rawCategory = cell(catIdx);
    if (rawCategory) {
      const found = canonical(rawCategory, opts.categories);
      if (!found) {
        skipped.push({ line: record.line, reason: `unknown category "${rawCategory}"` });
        continue;
      }
      category = found;
    }
    let sapModule: string | null = null;
    const rawModule = cell(modIdx);
    if (rawModule) {
      const found = canonical(rawModule, opts.modules);
      if (!found) {
        skipped.push({ line: record.line, reason: `unknown SAP module "${rawModule}"` });
        continue;
      }
      sapModule = found;
    }
    const key = norm(name);
    if (opts.existingNames.has(key)) {
      skipped.push({ line: record.line, reason: `"${name}" already exists here` });
      continue;
    }
    if (seenInFile.has(key)) {
      skipped.push({ line: record.line, reason: `"${name}" is repeated in the file` });
      continue;
    }
    seenInFile.add(key);
    rows.push({
      line: record.line,
      name,
      description: cell(descIdx) || null,
      category,
      sap_module: sapModule,
      process_owner: cell(ownerIdx) || null,
    });
  }
  return { rows, skipped };
}

/** The first skipped rows as one sentence, for a message to the user. */
export function describeSkipped(skipped: SkippedRow[], max = 5): string {
  const shown = skipped.slice(0, max).map((s) => `line ${s.line}: ${s.reason}`).join('; ');
  return skipped.length > max ? `${shown}; and ${skipped.length - max} more` : shown;
}

/** Splits typed names into the new ones and the ones that exist already (or repeat inside the list). */
export function filterNewNames(names: string[], existingNames: Set<string>): { names: string[]; skipped: string[] } {
  const seen = new Set(existingNames);
  const fresh: string[] = [];
  const skipped: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (seen.has(norm(name))) {
      skipped.push(name);
      continue;
    }
    seen.add(norm(name));
    fresh.push(name);
  }
  return { names: fresh, skipped };
}

/** The number of processes below a process, at all levels. */
export function countDescendants(id: string, processes: { id: string; parent_id: string | null }[]): number {
  const childrenOf = new Map<string, string[]>();
  for (const p of processes) {
    if (!p.parent_id) continue;
    const list = childrenOf.get(p.parent_id) ?? [];
    list.push(p.id);
    childrenOf.set(p.parent_id, list);
  }
  const seen = new Set<string>([id]);
  const queue = [id];
  let count = 0;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      count += 1;
      queue.push(child);
    }
  }
  return count;
}
