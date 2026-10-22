import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { noticeCopy } from '../../../supabase/functions/_shared/responsivenessCopy';

const h = vi.hoisted(() => ({
  notices: [] as Array<{ id: string; kind: string; event_id: string; count_30d: number; warnings_total: number; created_at: string }>,
  ack: vi.fn(async (_id: string) => {}),
}));
vi.mock('@/hooks/useSessionReady', () => ({ useSessionReady: () => ({ signedIn: true }) }));
vi.mock('@/hooks/useResponsiveness', () => ({
  RESPONSIVENESS_NOTICES_KEY: ['responsiveness-notices'],
  POPUP_NOTICE_KINDS: (k: string) => k !== 'not_counted',
  useResponsivenessNotices: () => ({ data: h.notices }),
  ackResponsivenessNotice: (id: string) => h.ack(id),
}));

import ResponsivenessNoticePopup from './ResponsivenessNoticePopup';

const n = (id: string, kind: string) => ({ id, kind, event_id: `e-${id}`, count_30d: 1, warnings_total: 2, created_at: '2026-10-20T10:00:00Z' });
const mount = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ResponsivenessNoticePopup /></MemoryRouter></QueryClientProvider>);

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); h.ack.mockReset(); h.ack.mockImplementation(async () => {}); });
afterEach(() => cleanup());

describe('responsiveness popup', () => {
  it('one notice at a time with "1 of 2"; Understood waits for the save, then the next', async () => {
    h.notices = [n('n1', 'warning_1'), n('n2', 'warning_2')];
    mount();
    expect(screen.getByRole('dialog')).toHaveTextContent('Friendly notice 1 of 2: a request was not answered in time');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }));
    await waitFor(() => expect(h.ack).toHaveBeenCalledWith('n1'));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Friendly notice 2 of 2'));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('stays visible with a retry when the save fails', async () => {
    h.notices = [n('n1', 'counted')];
    h.ack.mockRejectedValueOnce(new Error('network'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This could not be saved. Please try again.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.ack).toHaveBeenCalledTimes(2);
    expect(h.ack).toHaveBeenLastCalledWith('n1');
  });

  it('the close button also acknowledges (with the notice id, not the event id)', async () => {
    h.notices = [n('n1', 'counted')];
    mount();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    await waitFor(() => expect(h.ack).toHaveBeenCalledWith('n1'));
    expect(h.ack).not.toHaveBeenCalledWith('e-n1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Understood, dismiss all" acknowledges every waiting notice', async () => {
    h.notices = [n('a', 'warning_1'), n('b', 'warning_2'), n('c', 'badge_visible')];
    mount();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Understood, dismiss all' }));
    await waitFor(() => expect(h.ack.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']));
    h.notices = [];
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a not-counted notice is no popup: it is acknowledged quietly', async () => {
    h.notices = [n('q', 'not_counted')];
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(h.ack).toHaveBeenCalledWith('q'));
  });

  it('never opens twice in a session, even before the save returned', () => {
    h.notices = [n('n1', 'counted')];
    h.ack.mockImplementation(() => new Promise(() => {}));
    const first = mount();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    first.unmount();
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when another tab acknowledged the notice', async () => {
    h.notices = [n('n1', 'counted')];
    mount();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      localStorage.setItem('aisupport360.resp-notices.acked', JSON.stringify(['n1']));
      window.dispatchEvent(new StorageEvent('storage', { key: 'aisupport360.resp-notices.acked' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('notice wording without a ticket title', () => {
  it('never shows empty quotes (EN and AR)', () => {
    for (const kind of ['not_counted', 'counted', 'warning_1', 'badge_visible', 'dispute_upheld', 'dispute_rejected']) {
      for (const lang of ['en', 'ar'] as const) {
        const c = noticeCopy({ lang, kind });
        expect(c.body).not.toMatch(/""|"a request"|"طلب"/);
      }
    }
    expect(noticeCopy({ lang: 'en', kind: 'not_counted' }).body.startsWith('A request was not answered within the time limit')).toBe(true);
    expect(noticeCopy({ lang: 'ar', kind: 'not_counted' }).body.startsWith('لم يُرد على أحد الطلبات')).toBe(true);
    expect(noticeCopy({ lang: 'en', kind: 'counted', ticketTitle: 'SAP FI' }).body).toContain('"SAP FI"');
  });
});
