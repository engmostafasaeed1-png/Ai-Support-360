import { describe, it, expect } from 'vitest';
import { normalizeSuggestResult, suggestSignature, canSuggest, hasReferences, sapNoteLink, BASIS_LABEL } from './aiSuggest';

const ID1 = '123e4567-e89b-12d3-a456-426614174000';
const ID2 = '223e4567-e89b-12d3-a456-426614174001';

describe('normalizeSuggestResult', () => {
  it('keeps a well-formed answer', () => {
    const r = normalizeSuggestResult({
      enabled: true,
      mode: 'knowledge',
      suggestions: [{
        title: 'Open the posting period',
        summary: 'The period is closed.',
        steps: ['Open OB52', 'Post again'],
        tcodes: ['OB52'],
        confidence: 'high',
        basis: 'past_case',
        source_ids: [ID1],
      }],
      sources: [{ id: ID1, kind: 'solution', title: 'Posting period closed' }],
      note: 'Check with your finance team.',
    });
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe('knowledge');
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].basis).toBe('past_case');
    expect(r.suggestions[0].source_ids).toEqual([ID1]);
    expect(r.sources[0]).toEqual({ id: ID1, kind: 'solution', title: 'Posting period closed' });
    expect(r.note).toBe('Check with your finance team.');
  });

  it('survives rubbish without throwing', () => {
    for (const raw of [null, undefined, 42, 'text', [], {}, { suggestions: 'x' }, { suggestions: [null, 5, {}] }]) {
      const r = normalizeSuggestResult(raw);
      expect(r.suggestions).toEqual([]);
      expect(r.sources).toEqual([]);
      expect(r.mode).toBe('general');
    }
  });

  it('drops a suggestion without title or steps', () => {
    const r = normalizeSuggestResult({
      suggestions: [
        { title: '', steps: ['a'] },
        { title: 'No steps', steps: [] },
        { title: 'Good', steps: ['do it'] },
      ],
    });
    expect(r.suggestions.map(s => s.title)).toEqual(['Good']);
  });

  it('bounds the size of everything', () => {
    const r = normalizeSuggestResult({
      suggestions: Array.from({ length: 9 }, (_, i) => ({
        title: 'T' + i + 'x'.repeat(300),
        summary: 'y'.repeat(2000),
        steps: Array.from({ length: 20 }, () => 'z'.repeat(1000)),
        tcodes: Array.from({ length: 20 }, () => 'FB60'),
      })),
    });
    expect(r.suggestions).toHaveLength(4);
    expect(r.suggestions[0].title.length).toBeLessThanOrEqual(140);
    expect(r.suggestions[0].summary.length).toBeLessThanOrEqual(600);
    expect(r.suggestions[0].steps).toHaveLength(8);
    expect(r.suggestions[0].steps[0].length).toBeLessThanOrEqual(300);
    expect(r.suggestions[0].tcodes).toHaveLength(8);
  });

  it('defaults an unknown basis to general and an unknown confidence to medium', () => {
    const r = normalizeSuggestResult({ suggestions: [{ title: 'A', steps: ['b'], basis: 'secret_source', confidence: 'certain' }] });
    expect(r.suggestions[0].basis).toBe('general');
    expect(r.suggestions[0].confidence).toBe('medium');
  });

  it('ignores ids that are not UUIDs', () => {
    const r = normalizeSuggestResult({
      suggestions: [{ title: 'A', steps: ['b'], source_ids: [ID1, 'not-an-id', 7, ID2] }],
      sources: [{ id: 'nope', kind: 'article', title: 'x' }, { id: ID2, kind: 'article', title: 'ok' }],
    });
    expect(r.suggestions[0].source_ids).toEqual([ID1, ID2]);
    expect(r.sources).toEqual([{ id: ID2, kind: 'article', title: 'ok' }]);
  });

  it('is switched off only when the server says so', () => {
    expect(normalizeSuggestResult({ enabled: false }).enabled).toBe(false);
    expect(normalizeSuggestResult({}).enabled).toBe(true);
  });
});

describe('SAP references', () => {
  const searchUrl = 'https://community.sap.com/t5/forums/searchpage/tab/message?q=fb60%20posting';

  it('has no references when the server sent none', () => {
    const r = normalizeSuggestResult({});
    expect(r.notes).toEqual([]);
    expect(r.references).toEqual({ communitySearchUrl: null, communityEnabled: false, community: [] });
    expect(hasReferences(r)).toBe(false);
  });

  it('builds the note link itself from the number, whatever address the server sent', () => {
    const r = normalizeSuggestResult({ notes: [{ number: '2270407', url: 'https://evil.example.com/steal' }, { number: '2270407' }, { number: '12' }, { number: 'abc' }, null] });
    expect(r.notes).toEqual([{ number: '2270407', url: 'https://me.sap.com/notes/2270407' }]);
    expect(sapNoteLink('3012345')).toBe('https://me.sap.com/notes/3012345');
  });

  it('keeps at most five notes', () => {
    const r = normalizeSuggestResult({ notes: Array.from({ length: 9 }, (_, i) => ({ number: String(1000001 + i) })) });
    expect(r.notes).toHaveLength(5);
  });

  it('accepts only links on SAP Community, at most three discussions', () => {
    const r = normalizeSuggestResult({
      references: {
        community_search_url: searchUrl,
        community: {
          enabled: true,
          items: [
            { title: 'Posting period closed', url: 'https://community.sap.com/t5/x/qaq-p/1', solved: true },
            { title: 'Elsewhere', url: 'https://evil.example.com/x', solved: true },
            { title: 'Look-alike', url: 'https://community.sap.com.evil.example/x', solved: false },
            { title: '', url: 'https://community.sap.com/t5/x/qaq-p/2', solved: false },
            { title: 'Open question', url: 'https://community.sap.com/t5/x/qaq-p/3' },
            { title: 'Third', url: 'https://community.sap.com/t5/x/qaq-p/4', solved: false },
            { title: 'Fourth', url: 'https://community.sap.com/t5/x/qaq-p/5', solved: false },
          ],
        },
      },
    });
    expect(r.references.communityEnabled).toBe(true);
    expect(r.references.communitySearchUrl).toBe(searchUrl);
    expect(r.references.community.map(c => c.title)).toEqual(['Posting period closed', 'Open question', 'Third']);
    expect(r.references.community[0].solved).toBe(true);
    expect(r.references.community[1].solved).toBe(false);
    expect(hasReferences(r)).toBe(true);
  });

  it('refuses a search link that is not on SAP Community', () => {
    const r = normalizeSuggestResult({ references: { community_search_url: 'https://www.google.com/search?q=x' } });
    expect(r.references.communitySearchUrl).toBeNull();
    expect(hasReferences(r)).toBe(false);
  });

  it('counts a note alone as a reference', () => {
    expect(hasReferences(normalizeSuggestResult({ notes: [{ number: '2270407' }] }))).toBe(true);
  });
});

describe('suggestSignature and canSuggest', () => {
  const base = { title: 'Posting fails', description: 'Vendor invoice cannot be posted', areas: ['SAP FI/CO'], other: '', details: '', language: 'en' };

  it('gives the same key for the same draft, whatever the spaces and capitals', () => {
    expect(suggestSignature(base)).toBe(suggestSignature({ ...base, title: '  posting   FAILS ', description: 'vendor invoice cannot be posted ' }));
  });

  it('gives another key when the text, the areas or the language change', () => {
    const key = suggestSignature(base);
    expect(suggestSignature({ ...base, description: 'Something else entirely here' })).not.toBe(key);
    expect(suggestSignature({ ...base, areas: ['SAP MM'] })).not.toBe(key);
    expect(suggestSignature({ ...base, language: 'ar' })).not.toBe(key);
  });

  it('asks only for a description of at least 20 characters', () => {
    expect(canSuggest('too short')).toBe(false);
    expect(canSuggest('   ' + 'x'.repeat(19) + '   ')).toBe(false);
    expect(canSuggest('x'.repeat(20))).toBe(true);
  });

  it('has a label for every basis', () => {
    expect(Object.keys(BASIS_LABEL).sort()).toEqual(['general', 'knowledge_base', 'past_case', 'playbook']);
  });
});
