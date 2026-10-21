// H3 start sequence, step 1: choosing "AI" on the consultant's own profile goes straight to the start (no request row).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const h = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, f: string) => f }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/TimeSlotPicker', () => ({ default: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
  from: () => {
    const chain: Record<string, unknown> = {};
    chain.insert = (p: unknown) => { h.insert(p); return chain; };
    chain.select = () => chain;
    chain.single = async () => ({ data: { id: 'req-1' }, error: null });
    return chain;
  },
} }));

import ReinterviewDialog from './ReinterviewDialog';

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }

function mount(selfService: boolean) {
  render(
    <MemoryRouter initialEntries={['/consultant/profile']}>
      <Routes><Route path="*" element={<><Where /><ReinterviewDialog open onOpenChange={() => {}} consultantId="c1" selfService={selfService} /></>} /></Routes>
    </MemoryRouter>,
  );
}

const submit = () => fireEvent.click(screen.getAllByRole('button').filter((b) => /request|send|start/i.test(b.textContent ?? '')).pop()!);

describe('ReinterviewDialog start sequence', () => {
  beforeEach(() => h.insert.mockReset());

  it('consultant + AI: navigates to the interview start and creates no request row', async () => {
    mount(true);
    submit();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/consultant/interviews?start=1'));
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('admin request for a consultant still records the request', async () => {
    mount(false);
    submit();
    await waitFor(() => expect(h.insert).toHaveBeenCalledTimes(1));
    expect(h.insert.mock.calls[0][0]).toMatchObject({ consultant_id: 'c1', interview_type: 'ai', status: 'pending', requested_by: 'admin-1' });
    expect(screen.getByTestId('where').textContent).toBe('/consultant/profile');
  });
});
