import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { SapDocSource } from '@/lib/sapDocsAdmin';

const mocks = vi.hoisted(() => ({
  sources: { data: [] as unknown[], isLoading: false, error: null as unknown },
  busy: null as string | null,
  run: vi.fn(),
  remove: vi.fn(),
  cancel: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock('@/hooks/useSapDocs', () => ({
  useSapDocSources: () => mocks.sources,
  useSetDocSourceEnabled: () => ({ mutate: mocks.setEnabled, isPending: false }),
  useDocImport: () => ({ busy: mocks.busy, stopping: false, run: mocks.run, remove: mocks.remove, cancel: mocks.cancel }),
}));

import SapDocsCard from './SapDocsCard';

const base: SapDocSource = {
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

function setSources(list: SapDocSource[]) {
  mocks.sources = { data: list, isLoading: false, error: null };
}

beforeEach(() => {
  mocks.run.mockReset();
  mocks.remove.mockReset();
  mocks.cancel.mockReset();
  mocks.setEnabled.mockReset();
  mocks.busy = null;
  setSources([]);
});
afterEach(() => cleanup());

describe('SapDocsCard', () => {
  it('offers Import for a source that is not imported yet and keeps its switch off', () => {
    setSources([{ ...base, id: 'btp-best-practices', title: 'SAP BTP best practices guide', repo: 'SAP-docs/btp-best-practices-guide', status: 'empty', files_total: 0, files_done: 0, chunk_count: 0, text_bytes: 0, imported_at: null }]);
    render(<SapDocsCard />);
    expect(screen.queryByText('Not imported')).not.toBeNull();
    const sw = screen.getByRole('switch', { name: /Use SAP BTP best practices guide in suggestions/ }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Import/ }));
    expect(mocks.run).toHaveBeenCalledWith('btp-best-practices', 'import');
  });

  it('describes an imported source and lets the administrator switch it on', () => {
    setSources([base]);
    render(<SapDocsCard />);
    expect(screen.queryByText('1,791 pages, 9,812 passages, 8.4 MB of text, imported 2026-10-03')).not.toBeNull();
    expect(screen.queryByText('Ready')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Update/ })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeNull();
    const sw = screen.getByRole('switch', { name: /Use SAPUI5 and SAP Fiori in suggestions/ }) as HTMLButtonElement;
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    expect(mocks.setEnabled).toHaveBeenCalledWith({ id: 'sapui5', enabled: true });
  });

  it('shows how far a paused import is and offers Continue', () => {
    setSources([{ ...base, status: 'importing', files_total: 200, files_done: 50, chunk_count: 300, imported_at: null }]);
    render(<SapDocsCard />);
    expect(screen.queryByText(/50 of 200 pages read/)).not.toBeNull();
    expect(screen.queryByText(/press Continue/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(mocks.run).toHaveBeenCalledWith('sapui5', 'continue');
  });

  it('shows Stop while an import runs and offers nothing else for that source', () => {
    mocks.busy = 'sapui5';
    setSources([{ ...base, status: 'importing', files_total: 200, files_done: 50, imported_at: null }]);
    render(<SapDocsCard />);
    expect(screen.queryByRole('button', { name: /Update|Continue|Import/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it('asks before it removes an import and removes it after the confirmation', () => {
    setSources([base]);
    render(<SapDocsCard />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(screen.queryByText('Remove SAPUI5 and SAP Fiori?')).not.toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(mocks.remove).toHaveBeenCalledWith('sapui5');
  });

  it('shows the last error of a source', () => {
    setSources([{ ...base, status: 'error', last_error: 'GitHub did not answer (status 502). Try again later.' }]);
    render(<SapDocsCard />);
    expect(screen.queryByText(/GitHub did not answer \(status 502\)/)).not.toBeNull();
  });

  it('links to the repository of the source in a new tab', () => {
    setSources([base]);
    render(<SapDocsCard />);
    const link = screen.getByText('SAP-docs/sapui5').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://github.com/SAP-docs/sapui5');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('says that nothing is imported until the administrator presses Import', () => {
    setSources([base]);
    render(<SapDocsCard />);
    expect(screen.queryByText(/Nothing is imported until you press Import/)).not.toBeNull();
    expect(screen.queryByText(/CC BY 4.0 licence/)).not.toBeNull();
  });
});
