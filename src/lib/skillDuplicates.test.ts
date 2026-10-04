import { describe, it, expect } from 'vitest';
import { duplicateSkillIds, type SkillRow } from './skillDuplicates';

const skill = (id: string, module: string, proficiency = 3, years = 1, certified = false): SkillRow => ({ id, module, proficiency, years, certified });

describe('duplicateSkillIds', () => {
  it('has nothing to remove when every module is listed once', () => {
    expect(duplicateSkillIds([skill('a', 'SAP FI'), skill('b', 'SAP CO'), skill('c', 'SAP MM')])).toEqual([]);
    expect(duplicateSkillIds([])).toEqual([]);
  });

  it('keeps one row of a module that is listed more than once and removes the others', () => {
    const ids = duplicateSkillIds([skill('a', 'SAP FI'), skill('b', 'SAP FI'), skill('c', 'SAP FI'), skill('d', 'SAP CO')]);
    expect(ids.sort()).toEqual(['b', 'c']);
  });

  it('keeps the certified one', () => {
    const ids = duplicateSkillIds([skill('a', 'SAP FI', 5, 9, false), skill('b', 'SAP FI', 2, 1, true)]);
    expect(ids).toEqual(['a']);
  });

  it('keeps the one with the higher level when the certification is the same', () => {
    const ids = duplicateSkillIds([skill('a', 'SAP CO', 3), skill('b', 'SAP CO', 5), skill('c', 'SAP CO', 4)]);
    expect(ids.sort()).toEqual(['a', 'c']);
  });

  it('keeps the one with more years when the level is the same', () => {
    const ids = duplicateSkillIds([skill('a', 'SAP CO', 4, 2), skill('b', 'SAP CO', 4, 6)]);
    expect(ids).toEqual(['a']);
  });

  it('keeps the first one when the rows are equal', () => {
    const ids = duplicateSkillIds([skill('a', 'SAP HCM', 3, 1), skill('b', 'SAP HCM', 3, 1)]);
    expect(ids).toEqual(['b']);
  });

  it('treats other capitals and spaces around the name as the same module', () => {
    const ids = duplicateSkillIds([skill('a', 'SAP FI'), skill('b', ' sap fi '), skill('c', 'SAP FI ')]);
    expect(ids.sort()).toEqual(['b', 'c']);
  });

  it('removes every row without a module', () => {
    const ids = duplicateSkillIds([skill('a', ''), skill('b', '   '), skill('c', 'SAP FI')]);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('does not change the rows it is given', () => {
    const rows = [skill('a', 'SAP FI'), skill('b', 'SAP FI')];
    const copy = JSON.parse(JSON.stringify(rows));
    duplicateSkillIds(rows);
    expect(rows).toEqual(copy);
  });

  it('works for a list like the real one (16 rows, 9 modules and one empty row)', () => {
    const rows = [
      skill('1', 'SAP FI', 5, 6, true), skill('2', 'SAP CO', 4, 4), skill('3', 'SAP S/4HANA', 4, 3, true), skill('4', 'Accounts Payable', 5, 6),
      skill('5', 'Accounts Receivable', 5, 6), skill('6', 'SAP FI', 3, 2, true), skill('7', 'SAP CO', 4, 2, true), skill('8', 'SAP S/4HANA', 3, 2, true),
      skill('9', 'SAP FI', 4, 6), skill('10', 'SAP CO', 3, 6), skill('11', 'SAP S/4HANA Finance', 4, 3), skill('12', 'SAP HCM', 3, 1),
      skill('13', 'SAP WM', 3, 8, true), skill('14', 'SAP PM', 3, 1), skill('15', '', 3, 1), skill('16', 'SAP HCM', 3, 1),
    ];
    const ids = duplicateSkillIds(rows);
    // SAP FI keeps row 1 (certified, level 5), SAP CO keeps row 7 (certified), SAP S/4HANA keeps row 3 (higher level), SAP HCM keeps row 12 (the first), the empty row 15 goes.
    expect(ids.sort((a, b) => Number(a) - Number(b))).toEqual(['2', '6', '8', '9', '10', '15', '16']);
    expect(rows.length - ids.length).toBe(9);
  });
});
