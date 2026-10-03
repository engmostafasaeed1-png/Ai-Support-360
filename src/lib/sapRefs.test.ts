import { describe, it, expect } from 'vitest';
import {
  extractNoteNumbers,
  redactUnverifiedNotes,
  noteUrl,
  pickSearchTerms,
  cleanSearchTerms,
  blockedWords,
  communitySearchUrl,
} from '../../supabase/functions/_shared/sapRefs.ts';

describe('extractNoteNumbers', () => {
  it('finds the numbers after Note, SAP Note, KBA and OSS', () => {
    expect(extractNoteNumbers('See SAP Note 2270407 and KBA 3012345, also OSS note 1234567.')).toEqual(['2270407', '3012345', '1234567']);
  });

  it('finds every number of a list', () => {
    expect(extractNoteNumbers('Apply SAP Notes 2270407, 2345678 and 3012345 first.')).toEqual(['2270407', '2345678', '3012345']);
  });

  it('understands "no.", "number" and "#"', () => {
    expect(extractNoteNumbers('SAP Note no. 1234567, note number 7654321, KBA #3012345')).toEqual(['1234567', '7654321', '3012345']);
  });

  it('ignores numbers that no note keyword leads', () => {
    expect(extractNoteNumbers('Purchase order 4500123456 and amount 1234567 are not notes')).toEqual([]);
    expect(extractNoteNumbers('Note 123456789 has nine digits')).toEqual([]);
  });

  it('has no duplicates and respects the limit', () => {
    expect(extractNoteNumbers('Note 2270407. Note 2270407 again')).toEqual(['2270407']);
    expect(extractNoteNumbers('Notes 1000001, 1000002, 1000003, 1000004', 2)).toEqual(['1000001', '1000002']);
  });

  it('is safe for empty input', () => {
    expect(extractNoteNumbers('')).toEqual([]);
    expect(extractNoteNumbers(null)).toEqual([]);
    expect(extractNoteNumbers(undefined)).toEqual([]);
  });
});

describe('redactUnverifiedNotes', () => {
  const allowed = new Set(['2270407']);

  it('keeps a verified note as it is', () => {
    expect(redactUnverifiedNotes('Apply SAP Note 2270407 first.', allowed)).toBe('Apply SAP Note 2270407 first.');
  });

  it('replaces a note nobody verified', () => {
    expect(redactUnverifiedNotes('Apply SAP Note 1999999 first.', allowed)).toBe('Apply a related SAP Note first.');
    expect(redactUnverifiedNotes('Apply SAP Note 1999999 first.', new Set())).toBe('Apply a related SAP Note first.');
  });

  it('keeps only the verified numbers of a list', () => {
    expect(redactUnverifiedNotes('See SAP Notes 2270407 and 1999999.', allowed)).toBe('See SAP Notes 2270407.');
  });

  it('leaves other numbers alone', () => {
    expect(redactUnverifiedNotes('Run MIGO for 4500123456', new Set())).toBe('Run MIGO for 4500123456');
  });
});

describe('noteUrl', () => {
  it('builds the SAP for Me address of a note', () => {
    expect(noteUrl('2270407')).toBe('https://me.sap.com/notes/2270407');
  });

  it('refuses anything that is not a note number', () => {
    expect(noteUrl('227')).toBeNull();
    expect(noteUrl('2270407/../x')).toBeNull();
    expect(noteUrl('abc')).toBeNull();
  });
});

describe('pickSearchTerms', () => {
  it('puts codes first and drops filler words', () => {
    const terms = pickSearchTerms('Title: Vendor invoice cannot be posted\nDescription: FB60 says the posting period is closed. Please help, we get an error.', 8);
    expect(terms[0]).toBe('fb60');
    expect(terms).toContain('posting');
    expect(terms).toContain('period');
    expect(terms).toContain('closed');
    expect(terms).not.toContain('please');
    expect(terms).not.toContain('title');
    expect(terms).not.toContain('error');
  });

  it('ignores placeholders left by the scrub and plain numbers', () => {
    const terms = pickSearchTerms('Mail [email] about [company] order [number] 12345 clearing');
    expect(terms).toEqual(['mail', 'order', 'clearing']);
  });

  it('returns at most the asked number of terms, without duplicates', () => {
    const terms = pickSearchTerms('invoice invoice posting period closed vendor supplier payment run blocked', 3);
    expect(terms).toHaveLength(3);
    expect(new Set(terms).size).toBe(3);
  });

  it('is safe for empty input', () => {
    expect(pickSearchTerms('')).toEqual([]);
    expect(pickSearchTerms(null)).toEqual([]);
  });
});

describe('cleanSearchTerms', () => {
  it('keeps only letters, digits and underscores, in lowercase', () => {
    expect(cleanSearchTerms(['FB60', "o'brien; drop", 'S_TCODE', 'a-b'])).toEqual(['fb60', 'obriendrop', 's_tcode', 'ab']);
  });

  it('drops filler words, placeholders, numbers, duplicates and blocked names', () => {
    const blocked = new Set(['acme']);
    expect(cleanSearchTerms(['error', '[company]', '12345', 'invoice', 'invoice', 'Acme', 'period'], blocked)).toEqual(['invoice', 'period']);
  });

  it('limits the number and the length of the words', () => {
    expect(cleanSearchTerms(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff'], new Set(), 3)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(cleanSearchTerms(['x'.repeat(31), 'ok1'])).toEqual(['ok1']);
  });

  it('survives rubbish', () => {
    expect(cleanSearchTerms(null)).toEqual([]);
    expect(cleanSearchTerms('text')).toEqual([]);
    expect(cleanSearchTerms([null, undefined, 5, {}])).toEqual([]);
  });
});

describe('blockedWords', () => {
  it('splits protected names into lowercase words', () => {
    const words = blockedWords([{ term: 'Acme Industrial Holdings' }, { term: 'Mostafa' }]);
    expect([...words].sort()).toEqual(['acme', 'holdings', 'industrial', 'mostafa']);
  });
});

describe('communitySearchUrl', () => {
  it('opens the search page of SAP Community with the words', () => {
    expect(communitySearchUrl(['fb60', 'posting', 'period'])).toBe('https://community.sap.com/t5/forums/searchpage/tab/message?q=fb60%20posting%20period');
  });

  it('gives nothing for no usable word and refuses unsafe words', () => {
    expect(communitySearchUrl([])).toBeNull();
    expect(communitySearchUrl(['a b', "x'y", '<script>'])).toBeNull();
  });

  it('uses at most five words', () => {
    const url = communitySearchUrl(['aa', 'bb', 'cc', 'dd', 'ee', 'ff']) ?? '';
    expect(url.endsWith('aa%20bb%20cc%20dd%20ee')).toBe(true);
  });
});
