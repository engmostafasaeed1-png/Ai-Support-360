import { describe, it, expect } from 'vitest';
import {
  DOC_ACTION_LABEL,
  DOC_SIZE_HINT,
  DOC_STATUS_LABEL,
  describeSource,
  formatBytes,
  importPercent,
  primaryAction,
  repoUrl,
  type SapDocSource,
} from './sapDocsAdmin';

const source: SapDocSource = {
  id: 'sapui5',
  title: 'SAPUI5 and SAP Fiori',
  repo: 'SAP-docs/sapui5',
  branch: 'main',
  license: 'CC-BY-4.0',
  enabled: false,
  status: 'ready',
  commit_sha: 'abc',
  files_total: 1791,
  files_done: 1791,
  chunk_count: 9812,
  text_bytes: 8.4 * 1024 * 1024,
  imported_at: '2026-10-03T18:30:00.000Z',
  last_error: null,
  updated_at: '2026-10-03T18:30:00.000Z',
};

describe('formatBytes', () => {
  it('writes sizes the way people read them', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(-5)).toBe('0 KB');
    expect(formatBytes(Number.NaN)).toBe('0 KB');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(48 * 1024 * 1024)).toBe('48 MB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});

describe('importPercent', () => {
  it('is a whole number between 0 and 100', () => {
    expect(importPercent({ files_total: 0, files_done: 0 })).toBe(0);
    expect(importPercent({ files_total: 200, files_done: 50 })).toBe(25);
    expect(importPercent({ files_total: 3, files_done: 1 })).toBe(33);
    expect(importPercent({ files_total: 10, files_done: 99 })).toBe(100);
    expect(importPercent({ files_total: 10, files_done: -4 })).toBe(0);
  });
});

describe('repoUrl', () => {
  it('links only repositories of the SAP-docs organisation', () => {
    expect(repoUrl('SAP-docs/sapui5')).toBe('https://github.com/SAP-docs/sapui5');
    expect(repoUrl('someone/else')).toBeNull();
    expect(repoUrl('SAP-docs/../x')).toBeNull();
  });
});

describe('primaryAction', () => {
  it('offers the right button for each state', () => {
    expect(primaryAction('empty')).toBe('import');
    expect(primaryAction('error')).toBe('import');
    expect(primaryAction('ready')).toBe('update');
    expect(primaryAction('importing')).toBe('continue');
    expect(DOC_ACTION_LABEL.update).toBe('Update');
  });
});

describe('describeSource', () => {
  it('tells pages, passages, size and date', () => {
    expect(describeSource(source)).toBe('1,791 pages, 9,812 passages, 8.4 MB of text, imported 2026-10-03');
  });

  it('leaves out the date when there is none or it is not a date', () => {
    expect(describeSource({ ...source, imported_at: null })).toBe('1,791 pages, 9,812 passages, 8.4 MB of text');
    expect(describeSource({ ...source, imported_at: 'yesterday' })).toBe('1,791 pages, 9,812 passages, 8.4 MB of text');
  });
});

describe('labels', () => {
  it('has a label for every state and a size hint for every seeded source', () => {
    expect(Object.keys(DOC_STATUS_LABEL).sort()).toEqual(['empty', 'error', 'importing', 'ready']);
    expect(Object.keys(DOC_SIZE_HINT).sort()).toEqual(['btp-best-practices', 'btp-business-application-studio', 'btp-cloud-platform', 'btp-integration-suite', 'sapui5']);
  });
});
