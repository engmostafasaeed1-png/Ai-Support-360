import { describe, expect, it } from 'vitest';
import { parseMissingRequired } from './clientRequired';

describe('parseMissingRequired', () => {
  it('parses company name and SAP modules', () => {
    expect(parseMissingRequired('missing_required:company_name,sap_modules')).toEqual(['company_name', 'sap_modules']);
  });

  it('parses a wrapped database error', () => {
    expect(parseMissingRequired('P0001: missing_required:sap_modules')).toEqual(['sap_modules']);
  });

  it('returns null for unrelated or missing errors', () => {
    expect(parseMissingRequired('network error')).toBeNull();
    expect(parseMissingRequired(undefined)).toBeNull();
  });
});
