import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { markSectionOpened, registerSections } from '@/lib/brdSectionsRead';

const view = {
  role: 'consultant',
  settings: { mode: 'recommended', all_members: false, allow_no_change: false, remind_days: 2 },
  gate: { enabled: true, mode: 'recommended', waived: false, waived_at: null, state: 'pending', version: 3, submitted_at: '2026-10-20T10:00:00Z', due_at: null, open: true, approved_at: null, approved_version: null, covered: false, blocks: false },
  me: { is_approver: true, can_decide: true, decision: null, can_submit: false, can_waive: false },
  required: [],
  rounds: [{
    id: 'r1', version: 3, state: 'pending', hash: 'abcdef1234567890', version_status: 'final', submitted_at: '2026-10-20T10:00:00Z', submitted_by: 'Client',
    due_at: null, approved_at: null, closed_at: null, closed_reason: null, close_note: null, no_material_change: false, previous_version: null, submit_note: null, decisions: [],
  }],
};

vi.mock('@/hooks/useBrdApproval', () => ({ useBrdApproval: () => ({ data: view }), useRefreshBrdApproval: () => () => {} }));
vi.mock('@/lib/brd/pdf', () => ({ brdPdfBlob: vi.fn() }));
vi.mock('@/lib/brd/approvalApi', () => ({ adminWaiveBrdApproval: vi.fn(), submitBrdForApproval: vi.fn(), withdrawBrdApproval: vi.fn(), decideBrdApproval: vi.fn() }));
vi.mock('@/lib/brd/api', () => ({ getBrdVersion: vi.fn() }));

import BrdApprovalPanel from './BrdApprovalPanel';

beforeEach(async () => {
  window.localStorage.clear();
  if (!i18n.isInitialized) await i18n.use(initReactI18next).init({ lng: 'en', resources: {} });
  await i18n.changeLanguage('en');
});

const renderPanel = () => render(
  <MemoryRouter><BrdApprovalPanel ticketId="t1" state={{ brd: { shared_version: 3 } } as never} /></MemoryRouter>,
);

describe('Approve BRD waits until every section was opened', () => {
  it('is dimmed with the reason, never opens the dialog, and unblocks after the last section', () => {
    registerSections('t1', 3, ['purpose', 'scope']);
    markSectionOpened('t1', 3, 'purpose');
    renderPanel();
    const approve = screen.getByRole('button', { name: /brd\.approval\.action\.approved/ });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).toHaveAccessibleDescription(/Open every BRD section before approving \(1 of 2 opened\)\./);
    fireEvent.click(approve);
    expect(screen.queryByRole('dialog')).toBeNull();
    // Request changes and Decline are never held back
    expect(screen.getByRole('button', { name: /action\.changes_requested/ })).not.toHaveAttribute('aria-disabled');

    act(() => markSectionOpened('t1', 3, 'scope'));
    expect(screen.getByRole('button', { name: /brd\.approval\.action\.approved/ })).not.toHaveAttribute('aria-disabled');
  });

  it('asks to open the version first when the reader has not shown it yet', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /brd\.approval\.action\.approved/ }))
      .toHaveAccessibleDescription(/Open this BRD version and read every section before approving\./);
  });

  it('shows the reason in Arabic', async () => {
    await i18n.changeLanguage('ar');
    registerSections('t1', 3, ['purpose', 'scope', 'functional']);
    renderPanel();
    expect(screen.getByRole('button', { name: /brd\.approval\.action\.approved/ }))
      .toHaveAccessibleDescription(/فُتح 0 من 3/);
  });
});
