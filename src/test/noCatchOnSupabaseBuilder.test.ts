import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * supabase.rpc()/from() return query builders that can be awaited but have NO .catch(). Chaining .catch() on one
 * throws "catch is not a function" at runtime (this crashed /signup?ref=... on the live site). Use await inside
 * try/catch, safeRpc() from lib/safeRpc, or .then(undefined, handler) instead. ESLint has the same rule.
 */
const BUILDER_METHODS = new Set([
  'rpc', 'from', 'schema', 'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in',
  'is', 'like', 'ilike', 'contains', 'containedBy', 'overlaps', 'textSearch', 'order', 'limit', 'range', 'single',
  'maybeSingle', 'match', 'filter', 'not', 'or', 'returns', 'csv', 'throwOnError', 'abortSignal',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Name of the method called right before `.catch(` (e.g. "rpc" for `x.rpc(a).catch(`), or null. */
export function methodBeforeCatch(src: string, catchAt: number): string | null {
  let i = catchAt - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (src[i] !== ')') return null;
  let depth = 0;
  for (; i >= 0; i--) {
    if (src[i] === ')') depth++;
    else if (src[i] === '(') { depth--; if (depth === 0) break; }
  }
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  const m = /([A-Za-z_$][\w$]*)$/.exec(src.slice(Math.max(0, j - 60), j + 1));
  if (!m) return null;
  const before = src.slice(0, j + 1 - m[1].length).trimEnd();
  return before.endsWith('.') ? m[1] : null;
}

export function findBuilderCatches(src: string): number[] {
  const hits: number[] = [];
  for (const m of src.matchAll(/\.catch\s*\(/g)) {
    const name = methodBeforeCatch(src, m.index ?? 0);
    if (name && BUILDER_METHODS.has(name)) hits.push(src.slice(0, m.index).split('\n').length);
  }
  return hits;
}

describe('no .catch() chained on a database query builder', () => {
  it('detects the pattern that crashed sign-up', () => {
    expect(findBuilderCatches("void supabase.rpc('referral_track_click', { _code: c }).catch(() => undefined);")).toEqual([1]);
    expect(findBuilderCatches("supabase.from('t')\n  .update({ a: 1 })\n  .eq('id', x)\n  .catch(() => {});")).toEqual([4]);
    expect(findBuilderCatches("safeRpc('f', {}).catch(() => {}); Promise.resolve(supabase.rpc('f')).catch(() => {});")).toEqual([]);
    expect(findBuilderCatches("supabase.rpc('f').then(undefined, () => {}); supabase.functions.invoke('x').catch(() => {});")).toEqual([]);
  });

  it('is absent from the whole app', () => {
    const offenders = files('src').flatMap((f) => findBuilderCatches(readFileSync(f, 'utf8')).map((line) => `${f}:${line}`));
    expect(offenders).toEqual([]);
  });
});
