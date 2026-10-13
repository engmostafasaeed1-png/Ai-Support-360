import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|json|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

const isTestFile = (p: string) => /\.(test|spec)\.[jt]sx?$/.test(p) || /[\\/]test[\\/]/.test(p);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SECRET_PATTERNS: [string, RegExp][] = [
  ['OpenAI-style key', /sk-[A-Za-z0-9]{20,}/],
  ['Stripe live key', /sk_live_/],
  ['Private key', /BEGIN PRIVATE KEY/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
];

const files = walk(ROOT);

describe('source scan', () => {
  it('contains no literal secrets', () => {
    const hits: string[] = [];
    for (const f of files) {
      if (isTestFile(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const [label, rx] of SECRET_PATTERNS) if (rx.test(text)) hits.push(`${label}: ${relative(ROOT, f)}`);
      if (/service_role/.test(stripComments(text))) hits.push(`service_role: ${relative(ROOT, f)}`);
    }
    expect(hits).toEqual([]);
  });

  it('contains no LLM system prompt longer than 400 characters', () => {
    const hits: string[] = [];
    for (const f of files) {
      if (isTestFile(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/`(You are[^`]*)`/g)) {
        if (m[1].length > 400) hits.push(`${relative(ROOT, f)} (${m[1].length} chars)`);
      }
    }
    expect(hits).toEqual([]);
  });
});
