import { describe, it, expect } from 'vitest';
import { describeFlags, parseTags, validateReview, MAX_TITLE, MAX_PROBLEM, MAX_SOLUTION, MAX_TAGS } from './knowledgeReview';

describe('describeFlags', () => {
  it('says in words what the privacy check removed', () => {
    expect(describeFlags(['email', 'number'])).toBe('e-mail address, long number');
  });

  it('is empty when nothing was removed', () => {
    expect(describeFlags([])).toBe('');
    expect(describeFlags(null)).toBe('');
    expect(describeFlags(undefined)).toBe('');
  });

  it('shows an unknown flag as it is', () => {
    expect(describeFlags(['something_new'])).toBe('something_new');
  });
});

describe('parseTags', () => {
  it('lowercases, joins words with hyphens and drops duplicates and too short tags', () => {
    expect(parseTags('SAP, Posting Period , fi, FI, x, a_b')).toEqual(['sap', 'posting-period', 'fi', 'a-b']);
  });

  it('keeps at most 8 tags', () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag${i}`).join(',');
    expect(parseTags(many)).toHaveLength(MAX_TAGS);
  });

  it('drops a tag longer than 24 characters', () => {
    expect(parseTags('a'.repeat(25) + ',ok')).toEqual(['ok']);
  });

  it('is empty for an empty text', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(' , , ')).toEqual([]);
  });
});

describe('validateReview', () => {
  const ok = { title: 'Posting period is closed', problem: 'Posting a vendor invoice fails.', solution: '1. Open the period.' };

  it('accepts a complete item', () => {
    expect(validateReview(ok)).toBeNull();
  });

  it('names the first thing that is wrong', () => {
    expect(validateReview({ ...ok, title: '  ' })).toBe('The title is empty.');
    expect(validateReview({ ...ok, problem: '' })).toBe('The problem description is empty.');
    expect(validateReview({ ...ok, solution: '' })).toBe('The solution is empty.');
  });

  it('refuses text that is too long', () => {
    expect(validateReview({ ...ok, title: 'x'.repeat(MAX_TITLE + 1) })).toMatch(/title is longer/);
    expect(validateReview({ ...ok, problem: 'x'.repeat(MAX_PROBLEM + 1) })).toMatch(/problem description is longer/);
    expect(validateReview({ ...ok, solution: 'x'.repeat(MAX_SOLUTION + 1) })).toMatch(/solution is longer/);
    expect(validateReview({ ...ok, title: 'x'.repeat(MAX_TITLE) })).toBeNull();
  });
});
