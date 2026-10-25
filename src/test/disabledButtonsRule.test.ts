/**
 * Owner rule (Oct 25): every dimmed button says WHY and WHAT to do next.
 *
 * A <Button>, <button> or <AlertDialogAction> may not carry `disabled={...}` unless it ALSO gives a `reason`
 * (src/lib/blockedReasons.ts) or the tag carries an explicit opt-out comment `/* disabled-ok: <why> *\/` (for example a
 * pass-through wrapper or a purely decorative state). Loading states use `busy` instead of `disabled`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const TAGS = new Set(['Button', 'button', 'AlertDialogAction']);

function files(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith('.tsx') && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

export function violations(file: string, src = fs.readFileSync(file, 'utf8')): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && TAGS.has(n.tagName.getText(sf))) {
      const names = n.attributes.properties.map((a) => (ts.isJsxAttribute(a) ? a.name.getText(sf) : '...'));
      if (names.includes('disabled') && !names.includes('reason')) {
        const tagText = src.slice(n.getStart(sf), n.attributes.getEnd());
        if (!/disabled-ok:\s*[^*\s]/.test(tagText)) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          out.push(`${path.relative(ROOT, file)}:${line}`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('disabled buttons always explain themselves', () => {
  it('the guard catches a bare disabled and accepts reason / opt-out', () => {
    const f = path.join(ROOT, 'x.tsx');
    expect(violations(f, 'const a = <Button disabled={!x}>Save</Button>;')).toHaveLength(1);
    expect(violations(f, 'const a = <button disabled>Save</button>;')).toHaveLength(1);
    expect(violations(f, "const a = <Button reason={!x && 'fill_required_fields'}>Save</Button>;")).toHaveLength(0);
    expect(violations(f, 'const a = <Button busy={saving}>Save</Button>;')).toHaveLength(0);
    expect(violations(f, 'const a = <Button /* disabled-ok: pass-through, parent explains */ disabled={d}>Save</Button>;')).toHaveLength(0);
    expect(violations(f, 'const a = <Button /* disabled-ok: */ disabled={d}>Save</Button>;')).toHaveLength(1);
  });

  it('no Button in the app has disabled={...} without a reason', { timeout: 60_000 }, () => {
    const all = files(ROOT).flatMap((f) => violations(f));
    expect(all, `Give these buttons a reason= (see src/lib/blockedReasons.ts) or busy=:\n${all.join('\n')}`).toEqual([]);
  });
});
