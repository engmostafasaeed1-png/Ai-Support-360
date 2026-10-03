// Helpers for the administrator's "SAP open documentation" card on the Knowledge review page.

export type DocStatus = 'empty' | 'importing' | 'ready' | 'error';

export interface SapDocSource {
  id: string;
  title: string;
  repo: string;
  branch: string;
  license: string;
  enabled: boolean;
  status: DocStatus;
  commit_sha: string | null;
  files_total: number;
  files_done: number;
  chunk_count: number;
  text_bytes: number;
  imported_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  empty: 'Not imported',
  importing: 'Importing',
  ready: 'Ready',
  error: 'Error',
};

/** What an import of each source takes from SAP's repositories (the search index needs about as much space again). */
export const DOC_SIZE_HINT: Record<string, string> = {
  'btp-best-practices': 'about 50 pages, 0.3 MB of text',
  'btp-cloud-platform': 'about 2,000 pages, 9 MB of text',
  'btp-business-application-studio': 'about 140 pages, 0.6 MB of text',
  'btp-integration-suite': 'about 3,800 pages, 21 MB of text',
  sapui5: 'about 1,800 pages, 13 MB of text',
};

export type DocAction = 'import' | 'update' | 'continue';

export const DOC_ACTION_LABEL: Record<DocAction, string> = {
  import: 'Import',
  update: 'Update',
  continue: 'Continue',
};

/** Which button a source gets: Import (nothing there yet or an error), Update (ready), Continue (an import that stopped half way). */
export function primaryAction(status: DocStatus): DocAction {
  return status === 'ready' ? 'update' : status === 'importing' ? 'continue' : 'import';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** How far an import is, 0 to 100 (whole numbers). */
export function importPercent(s: Pick<SapDocSource, 'files_total' | 'files_done'>): number {
  if (!(s.files_total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((s.files_done / s.files_total) * 100)));
}

/** The page of a source on GitHub, or null for anything that is not a repository of the SAP-docs organisation. */
export function repoUrl(repo: string): string | null {
  return /^SAP-docs\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(repo) ? `https://github.com/${repo}` : null;
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** One line about an imported source: pages, passages, size and date. */
export function describeSource(s: SapDocSource): string {
  const parts = [`${count(s.files_total)} pages`, `${count(s.chunk_count)} passages`, `${formatBytes(s.text_bytes)} of text`];
  if (s.imported_at) {
    const when = new Date(s.imported_at);
    if (!Number.isNaN(when.getTime())) parts.push(`imported ${when.toISOString().slice(0, 10)}`);
  }
  return parts.join(', ');
}
