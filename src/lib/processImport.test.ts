import { describe, it, expect } from 'vitest';
import { parseCsv, buildProcessRows, describeSkipped, filterNewNames, countDescendants } from './processImport';

const opts = {
  categories: ['General', 'Finance'],
  modules: ['SAP FI', 'SAP MM'],
  existingNames: new Set(['existing']),
};

describe('parseCsv', () => {
  it('reads quoted cells with commas, quotes and line breaks', () => {
    const records = parseCsv('name,description\n"Order to Cash","Sales, delivery and ""billing"""\n"Line\nbreak",x\n');
    expect(records.map((r) => r.cells)).toEqual([
      ['name', 'description'],
      ['Order to Cash', 'Sales, delivery and "billing"'],
      ['Line\nbreak', 'x'],
    ]);
    expect(records[2].line).toBe(3);
  });
  it('accepts a semicolon separator and a byte order mark', () => {
    const records = parseCsv(String.fromCharCode(0xfeff) + 'name;category\nA;Finance');
    expect(records.map((r) => r.cells)).toEqual([['name', 'category'], ['A', 'Finance']]);
  });
});

describe('buildProcessRows', () => {
  it('imports valid rows and reports the skipped ones with their line', () => {
    const csv = 'name,description,category,sap_module,owner\nOrder to Cash,"Sales, delivery",Finance,sap fi,Ann\nBad,,Unknown,,\nExisting,,,,\nOrder to Cash,,,,\n,,,,\n';
    const result = buildProcessRows(csv, opts);
    expect(result.fatal).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: 'Order to Cash',
      description: 'Sales, delivery',
      category: 'Finance',
      sap_module: 'SAP FI',
      process_owner: 'Ann',
    });
    expect(result.skipped.map((s) => s.line)).toEqual([3, 4, 5]);
    expect(result.skipped[0].reason).toContain('unknown category');
    expect(result.skipped[1].reason).toContain('already exists');
    expect(result.skipped[2].reason).toContain('repeated');
  });
  it('skips an unknown SAP module', () => {
    const result = buildProcessRows('name,sap_module\nA,SAP XX\n', opts);
    expect(result.rows).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('unknown SAP module');
  });
  it('needs a name column', () => {
    expect(buildProcessRows('foo,bar\n1,2\n', opts).fatal).toContain('name');
  });
  it('needs at least one row', () => {
    expect(buildProcessRows('name\n', opts).fatal).toContain('header');
  });
  it('does not take the owner column for the name', () => {
    const result = buildProcessRows('process_owner,name\nAnn,Order\n', opts);
    expect(result.rows[0].name).toBe('Order');
    expect(result.rows[0].process_owner).toBe('Ann');
  });
});

describe('describeSkipped', () => {
  it('lists the first rows and counts the rest', () => {
    const skipped = Array.from({ length: 6 }, (_, i) => ({ line: i + 2, reason: 'x' }));
    const text = describeSkipped(skipped);
    expect(text).toContain('line 2: x');
    expect(text).toContain('and 1 more');
  });
});

describe('filterNewNames', () => {
  it('drops existing and repeated names', () => {
    const result = filterNewNames([' A ', 'b', 'a', '', 'Existing'], new Set(['existing']));
    expect(result.names).toEqual(['A', 'b']);
    expect(result.skipped).toEqual(['a', 'Existing']);
  });
});

describe('countDescendants', () => {
  it('counts the processes below a process at all levels', () => {
    const processes = [
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'c', parent_id: 'b' },
      { id: 'd', parent_id: 'a' },
    ];
    expect(countDescendants('a', processes)).toBe(3);
    expect(countDescendants('b', processes)).toBe(1);
    expect(countDescendants('c', processes)).toBe(0);
  });
});
