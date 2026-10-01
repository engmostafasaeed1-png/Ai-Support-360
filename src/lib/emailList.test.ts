import { describe, expect, it } from 'vitest';
import { parseEmailList } from './emailList';

describe('parseEmailList', () => {
  it('accepts comma, semicolon and space separated lists, lower-cases and removes duplicates', () => {
    expect(parseEmailList('A@x.com, b@y.org; a@x.com  c@z.io').emails).toEqual(['a@x.com', 'b@y.org', 'c@z.io']);
  });

  it('treats an empty box as no addresses and no error', () => {
    expect(parseEmailList('   ')).toEqual({ emails: [], error: null });
  });

  it('refuses an invalid address and names it', () => {
    const result = parseEmailList('ok@x.com, not-an-email');
    expect(result.emails).toEqual([]);
    expect(result.error).toContain('not-an-email');
  });

  it('refuses more addresses than the limit', () => {
    expect(parseEmailList('a@x.com b@x.com c@x.com', 2).error).toContain('at most 2');
  });

  it('refuses header-injection style input', () => {
    expect(parseEmailList('a@x.com\nbcc:evil@x.com').error).not.toBeNull();
    expect(parseEmailList('a@x.com,<b@x.com>').error).not.toBeNull();
  });
});
