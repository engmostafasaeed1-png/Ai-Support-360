import { describe, it, expect } from 'vitest';
import { MAX_NOTES_TRIED, addNoteNumbers, cleanNoteList } from './sapNotes';

describe('cleanNoteList', () => {
  it('keeps valid, distinct numbers in order', () => {
    expect(cleanNoteList(['2270407', '3012345', '2270407'])).toEqual(['2270407', '3012345']);
  });

  it('drops everything that is not a note number', () => {
    expect(cleanNoteList(['1234', '123456789', 'abc12345', ' 2270407', 2270407, null, undefined, {}, '12345'])).toEqual(['12345']);
  });

  it('keeps at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => String(1000001 + i));
    expect(cleanNoteList(many)).toHaveLength(MAX_NOTES_TRIED);
  });

  it('gives an empty list for anything that is not a list', () => {
    expect(cleanNoteList(null)).toEqual([]);
    expect(cleanNoteList(undefined)).toEqual([]);
    expect(cleanNoteList('2270407')).toEqual([]);
    expect(cleanNoteList({ 0: '2270407' })).toEqual([]);
  });
});

describe('addNoteNumbers', () => {
  it('finds the numbers in a sentence', () => {
    const r = addNoteNumbers([], 'SAP Note 2270407, 3012345 and KBA 3100000');
    expect(r.notes).toEqual(['2270407', '3012345', '3100000']);
    expect(r.added).toEqual(['2270407', '3012345', '3100000']);
    expect(r.ignored).toEqual([]);
    expect(r.full).toBe(false);
  });

  it('takes a number with a hash sign, a full stop or brackets around it', () => {
    expect(addNoteNumbers([], '#2270407. (3012345)').notes).toEqual(['2270407', '3012345']);
  });

  it('adds to what is there and does not repeat a number', () => {
    const r = addNoteNumbers(['2270407'], '2270407 3012345 3012345');
    expect(r.notes).toEqual(['2270407', '3012345']);
    expect(r.added).toEqual(['3012345']);
  });

  it('reports what is not a note number', () => {
    const r = addNoteNumbers([], '1234, abc, 123456789, 2270407');
    expect(r.notes).toEqual(['2270407']);
    expect(r.ignored).toEqual(['1234', 'abc', '123456789']);
  });

  it('stops at eight and says so', () => {
    const eight = Array.from({ length: 8 }, (_, i) => String(1000001 + i));
    const r = addNoteNumbers(eight, '3012345');
    expect(r.notes).toEqual(eight);
    expect(r.added).toEqual([]);
    expect(r.full).toBe(true);
  });

  it('fills the list up to eight when more are given', () => {
    const r = addNoteNumbers(['1000001'], Array.from({ length: 10 }, (_, i) => String(2000001 + i)).join(' '));
    expect(r.notes).toHaveLength(MAX_NOTES_TRIED);
    expect(r.full).toBe(true);
  });

  it('does nothing for an empty text', () => {
    const r = addNoteNumbers(['2270407'], '   ');
    expect(r.notes).toEqual(['2270407']);
    expect(r.added).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it('does not change the list that was given', () => {
    const current = ['2270407'];
    addNoteNumbers(current, '3012345');
    expect(current).toEqual(['2270407']);
  });
});
