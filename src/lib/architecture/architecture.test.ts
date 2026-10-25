import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCH_TYPES, TYPE_SECTIONS, allowedStatuses, archRole, canWriteArch, canSeeDraft, diagramFileProblem, diffArch, emptyArchContent,
  landscapeProblems, looksLikeSecret, nextVersionNumber, normalizeArchContent, statusAfterNewVersion, traceMatrix, type ArchAccessInput,
} from '../../../supabase/functions/_shared/archModel';
import { parseArchDraft, parseReview } from '../../../supabase/functions/_shared/archPrompt';
import { layoutGraph, layoutToSvg, parseMermaid } from './mermaid';
import { sanitizeSvg, sniffImage } from './svgSanitize';
import { DEFAULT_FILTERS, docsByTicket, filterDocs } from './listing';
import { proposedChanges } from './aiChanges';
import type { ArchListRow } from './api';

const base: ArchAccessInput = {
  isAdmin: false, tenantScoped: false, isCreator: false, isOwnerAccount: false, orgRole: null, confidentiality: 'private',
  archived: false, consultantOnLinkedTicket: false, ndaBothSigned: false, requireNda: true,
};

describe('versions', () => {
  it('numbers the next version as highest + 1', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
    expect(nextVersionNumber([1, 5, 2])).toBe(6);
  });
  it('a new version of an approved document goes back to review', () => {
    expect(statusAfterNewVersion('approved')).toBe('in_review');
    expect(statusAfterNewVersion('draft')).toBe('draft');
  });
  it('approval needs a saved version; archived only comes back as draft', () => {
    expect(allowedStatuses('draft', 0)).not.toContain('approved');
    expect(allowedStatuses('draft', 1)).toContain('approved');
    expect(allowedStatuses('archived', 3)).toEqual(['draft']);
  });
});

describe('access rule', () => {
  it('the owning client writes, another client gets nothing', () => {
    expect(archRole({ ...base, isOwnerAccount: true })).toBe('client');
    expect(archRole(base)).toBeNull();
  });
  it('company: owner/admin/manager or creator write, member reads', () => {
    expect(archRole({ ...base, tenantScoped: true, orgRole: 'manager' })).toBe('client');
    expect(archRole({ ...base, tenantScoped: true, orgRole: 'member' })).toBe('company');
    expect(archRole({ ...base, tenantScoped: true, orgRole: 'member', isCreator: true })).toBe('client');
  });
  it('unshared documents stay closed to the assigned consultant', () => {
    expect(archRole({ ...base, consultantOnLinkedTicket: true, ndaBothSigned: true })).toBeNull();
  });
  it('shared: consultant reads only with NDA signed by both and while not archived', () => {
    const shared = { ...base, confidentiality: 'shared' as const, consultantOnLinkedTicket: true };
    expect(archRole({ ...shared, ndaBothSigned: true })).toBe('consultant');
    expect(archRole({ ...shared, ndaBothSigned: false })).toBeNull();
    expect(archRole({ ...shared, ndaBothSigned: true, archived: true })).toBeNull();
    expect(archRole({ ...base, confidentiality: 'shared', consultantOnLinkedTicket: false, ndaBothSigned: true })).toBeNull();
  });
  it('consultants are read-only and never see the draft', () => {
    expect(canWriteArch('consultant', false)).toBe(false);
    expect(canWriteArch('company', false)).toBe(false);
    expect(canWriteArch('client', true)).toBe(false);
    expect(canWriteArch('client', false)).toBe(true);
    expect(canSeeDraft('consultant')).toBe(false);
  });
  it('admins always read', () => expect(archRole({ ...base, isAdmin: true })).toBe('admin'));
});

describe('content model', () => {
  it('keeps only the template sections, in template order', () => {
    const c = normalizeArchContent({ type: 'adr', sections: [{ key: 'decision', html: '<p>x</p>' }, { key: 'cutover_tasks', html: 'no' }, { key: 'decision', html: 'dup' }] });
    expect(c.sections.map((s) => s.key)).toEqual(TYPE_SECTIONS.adr);
    expect(c.sections.find((s) => s.key === 'decision')?.html).toBe('<p>x</p>');
  });
  it('drops malformed diagrams and requirement links', () => {
    const c = normalizeArchContent({ type: 'hld', sections: [{ key: 'context', trace: [{ ticket_ref: 'ab12', req_id: 'REQ-001' }, { ticket_ref: 'x', req_id: 'REQ-1' }],
      diagrams: [{ id: 'dabcdefg', kind: 'mermaid', source: 'graph LR' }, { id: 'bad', kind: 'mermaid' }, { id: 'dqwertyu', kind: 'image', asset_id: 'nope' }] }] });
    expect(c.sections[0].trace).toEqual([{ ticket_ref: 'AB12', req_id: 'REQ-001' }]);
    expect(c.sections[0].diagrams).toHaveLength(1);
  });
  it('diff shows changed sections and detail changes', () => {
    const a = emptyArchContent('hld');
    const b = { ...a, sections: a.sections.map((s) => (s.key === 'scope' ? { ...s, html: '<p>Finance only</p>' } : s)) };
    const d = diffArch({ content: a, meta: { title: 'A' } }, { content: b, meta: { title: 'B' } });
    expect(d.filter((x) => x.changed).map((x) => x.key)).toEqual(['details', 'scope']);
    expect(diffArch({ content: a }, { content: a }).some((x) => x.changed)).toBe(false);
  });
  it('traceability lists uncovered and unknown requirements', () => {
    const c = emptyArchContent('hld');
    c.sections[0].trace = [{ ticket_ref: 'T1', req_id: 'REQ-001' }, { ticket_ref: 'T1', req_id: 'REQ-009' }];
    const m = traceMatrix(c, [{ ticket_id: 'x', ticket_ref: 'T1', req_id: 'REQ-001', description: '' }, { ticket_id: 'x', ticket_ref: 'T1', req_id: 'REQ-002', description: '' }]);
    expect(m.uncovered.map((r) => r.req_id)).toEqual(['REQ-002']);
    expect(m.unknown.map((r) => r.req_id)).toEqual(['REQ-009']);
  });
  it('section templates match the database catalogue', () => {
    const sql = readFileSync('docs/sql/solution-architecture.sql', 'utf8');
    for (const t of ARCH_TYPES) {
      const m = new RegExp(`WHEN '${t}' THEN ARRAY\\[([^\\]]+)\\]`).exec(sql);
      expect(m, t).not.toBeNull();
      expect(m![1].split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...TYPE_SECTIONS[t]]);
    }
  });
});

describe('landscape register refuses credentials', () => {
  it.each(['password: Init123', 'Kennwort Initial1', 'pwd=abc', 'api key abc', 'كلمة المرور 1234', 'hana://SYSTEM:Manager1@10.0.0.5', 'login: ddic', 'token sk-abcdefghijklmnopqrstuvwxyz'])('rejects %s', (s) => {
    expect(looksLikeSecret(s)).toBe(true);
  });
  it.each(['Passive standby in second region', 'Central finance hub', 'Tokenisation of card data via provider'])('accepts %s', (s) => {
    expect(looksLikeSecret(s)).toBe(false);
  });
  it('validates SID, role and secrets', () => {
    const ok = { name: 'S/4 PRD', sid: 'PRD', role: 'PRD' as const, product: 'S/4HANA', release: '2023', hosting: 'rise' as const, notes: '' };
    expect(landscapeProblems(ok)).toEqual([]);
    expect(landscapeProblems({ ...ok, sid: 'PR' })).toContain('sid');
    expect(landscapeProblems({ ...ok, notes: 'password=x' })).toContain('secret');
  });
});

describe('diagram files', () => {
  it('allows only PNG, JPG and SVG up to 5 MB', () => {
    expect(diagramFileProblem({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull();
    expect(diagramFileProblem({ name: 'a.html', type: 'text/html', size: 10 })).toBe('type');
    expect(diagramFileProblem({ name: 'a.png', type: 'image/svg+xml', size: 10 })).toBeNull();
    expect(diagramFileProblem({ name: 'a.gif', type: 'image/gif', size: 10 })).toBe('type');
    expect(diagramFileProblem({ name: 'a.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 })).toBe('size');
  });
  it('sniffs real PNG / JPEG bytes', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0x3c, 0x73, 0x63, 0x72]))).toBeNull();
  });
  it('cleans SVG: no scripts, handlers, links or foreign content', () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><a href="javascript:x"><rect/></a><rect width="5" onclick="y()" fill="url(https://evil/x)"/><foreignObject><div>x</div></foreignObject><text>ok</text></svg>')!;
    expect(out).not.toMatch(/script|onload|onclick|foreignObject|javascript|evil|<a/i);
    expect(out).toContain('<text>ok</text>');
    expect(sanitizeSvg('<html><body/></html>')).toBeNull();
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toBeNull();
  });
});

describe('mermaid reader', () => {
  it('reads nodes, shapes and labelled edges', () => {
    const g = parseMermaid('graph TD\n  A[S/4HANA] -->|IDoc| B(CPI)\n  B -.-> C{Bank}\n  C --> D((Archive))');
    expect(g.direction).toBe('TB');
    expect(g.nodes.map((n) => n.shape)).toEqual(['rect', 'round', 'diamond', 'circle']);
    expect(g.edges[0]).toMatchObject({ from: 'A', to: 'B', label: 'IDoc', arrow: true });
    expect(g.edges[1].dashed).toBe(true);
  });
  it('never keeps markup and reports what it cannot draw', () => {
    const g = parseMermaid('graph LR\n  A["<img src=x onerror=alert(1)>"] --> B\n  click A "https://evil" \n  style A fill:#f00');
    expect(g.nodes[0].label).not.toMatch(/[<>]/);
    expect(g.problems.map((p) => p.line)).toEqual([3, 4]);
    const svg = layoutToSvg(layoutGraph(g));
    expect(svg).not.toMatch(/<img|<script|evil/i);
    expect(svg).not.toMatch(/<[^>]*\son[a-z]+=/i);
  });
  it('lays out cycles without looping', () => {
    const l = layoutGraph(parseMermaid('graph LR\nA-->B\nB-->A'));
    expect(l.nodes).toHaveLength(2);
    expect(l.width).toBeGreaterThan(0);
  });
});

describe('lists and AI results', () => {
  const row = (o: Partial<ArchListRow>): ArchListRow => ({
    id: 'x', type: 'hld', title: 'T', status: 'draft', confidentiality: 'private', sap_area: '', sap_module: '', sap_version: '', owner_name: '',
    latest_version: 0, approved_version: null, created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null, links: [], projects: [], open_comments: 0, ...o,
  });
  it('splits blueprints from design documents and filters by ticket', () => {
    const rows = [row({ id: 'a', type: 'blueprint' }), row({ id: 'b', links: [{ ticket_id: 't1', ref: 'R', title: '', status: 'new' }] }), row({ id: 'c', type: 'adr' })];
    expect(filterDocs(rows, 'blueprints', DEFAULT_FILTERS).map((r) => r.id)).toEqual(['a']);
    expect(filterDocs(rows, 'design', { ...DEFAULT_FILTERS, ticket: 't1' }).map((r) => r.id)).toEqual(['b']);
    expect(docsByTicket(rows).get('t1')?.map((r) => r.id)).toEqual(['b']);
  });
  it('AI changes never silently replace written text', () => {
    const c = emptyArchContent('hld');
    c.sections[0].html = '<p>mine</p>';
    const ch = proposedChanges({ kind: 'draft', sections: [{ key: 'context', html: '<p>ai</p>', trace: [] }, { key: 'scope', html: '<p>ai</p>', trace: [] }] }, c);
    expect(ch.find((x) => x.key === 'context')?.replaces).toBe(true);
    expect(ch.find((x) => x.key === 'scope')?.replaces).toBe(false);
  });
  it('AI drafts keep only template sections and known requirement ids', () => {
    const raw = JSON.stringify({ sections: [{ key: 'context', blocks: [{ type: 'p', text: '<b>x</b>', items: null }], trace: ['REQ-001', 'REQ-404'] }, { key: 'cutover_tasks', blocks: [], trace: [] }] });
    const out = parseArchDraft(raw, 'hld', 'en', [{ ticket_ref: 'T1', req_id: 'REQ-001' }]);
    expect(out.map((s) => s.key)).toEqual(['context']);
    expect(out[0].html).not.toContain('<b>');
    expect(out[0].trace).toEqual([{ ticket_ref: 'T1', req_id: 'REQ-001' }]);
    expect(parseReview(JSON.stringify({ findings: [{ severity: 'x', section: 'nope', finding: 'f', suggestion: '' }] }), 'hld')[0]).toMatchObject({ severity: 'medium', section: 'general' });
  });
});
