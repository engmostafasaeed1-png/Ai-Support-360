import { describe, expect, it } from 'vitest';
import { chunkText, CHUNK_CHARS, MAX_CHUNKS_PER_DOCUMENT, safeFileName, sniffDocument } from '../../supabase/functions/_shared/knowledgeDocs.ts';
import { cleanVersion, versionChoices, versionFamily } from '../../supabase/functions/_shared/sapVersions.ts';
import { coverageState, parseTags, precheckFile } from './interviewKnowledge';
import { basisList } from '@/components/consultant/InterviewBasisNotice';

const enc = (s: string) => new TextEncoder().encode(s);

describe('upload allowlist by type AND content', () => {
  it('accepts matching content only', () => {
    expect(sniffDocument(enc('%PDF-1.7 ...'), 'notes.pdf')).toBe('pdf');
    expect(sniffDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'notes.docx')).toBe('docx');
    expect(sniffDocument(enc('# Heading\nText'), 'notes.md')).toBe('md');
    expect(sniffDocument(enc('Plain text ä ö ü عربي'), 'notes.txt')).toBe('txt');
  });
  it('rejects disguised or unknown files', () => {
    expect(sniffDocument(enc('just text'), 'fake.pdf')).toBeNull();
    expect(sniffDocument(enc('%PDF-1.4'), 'renamed.txt')).toBeNull();
    expect(sniffDocument(new Uint8Array([0x4d, 0x5a, 0x90, 0]), 'program.txt')).toBeNull();
    expect(sniffDocument(new Uint8Array([0x41, 0x00, 0x42]), 'binary.txt')).toBeNull();
    expect(sniffDocument(new Uint8Array([0xff, 0xfe, 0xfd]), 'bad-utf8.md')).toBeNull();
    expect(sniffDocument(enc('<html>'), 'page.html')).toBeNull();
    expect(sniffDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'sheet.xlsx')).toBeNull();
  });
  it('prechecks extension and size in the browser', () => {
    expect(precheckFile({ name: 'a.pdf', size: 10 })).toBe('ok');
    expect(precheckFile({ name: 'a.exe', size: 10 })).toBe('wrong_type');
    expect(precheckFile({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 })).toBe('too_large');
    expect(precheckFile({ name: 'a.pdf', size: 0 })).toBe('empty');
  });
});

describe('safe file names', () => {
  it('removes paths, odd characters and keeps the extension', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\docs\\Überblick FI 2023 (final).PDF')).toBe('Uberblick-FI-2023-final.pdf');
    expect(safeFileName('دليل.docx')).toBe('document.docx');
    expect(safeFileName('a'.repeat(200) + '.md')).toHaveLength(83);
  });
});

describe('chunking', () => {
  it('keeps chunks under the size and splits long paragraphs', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ` + 'Posting logic and document splitting details. '.repeat(10)).join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
    const huge = 'word '.repeat(200_000);
    expect(chunkText(huge).length).toBeLessThanOrEqual(MAX_CHUNKS_PER_DOCUMENT);
    expect(chunkText('   ')).toEqual([]);
  });
});

describe('version choices per module', () => {
  it('maps modules to product families', () => {
    expect(versionFamily('SAP FI')).toBe('s4hana');
    expect(versionFamily('SAP ECC 6.0')).toBe('ecc');
    expect(versionFamily('SAP SuccessFactors Employee Central')).toBe('successfactors');
    expect(versionFamily('SAP Fiori')).toBe('fiori');
    expect(versionFamily('Cloud Connector and Connectivity')).toBe('btp');
    expect(versionFamily('Something new')).toBe('other');
  });
  it('uses admin rows for a family when there are any', () => {
    expect(versionChoices('SAP FI')).toContain('S/4HANA 2023');
    const rows = [{ module_key: 's4hana', label: 'S/4HANA 2025 FPS01', sort_order: 1 }, { module_key: 's4hana', label: 'Old', sort_order: 0, is_active: false }];
    expect(versionChoices('SAP FI', rows)).toEqual(['S/4HANA 2025 FPS01']);
  });
  it('cleans typed versions', () => {
    expect(cleanVersion('  S/4HANA   2023 ')).toBe('S/4HANA 2023');
    expect(cleanVersion('<b>2023</b>')).toBe('b2023/b');
    expect(cleanVersion('')).toBeNull();
    expect(cleanVersion('x'.repeat(80))).toHaveLength(60);
  });
});

describe('admin page helpers', () => {
  it('parses tags', () => {
    expect(parseTags('FI, closing; fi , <x>')).toEqual(['FI', 'closing', 'x']);
  });
  it('labels coverage rows', () => {
    expect(coverageState({ documents: 0, module_documents: 0 })).toBe('none');
    expect(coverageState({ documents: 0, module_documents: 2 })).toBe('general_only');
    expect(coverageState({ documents: 1, module_documents: 1 })).toBe('covered');
  });
  it('lists modules and versions for the consultant notice', () => {
    expect(basisList([{ sap_module: 'SAP FI', sap_version: 'S/4HANA 2023' }, { sap_module: 'SAP MM' }])).toBe('SAP FI (S/4HANA 2023), SAP MM');
    expect(basisList(Array.from({ length: 10 }, (_, i) => ({ sap_module: `M${i}` })), 8)).toMatch(/\+2$/);
  });
});
