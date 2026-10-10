import { describe, it, expect } from 'vitest';
import { hasModule, skillMatchesText } from './consultantDirectory';

describe('hasModule', () => {
  const c = { specialty: 'SAP FI', skills: ['SAP FI', 'SAP S/4HANA', 'SAP MM'] };
  it('finds a module among all skills, without case and without the SAP prefix', () => {
    expect(hasModule(c, 'MM')).toBe(true);
    expect(hasModule(c, 'sap s/4hana')).toBe(true);
    expect(hasModule(c, 'SD')).toBe(false);
  });
  it('does not match a part of a module name', () => {
    expect(hasModule({ specialty: 'SAP FIORI', skills: ['SAP FIORI'] }, 'FI')).toBe(false);
  });
  it('uses the specialty when there are no skills', () => {
    expect(hasModule({ specialty: 'SAP CO' }, 'CO')).toBe(true);
  });
});

describe('skillMatchesText', () => {
  it('finds a text in any module name', () => {
    const c = { specialty: 'SAP FI', skills: ['SAP FI', 'SAP S/4HANA'] };
    expect(skillMatchesText(c, 'hana')).toBe(true);
    expect(skillMatchesText(c, 'payroll')).toBe(false);
    expect(skillMatchesText(c, '  ')).toBe(true);
  });
});
