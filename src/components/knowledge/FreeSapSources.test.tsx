import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import FreeSapSources from './FreeSapSources';

afterEach(() => cleanup());

describe('FreeSapSources', () => {
  it('links to the four official free SAP websites, each in a new tab', () => {
    render(<FreeSapSources />);
    const expected: Array<[string, string]> = [
      ['SAP Help Portal', 'https://help.sap.com/docs'],
      ['SAP Community', 'https://community.sap.com/'],
      ['SAP Learning', 'https://learning.sap.com/'],
      ['SAP Developer tutorials', 'https://developers.sap.com/tutorial-navigator/'],
    ];
    for (const [name, href] of expected) {
      const link = screen.getByText(name).closest('a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('says that no SAP login is needed and that SAP Notes need one', () => {
    render(<FreeSapSources />);
    const text = screen.getByTestId('free-sap-sources').textContent ?? '';
    expect(text).toMatch(/No SAP login is needed/);
    expect(text).toMatch(/SAP Notes are on SAP for Me and need your own SAP login/);
  });
});
