import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ selectDeleted: vi.fn(), inCall: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        in: (column: string, values: string[]) => {
          mocks.inCall(column, values);
          return { select: mocks.selectDeleted };
        },
      }),
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import RemoveDuplicateSkills from './RemoveDuplicateSkills';

const skill = (id: string, module: string, proficiency = 3, years = 1, certified = false) => ({ id, module, proficiency, years, certified });

const REPEATED = [skill('a', 'SAP FI', 5, 6, true), skill('b', 'SAP FI'), skill('c', ''), skill('d', 'SAP CO')];

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Remove the repeated rows' }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

beforeEach(() => {
  mocks.selectDeleted.mockReset();
  mocks.selectDeleted.mockResolvedValue({ data: [{ id: 'b' }, { id: 'c' }], error: null });
  mocks.inCall.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.warning).mockReset();
});
afterEach(() => cleanup());

describe('RemoveDuplicateSkills', () => {
  it('shows nothing when no skill is repeated or empty', () => {
    const { container } = render(<RemoveDuplicateSkills skills={[skill('a', 'SAP FI'), skill('b', 'SAP CO')]} />);
    expect(container.firstChild).toBeNull();
  });

  it('says how many rows are repeated or empty', () => {
    render(<RemoveDuplicateSkills skills={REPEATED} />);
    expect(screen.getByText(/2 rows are repeated or empty/)).toBeTruthy();
  });

  it('asks first and removes nothing before the consultant confirms', () => {
    render(<RemoveDuplicateSkills skills={REPEATED} />);
    openDialog();
    expect(screen.getByText('Remove the repeated rows?')).toBeTruthy();
    expect(mocks.inCall).not.toHaveBeenCalled();
  });

  it('removes the repeated and the empty rows and keeps the best row of each module', async () => {
    const onRemoved = vi.fn();
    render(<RemoveDuplicateSkills skills={REPEATED} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(mocks.inCall).toHaveBeenCalledTimes(1);
    const [column, ids] = mocks.inCall.mock.calls[0];
    expect(column).toBe('id');
    expect([...ids].sort()).toEqual(['b', 'c']);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('says so when only some of the rows were removed', async () => {
    mocks.selectDeleted.mockResolvedValue({ data: [{ id: 'b' }], error: null });
    const onRemoved = vi.fn();
    render(<RemoveDuplicateSkills skills={REPEATED} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('reports a problem when nothing was removed', async () => {
    mocks.selectDeleted.mockResolvedValue({ data: [], error: null });
    const onRemoved = vi.fn();
    render(<RemoveDuplicateSkills skills={REPEATED} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
